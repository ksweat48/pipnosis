/**
 * TRADE CLOSURE COORDINATOR - Single Source of Truth
 *
 * ALL trade closures MUST go through this coordinator.
 * DO NOT update goal_session_trades.status to 'closed' directly elsewhere.
 *
 * AUTHORITY: This coordinator is the SOLE authority for trade closures.
 * - positionService.closePosition() must delegate here
 * - position-monitor must delegate here
 * - trade-lifecycle-manager must NOT close trades directly
 *
 * FAIL-HARD POLICY: No silent fallbacks. If RPC fails, operation fails.
 * Emergency recovery requires explicit emergencyRecoveryMode flag.
 */

import { supabase } from '../../lib/supabase';
import { calculatePnL } from '../../types/position';
import { goalAchievementCoordinator } from './goal-achievement-coordinator';
import { goalSessionStateMachine } from './goal-session-state-machine';
import { notificationCoordinator, NotificationType } from './notification-coordinator';
import { MarketDataService } from '../market-data-service';
import { modalQueueManager } from '../modal-queue-manager';

/**
 * SSOT Close Reason Types - MUST match database constraint
 * Database constraint will be updated in migration to include take_profit_1 and take_profit_2
 *
 * ✅ CRITICAL: These values MUST match the goal_session_trades.close_reason CHECK constraint
 * Any mismatch will cause database constraint violation errors
 *
 * NOTE: This now uses the CloseReason type from position.ts to maintain SSOT
 *
 * ENTRY_INTENT_STATUS ENUM (PostgreSQL):
 * Valid values for entry_intents.status queries:
 * - 'monitoring': Actively monitoring for entry conditions
 * - 'executed': Successfully entered trade (moved to goal_session_trades)
 * - 'timeout': User-defined timeout reached without entry
 * - 'canceled': Manually canceled by user or system
 * - 'conditions_changed': Entry conditions no longer met
 * - 'expired_no_entry': Entry expired without any fill
 * ⚠️ NEVER query with values like 'active', 'qualified' - these don't exist in enum
 */
import { CloseReason as PositionCloseReason } from '../../types/position';
export type CloseReason = PositionCloseReason;

export interface CloseTradeRequest {
  tradeId: string;
  currentPrice: number;
  closeReason: CloseReason;
  userId: string;
  goalSessionId: string;
  forceClose?: boolean;
  emergencyRecoveryMode?: boolean;
}

export interface CloseTradeResult {
  success: boolean;
  tradeId: string;
  pnl?: number;
  closePrice?: number;
  closeReason?: CloseReason;
  error?: string;
  goalAchieved?: boolean;
  auditId?: string;
  usedEmergencyRecovery?: boolean;
}

interface TradeData {
  id: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  position_size: number;
  lot_size?: number;
  status: string;
  user_id: string;
  goal_session_id: string;
}

class TradeClosureCoordinator {
  private closureLocks = new Map<string, boolean>();
  private static isInCoordinatorContext = false;

  static assertCoordinatorContext(operation: string): void {
    if (!TradeClosureCoordinator.isInCoordinatorContext) {
      console.error(`[AUTHORITY VIOLATION] ${operation} called outside coordinator context`);
    }
  }

  static markCoordinatorEntry(): void {
    TradeClosureCoordinator.isInCoordinatorContext = true;
  }

  static markCoordinatorExit(): void {
    TradeClosureCoordinator.isInCoordinatorContext = false;
  }

  async closeTrade(request: CloseTradeRequest): Promise<CloseTradeResult> {
    if (this.closureLocks.get(request.tradeId)) {
      return {
        success: false,
        tradeId: request.tradeId,
        error: 'Trade closure already in progress',
      };
    }

    this.closureLocks.set(request.tradeId, true);
    TradeClosureCoordinator.markCoordinatorEntry();

    try {
      const { data: trade, error: fetchError } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('id', request.tradeId)
        .maybeSingle();

      if (fetchError || !trade) {
        return {
          success: false,
          tradeId: request.tradeId,
          error: fetchError?.message || 'Trade not found',
        };
      }

      const tradeData = trade as TradeData;

      if (tradeData.status === 'closed') {
        console.log(`[TradeClosureCoordinator] Trade ${request.tradeId} already closed, skipping`);
        return {
          success: false,
          tradeId: request.tradeId,
          error: 'Trade already closed',
        };
      }

      if (tradeData.status !== 'open' && !request.forceClose) {
        return {
          success: false,
          tradeId: request.tradeId,
          error: `Cannot close trade with status: ${tradeData.status}. Use forceClose if needed.`,
        };
      }

      // GOVERNANCE: Validate close price before proceeding
      // Prevents trades from being closed with invalid prices (0, NaN, undefined)
      if (!request.currentPrice || !isFinite(request.currentPrice) || request.currentPrice === 0) {
        console.error(
          `[TradeClosureCoordinator] ❌ INVALID CLOSE PRICE: ${request.currentPrice} for trade ${request.tradeId}`,
          {
            symbol: tradeData.symbol,
            entryPrice: tradeData.entry_price,
            closeReason: request.closeReason,
          }
        );
        return {
          success: false,
          tradeId: request.tradeId,
          error: `Invalid close price: ${request.currentPrice}. Cannot close trade with zero or invalid price.`,
        };
      }

      const lotSize = tradeData.lot_size || tradeData.position_size;
      const pnl = calculatePnL(
        tradeData.direction,
        tradeData.entry_price,
        request.currentPrice,
        lotSize,
        tradeData.symbol
      );

      const { data: rpcResult, error: rpcError } = await supabase.rpc('close_goal_session_trade', {
        p_trade_id: request.tradeId,
        p_close_price: request.currentPrice,
        p_close_reason: request.closeReason,
        p_goal_session_id: request.goalSessionId,
        p_force_close: request.forceClose || false,
      });

      if (rpcError) {
        console.error(`[TradeClosureCoordinator] RPC FAILED:`, rpcError);

        if (request.emergencyRecoveryMode) {
          console.error(`[TradeClosureCoordinator] EMERGENCY RECOVERY MODE ACTIVATED`);
          return await this.emergencyRecoveryClose(request, tradeData, pnl);
        }

        return {
          success: false,
          tradeId: request.tradeId,
          error: `RPC failed: ${rpcError.message}. Use emergencyRecoveryMode if stuck.`,
        };
      }

      await this.logToAudit(request, tradeData, pnl, 'coordinator');

      const notificationType = this.getNotificationType(request.closeReason);
      await notificationCoordinator.send({
        userId: request.userId,
        type: notificationType,
        title: this.getNotificationTitle(request.closeReason, pnl),
        message: this.getNotificationMessage(tradeData.symbol, pnl, request.closeReason),
        tradeId: request.tradeId,
        sessionId: request.goalSessionId,
        priority: pnl >= 0 ? 'medium' : 'high',
        metadata: {
          symbol: tradeData.symbol,
          pnl,
          closePrice: request.currentPrice,
          closeReason: request.closeReason,
        },
      });

      const goalResult = await this.checkGoalAfterClose(request.userId, request.goalSessionId);

      await this.updateSessionAfterClose(request.goalSessionId, request.userId, request.closeReason);

      console.log(`[TradeClosureCoordinator] Trade ${request.tradeId} closed successfully. P&L: $${pnl.toFixed(2)}`);

      return {
        success: true,
        tradeId: request.tradeId,
        pnl,
        closePrice: request.currentPrice,
        closeReason: request.closeReason,
        goalAchieved: goalResult?.achieved,
      };
    } finally {
      this.closureLocks.delete(request.tradeId);
      TradeClosureCoordinator.markCoordinatorExit();
    }
  }

  private async emergencyRecoveryClose(
    request: CloseTradeRequest,
    trade: TradeData,
    pnl: number
  ): Promise<CloseTradeResult> {
    console.error(`[TradeClosureCoordinator] ⚠️ EMERGENCY DIRECT CLOSE for trade ${request.tradeId}`);
    console.error(`[TradeClosureCoordinator] This bypasses RPC - manual reconciliation may be needed`);

    await this.logToAudit(request, trade, pnl, 'emergency');

    const { error: updateError } = await supabase
      .from('goal_session_trades')
      .update({
        status: 'closed',
        exit_price: request.currentPrice,
        profit_loss: pnl,
        close_reason: request.closeReason,
        closed_at: new Date().toISOString(),
      })
      .eq('id', request.tradeId);

    if (updateError) {
      console.error(`[TradeClosureCoordinator] EMERGENCY CLOSE FAILED:`, updateError);
      return {
        success: false,
        tradeId: request.tradeId,
        error: `Emergency close failed: ${updateError.message}`,
        usedEmergencyRecovery: true,
      };
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('account_balance')
      .eq('id', request.userId)
      .maybeSingle();

    if (profile) {
      const newBalance = (profile.account_balance || 10000) + pnl;
      await supabase
        .from('user_profiles')
        .update({
          account_balance: newBalance,
          updated_at: new Date().toISOString(),
        })
        .eq('id', request.userId);

      console.log(`[TradeClosureCoordinator] Emergency balance update: ${profile.account_balance} + ${pnl} = ${newBalance}`);
    }

    await notificationCoordinator.sendSystemNotification({
      userId: request.userId,
      type: 'system_alert',
      title: 'Trade Closed (Emergency Recovery)',
      message: `${trade.symbol} was closed using emergency recovery. P&L: $${pnl.toFixed(2)}. Please verify your balance.`,
      tradeId: request.tradeId,
      sessionId: request.goalSessionId,
      priority: 'critical',
      metadata: {
        emergencyRecovery: true,
        symbol: trade.symbol,
        pnl,
      },
    });

    return {
      success: true,
      tradeId: request.tradeId,
      pnl,
      closePrice: request.currentPrice,
      closeReason: request.closeReason,
      usedEmergencyRecovery: true,
    };
  }

  private async logToAudit(
    request: CloseTradeRequest,
    trade: TradeData,
    pnl: number,
    source: 'coordinator' | 'emergency'
  ): Promise<void> {
    try {
      await supabase.rpc('log_coordinator_closure', {
        p_trade_id: request.tradeId,
        p_user_id: request.userId,
        p_goal_session_id: request.goalSessionId,
        p_old_status: trade.status,
        p_close_reason: request.closeReason,
        p_entry_price: trade.entry_price,
        p_exit_price: request.currentPrice,
        p_calculated_pnl: pnl,
        p_lot_size: trade.lot_size || trade.position_size,
        p_symbol: trade.symbol,
        p_direction: trade.direction,
        p_closure_source: source,
        p_closure_method: source === 'emergency'
          ? 'tradeClosureCoordinator.emergencyRecoveryClose'
          : 'tradeClosureCoordinator.closeTrade',
      });
    } catch (error) {
      console.error(`[TradeClosureCoordinator] Failed to log audit:`, error);
    }
  }

  private async checkGoalAfterClose(userId: string, sessionId: string) {
    const { data: session } = await supabase
      .from('goal_sessions')
      .select('target_value, current_progress, status')
      .eq('id', sessionId)
      .maybeSingle();

    if (!session || session.status === 'goal_achieved') return null;

    const goalAmount = session.target_value;

    return await goalAchievementCoordinator.checkAndProcessGoalAchievement({
      sessionId,
      userId,
      targetAmount: goalAmount,
      currentCumulativePnL: session.current_progress || 0,
    });
  }

  private async updateSessionAfterClose(
    sessionId: string,
    userId: string,
    closeReason?: CloseReason
  ): Promise<void> {
    // GOVERNANCE: Clean up stale intents BEFORE checking execution channels
    // This prevents orphaned "monitoring" intents from blocking session transitions
    try {
      const { data: cleanupResult, error: cleanupError } = await supabase
        .rpc('cleanup_orphaned_intents', { p_session_id: sessionId });

      if (cleanupError) {
        console.error(`[TradeClosureCoordinator] Intent cleanup error:`, cleanupError);
      } else if (cleanupResult && cleanupResult.length > 0) {
        console.log(`[TradeClosureCoordinator] Cleaned up orphaned intents:`, cleanupResult);
      }
    } catch (error) {
      console.error(`[TradeClosureCoordinator] Failed to cleanup intents:`, error);
    }

    // Check ALL execution channels before deciding session fate
    const { data: openTrades } = await supabase
      .from('goal_session_trades')
      .select('id')
      .eq('goal_session_id', sessionId)
      .eq('status', 'open');

    const { data: pendingOrders } = await supabase
      .from('goal_session_trades')
      .select('id')
      .eq('goal_session_id', sessionId)
      .eq('status', 'pending');

    // ✅ SSOT: Use 'monitoring' status as authoritative state for active intents
    // After cleanup, only legitimate monitoring intents should remain
    const { data: activeIntents } = await supabase
      .from('entry_intents')
      .select('id')
      .eq('session_id', sessionId)
      .eq('status', 'monitoring');

    const openTradesCount = openTrades?.length || 0;
    const pendingOrdersCount = pendingOrders?.length || 0;
    const activeIntentsCount = activeIntents?.length || 0;

    const allChannelsEmpty = openTradesCount === 0 && pendingOrdersCount === 0 && activeIntentsCount === 0;

    console.log(`[TradeClosureCoordinator] Session ${sessionId} execution status:`, {
      openTrades: openTradesCount,
      pendingOrders: pendingOrdersCount,
      activeIntents: activeIntentsCount,
      allChannelsEmpty,
      closeReason,
    });

    if (!allChannelsEmpty) {
      console.log(`[TradeClosureCoordinator] Session still has active execution channels, no transition needed`);
      return;
    }

    // All execution channels are empty - determine next state
    const currentStatus = await goalSessionStateMachine.getCurrentStatus(sessionId);

    if (currentStatus !== 'active' && currentStatus !== 'scanning') {
      console.log(`[TradeClosureCoordinator] Session status is ${currentStatus}, no transition needed`);
      return;
    }

    // Check if goal was already achieved
    const { data: session } = await supabase
      .from('goal_sessions')
      .select('status')
      .eq('id', sessionId)
      .maybeSingle();

    if (session?.status === 'goal_achieved') {
      console.log(`[TradeClosureCoordinator] Goal already achieved, no further transition needed`);
      return;
    }

    // Determine transition based on close reason
    // ✅ SSOT COMPLIANCE: Use database constraint values
    const isManualClose = closeReason === 'manual' || closeReason === 'force_closed';
    const isSystemClose = closeReason === 'stop_loss' || closeReason === 'take_profit' || closeReason === 'take_profit_1' || closeReason === 'take_profit_2';
    const isWeekendShutdown = closeReason === 'weekend_protection';
    const isTimeout = closeReason === 'timeout';

    console.log(`[TradeClosureCoordinator] Close reason classification:`, {
      closeReason,
      isManualClose,
      isSystemClose,
      isWeekendShutdown,
      isTimeout,
    });

    let targetStatus: 'scanning' | 'stopped' | 'weekend_shutdown' | 'timeout' = 'stopped';
    let transitionReason = 'All execution channels empty';

    if (isManualClose) {
      // Manual closure → stop the session
      targetStatus = 'stopped';
      transitionReason = 'User manually closed all trades';
      console.log(`[TradeClosureCoordinator] Manual close detected → will stop session`);
    } else if (isSystemClose) {
      // System closure (SL/TP) → continue scanning automatically (removed continuation modal 2026-01-30)
      targetStatus = 'scanning';
      transitionReason = 'Trade closed by system, resuming scanning automatically';
      console.log(`[TradeClosureCoordinator] System close (${closeReason}) detected → will resume scanning automatically`);

      // Create trade_closed modal for notification only (non-blocking)
      console.log(`[TradeClosureCoordinator] Creating trade_closed notification`);
      await this.createTradeClosedModal(sessionId, userId, closeReason);
      console.log(`[TradeClosureCoordinator] Notification created successfully`);
    } else if (isWeekendShutdown) {
      targetStatus = 'weekend_shutdown';
      transitionReason = 'Weekend protection activated';
      console.log(`[TradeClosureCoordinator] Weekend shutdown detected`);
    } else if (isTimeout) {
      targetStatus = 'timeout';
      transitionReason = 'Session timeout';
      console.log(`[TradeClosureCoordinator] Timeout detected`);
    } else {
      // Default: stop the session
      targetStatus = 'stopped';
      transitionReason = `All trades closed (reason: ${closeReason || 'unknown'})`;
      console.log(`[TradeClosureCoordinator] Default behavior → stopping session`);
    }

    console.log(`[TradeClosureCoordinator] 🔄 Attempting transition: ${currentStatus} → ${targetStatus}`);
    console.log(`[TradeClosureCoordinator] Transition reason: ${transitionReason}`);

    const transitionResult = await goalSessionStateMachine.transition(sessionId, targetStatus, {
      reason: transitionReason,
      triggeredBy: 'TradeClosureCoordinator',
      additionalData: {
        closeReason,
        isManualClose,
        isSystemClose,
      },
    });

    if (transitionResult.success) {
      // Send notification for session closure
      if (targetStatus === 'stopped') {
        await notificationCoordinator.send({
          userId,
          type: 'session_ended',
          title: 'Session Ended',
          message: isManualClose
            ? 'Your trading session has ended because you closed all trades.'
            : 'Your trading session has ended.',
          sessionId,
          priority: 'medium',
          metadata: {
            reason: transitionReason,
            closeReason,
          },
        });
      }
    } else {
      console.error(
        `[TradeClosureCoordinator] Failed to transition session: ${transitionResult.error}`
      );
    }
  }

  private async createTradeClosedModal(
    sessionId: string,
    userId: string,
    closeReason: CloseReason
  ): Promise<void> {
    try {
      // Get session and trade data for modal
      const { data: session } = await supabase
        .from('goal_sessions')
        .select('target_value, current_progress')
        .eq('id', sessionId)
        .maybeSingle();

      const { data: closedTrade } = await supabase
        .from('goal_session_trades')
        .select('symbol, direction, entry_price, exit_price, profit_loss, stop_loss, take_profit')
        .eq('goal_session_id', sessionId)
        .eq('close_reason', closeReason)
        .order('closed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { count: tradesCount } = await supabase
        .from('goal_session_trades')
        .select('*', { count: 'exact', head: true })
        .eq('goal_session_id', sessionId);

      if (!session || !closedTrade) {
        console.error('[TradeClosureCoordinator] Missing session or trade data for modal');
        return;
      }

      const targetValue = session.target_value;

      // Check if goal achieved
      const isGoalAchieved = session.current_progress >= targetValue;

      // Create modal through modal queue manager (SSOT for modals)
      await modalQueueManager.createPendingModal(
        userId,
        sessionId,
        'trade_closed',
        {
          symbol: closedTrade.symbol,
          direction: closedTrade.direction,
          entry_price: closedTrade.entry_price,
          exit_price: closedTrade.exit_price,
          profit_loss: closedTrade.profit_loss,
          close_reason: closeReason,
          stop_loss: closedTrade.stop_loss,
          take_profit: closedTrade.take_profit,
          current_progress: session.current_progress || 0,
          target_value: targetValue,
          trades_in_session: tradesCount || 0,
          isGoalAchieved,
        }
      );

      console.log('[TradeClosureCoordinator] ✅ Trade closed modal created for user decision');
    } catch (error) {
      console.error('[TradeClosureCoordinator] Error creating trade closed modal:', error);
    }
  }

  private getNotificationType(closeReason: CloseReason): NotificationType {
    switch (closeReason) {
      case 'stop_loss':
        return 'stop_loss_hit';
      case 'take_profit':
        return 'take_profit_hit';
      case 'goal_achieved':
        // ✅ REMOVED: 'goal_met' (use 'goal_achieved' instead)
        return 'goal_achieved';
      default:
        return 'trade_closed';
    }
  }

  private getNotificationTitle(closeReason: CloseReason, pnl: number): string {
    switch (closeReason) {
      case 'stop_loss':
        return 'Stop Loss Triggered';
      case 'take_profit':
        return 'Take Profit Hit!';
      case 'goal_achieved':
        // ✅ REMOVED: 'goal_met' (use 'goal_achieved' instead)
        return 'Goal Achieved!';
      case 'manual':
        return pnl >= 0 ? 'Trade Closed in Profit' : 'Trade Closed';
      case 'timeout':  // ✅ FIXED: was 'session_timeout'
        return 'Session Timeout - Trade Closed';
      case 'force_closed':  // ✅ FIXED: was 'force_close'
        return 'Trade Force Closed';
      default:
        return 'Trade Closed';
    }
  }

  private getNotificationMessage(symbol: string, pnl: number, closeReason: CloseReason): string {
    const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;

    switch (closeReason) {
      case 'stop_loss':
        return `${symbol} hit stop loss. Result: ${pnlStr}`;
      case 'take_profit':
        return `${symbol} reached take profit! Result: ${pnlStr}`;
      case 'goal_achieved':
        // ✅ REMOVED: 'goal_met' (use 'goal_achieved' instead)
        return `${symbol} closed at goal achievement. Result: ${pnlStr}`;
      default:
        return `${symbol} closed. Result: ${pnlStr}`;
    }
  }

  async forceCloseAllTrades(
    sessionId: string,
    userId: string,
    reason: CloseReason,
    emergencyRecoveryMode: boolean = false
  ): Promise<CloseTradeResult[]> {
    const { data: openTrades, error } = await supabase
      .from('goal_session_trades')
      .select('id, symbol')
      .eq('goal_session_id', sessionId)
      .eq('status', 'open');

    if (error || !openTrades || openTrades.length === 0) {
      return [];
    }

    const results: CloseTradeResult[] = [];

    // ✅ PHASE 2: Use MarketDataService as SSOT
    const marketDataService = MarketDataService.getInstance();

    for (const trade of openTrades) {
      const priceData = await marketDataService.getCurrentPrice(trade.symbol);

      const currentPrice = priceData ? priceData.price : 0;

      if (currentPrice > 0) {
        const result = await this.closeTrade({
          tradeId: trade.id,
          currentPrice,
          closeReason: reason,
          userId,
          goalSessionId: sessionId,
          forceClose: true,
          emergencyRecoveryMode,
        });
        results.push(result);
      } else {
        console.error(`[TradeClosureCoordinator] No price data for ${trade.symbol}, cannot close trade ${trade.id}`);
        results.push({
          success: false,
          tradeId: trade.id,
          error: `No price data available for ${trade.symbol}`,
        });
      }
    }

    return results;
  }

  async getTradeForClosure(tradeId: string): Promise<TradeData | null> {
    const { data, error } = await supabase
      .from('goal_session_trades')
      .select('*')
      .eq('id', tradeId)
      .maybeSingle();

    if (error || !data) return null;
    return data as TradeData;
  }

  /**
   * Subscribe to trade closure events from database
   * Enables realtime post-processing for all closure paths:
   *   - Browser-based closures (manual UI)
   *   - Database trigger-based closures (SL/TP hits)
   *   - Server-side monitor closures
   *
   * This ensures post-processing runs immediately for users with active browser sessions.
   * Server-side fallback processes events every 10 seconds for offline users.
   */
  subscribeToClosureEvents(userId: string): void {
    try {
      supabase
        .channel(`closure_events_${userId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'trade_closure_events',
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            const event = payload.new as any;
            this.handleClosureEvent(event).catch((error) => {
              console.error('[TradeClosureCoordinator] Error handling closure event:', error);
            });
          }
        )
        .subscribe();

      console.log(`[TradeClosureCoordinator] Subscribed to closure events for user ${userId}`);
    } catch (error) {
      console.error('[TradeClosureCoordinator] Failed to subscribe to closure events:', error);
      // Don't fail - server-side processing will catch up
    }
  }

  /**
   * Handle a trade closure event from the event stream
   * Runs post-processing pipeline: notifications, analysis, rewards, state transitions
   */
  private async handleClosureEvent(event: any): Promise<void> {
    const { tradeClosureEventProcessor } = await import('../trade-closure-event-processor');

    console.log(`[TradeClosureCoordinator] Handling closure event for trade ${event.trade_id}`);

    // Process the event using the event processor
    const result = await tradeClosureEventProcessor.processEvent({
      id: event.id,
      trade_id: event.trade_id,
      user_id: event.user_id,
      goal_session_id: event.goal_session_id,
      symbol: event.symbol,
      direction: event.direction,
      close_price: event.close_price,
      close_reason: event.close_reason,
      pnl: event.pnl,
      last_processed_at: event.last_processed_at,
      post_processing_status: event.post_processing_status,
      processing_error: event.processing_error,
      created_at: event.created_at,
      event_triggered_by: event.event_triggered_by,
    });

    if (!result.success) {
      console.warn(`[TradeClosureCoordinator] Event processing failed for ${event.trade_id}:`, result.error);
    }
  }
}

export const tradeClosureCoordinator = new TradeClosureCoordinator();
