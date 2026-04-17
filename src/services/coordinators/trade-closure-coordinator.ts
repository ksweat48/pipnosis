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
import { RealtimeChannel } from '@supabase/supabase-js';
import { realtimeConnectionManager } from '../realtime-connection-manager';
import { calculatePnL } from '../../types/position';
import { goalAchievementCoordinator } from './goal-achievement-coordinator';
import { goalSessionStateMachine } from './goal-session-state-machine';
import { notificationCoordinator } from './notification-coordinator';
import { MarketDataService } from '../market-data-service';
import { modalQueueManager } from '../modal-queue-manager';
import { sessionPhasePerformanceService, SessionPhasePerformanceService } from '../session-phase-performance-service';

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
  private closureEventChannel: RealtimeChannel | null = null;

  // CCIP FIX (2026-03-04 TP1-ONCE-PER-TRADE): Tracks trade IDs for which a closure dialog
  // has already been shown. closureLocks was previously (incorrectly) used for this purpose
  // but is always deleted in the finally block before handleClosureEvent fires — making the
  // dedup check permanently false. This Set is populated when showTradeClosed() is called
  // from closeTrade() or handleClosureEvent(), whichever runs first. The Realtime event
  // path checks this Set before calling showTradeClosed() a second time.
  // Entries expire after 60 seconds to avoid memory growth across many trades.
  private shownDialogForTrade = new Set<string>();

  private markDialogShown(tradeId: string): void {
    this.shownDialogForTrade.add(tradeId);
    setTimeout(() => this.shownDialogForTrade.delete(tradeId), 60000);
  }

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

      // CCIP-2026-0325B: Session-phase-style performance mirror
      // Non-blocking. Fires after confirmed RPC success. Authority: sessionPhasePerformanceService.
      this.recordPerformanceOutcome(request, trade, pnl).catch(() => {});

      const goalResult = await this.checkGoalAfterClose(request.userId, request.goalSessionId);

      await this.updateSessionAfterClose(request.goalSessionId, request.userId, request.closeReason);

      // INSTANT MODAL: Show trade-closed dialog immediately after confirmed RPC success.
      // Do NOT wait for the Realtime trade_closure_events round-trip (5-20s latency).
      // handleClosureEvent (Realtime path) uses shownDialogForTrade to deduplicate.
      this.showInstantClosureModal(request, tradeData, pnl, goalResult?.achieved ?? false).catch(() => {});

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

  private async showInstantClosureModal(
    request: CloseTradeRequest,
    trade: TradeData,
    pnl: number,
    goalAchieved: boolean
  ): Promise<void> {
    if (this.shownDialogForTrade.has(request.tradeId)) return;

    try {
      const [{ data: session }, { count: tradesCount }] = await Promise.all([
        supabase
          .from('goal_sessions')
          .select('target_value, current_progress, dollar_risk')
          .eq('id', request.goalSessionId)
          .maybeSingle(),
        supabase
          .from('goal_session_trades')
          .select('*', { count: 'exact', head: true })
          .eq('goal_session_id', request.goalSessionId),
      ]);

      if (!session) return;

      const isGoalAchieved = goalAchieved || (session.current_progress || 0) >= (session.target_value || Infinity);

      this.markDialogShown(request.tradeId);

      const tradeRecord = trade as any;
      const { globalDialogManager } = await import('../global-dialog-manager');
      globalDialogManager.showTradeClosed({
        symbol: trade.symbol,
        direction: trade.direction,
        entryPrice: trade.entry_price,
        exitPrice: request.currentPrice,
        profitLoss: pnl,
        closeReason: request.closeReason,
        stopLoss: trade.stop_loss,
        takeProfit: trade.take_profit,
        currentProgress: session.current_progress || 0,
        targetValue: session.target_value || 0,
        tradesInSession: tradesCount || 0,
        dollarRisk: session.dollar_risk || 0,
        isGoalAchieved,
        sessionId: request.goalSessionId,
        tradeId: request.tradeId,
        tp1Pnl: tradeRecord.tp1_hit && tradeRecord.tp1_pnl != null ? parseFloat(String(tradeRecord.tp1_pnl)) : null,
        tp2Pnl: tradeRecord.tp2_pnl != null ? parseFloat(String(tradeRecord.tp2_pnl)) : null,
      }, { skipPersist: true });
    } catch {
      // Non-fatal — Realtime path is the fallback
    }
  }

  private async emergencyRecoveryClose(
    request: CloseTradeRequest,
    trade: TradeData,
    pnl: number
  ): Promise<CloseTradeResult> {

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

  private async recordPerformanceOutcome(
    request: CloseTradeRequest,
    trade: Record<string, unknown>,
    pnl: number
  ): Promise<void> {
    try {
      const openedAt = trade['opened_at'] as string | undefined;
      const sessionName = openedAt
        ? SessionPhasePerformanceService.deriveSessionName(openedAt)
        : 'unknown';

      const regimeSnapshot = trade['regime_snapshot'] as Record<string, unknown> | null;
      const marketPhase = SessionPhasePerformanceService.extractMarketPhase(regimeSnapshot);

      const tradeStyle = (trade['alpha_style'] as string | null) ||
                         (trade['resolved_style'] as string | null) ||
                         'unknown';

      const setupType = (trade['setup_type'] as string | null) ||
                        (trade['ai_strategy_used'] as string | null) ||
                        null;

      const confidence = Number(trade['trade_confidence'] || trade['ai_confidence'] || 0);
      const isWin = pnl > 0;

      await sessionPhasePerformanceService.recordTradeOutcome({
        userId:      request.userId,
        sessionName,
        marketPhase,
        tradeStyle,
        setupType,
        isWin,
        pnl,
        confidence,
      });
    } catch {
      // Non-blocking — closure result is already committed
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
    // Determine close reason classification first — needed for Phase 3 intent cancel
    const isManualClose = closeReason === 'manual' || closeReason === 'force_closed';
    const isSystemClose = closeReason === 'stop_loss' || closeReason === 'take_profit' || closeReason === 'take_profit_1' || closeReason === 'take_profit_2';
    const isWeekendShutdown = closeReason === 'weekend_protection';
    const isTimeout = closeReason === 'timeout';

    // INTENT CANCELLATION GOVERNANCE:
    // Only cancel monitoring intents when the USER or SYSTEM explicitly terminates the session.
    // For TP/SL/system closures, monitoring intents are INDEPENDENT execution channels —
    // they represent Alpha's deferred entry decisions and must survive a trade closure.
    // Canceling them on TP/SL hits destroys the wait_pullback/push_confirmation pipeline.
    //
    // Manual close / force_closed / weekend / timeout → cancel all intents (session is ending)
    // TP / SL / system close → do NOT cancel intents (session may continue if intent is live)
    const shouldCancelIntents = isManualClose || isWeekendShutdown || isTimeout;
    if (shouldCancelIntents) {
      try {
        await supabase.rpc('cancel_all_session_intents', { p_session_id: sessionId });
      } catch {
        // Non-fatal
      }
    }

    // Orphan cleanup for all paths (defense-in-depth)
    try {
      await supabase.rpc('cleanup_orphaned_intents', { p_session_id: sessionId });
    } catch {
      // Non-fatal
    }

    // Check ALL execution channels before deciding session fate
    const [
      { data: openTrades },
      { data: pendingOrders },
      { data: activeIntents },
    ] = await Promise.all([
      supabase.from('goal_session_trades').select('id').eq('goal_session_id', sessionId).eq('status', 'open'),
      supabase.from('goal_session_trades').select('id').eq('goal_session_id', sessionId).eq('status', 'pending'),
      supabase.from('entry_intents').select('id').eq('session_id', sessionId).eq('status', 'monitoring'),
    ]);

    const allChannelsEmpty =
      (openTrades?.length || 0) === 0 &&
      (pendingOrders?.length || 0) === 0 &&
      (activeIntents?.length || 0) === 0;

    // If there are still active monitoring intents, keep the session alive —
    // the intent is managing a deferred trade entry. The session must remain
    // in a state the entry monitor can execute against.
    if (!allChannelsEmpty) {
      if ((activeIntents?.length || 0) > 0) {
        try {
          await supabase
            .from('goal_sessions')
            .update({ status: 'scanning' })
            .eq('id', sessionId)
            .in('status', ['active', 'in_trade']);
        } catch {
          // Non-fatal — intent monitor will continue regardless
        }
      }
      return;
    }

    // All execution channels are empty - determine next state
    const currentStatus = await goalSessionStateMachine.getCurrentStatus(sessionId);

    if (currentStatus !== 'active' && currentStatus !== 'scanning') return;

    // Check if goal was already achieved
    const { data: session } = await supabase
      .from('goal_sessions')
      .select('status')
      .eq('id', sessionId)
      .maybeSingle();

    if (session?.status === 'goal_achieved') return;

    let targetStatus: 'stopped' | 'weekend_shutdown' | 'timeout' = 'stopped';
    let transitionReason = 'All execution channels empty';

    if (isManualClose) {
      targetStatus = 'stopped';
      transitionReason = 'User manually closed all trades';
    } else if (isSystemClose) {
      targetStatus = 'stopped';
      transitionReason = `Trade closed by ${closeReason} - session ended`;
    } else if (isWeekendShutdown) {
      targetStatus = 'weekend_shutdown';
      transitionReason = 'Weekend protection activated';
    } else if (isTimeout) {
      targetStatus = 'timeout';
      transitionReason = 'Session timeout';
    } else {
      targetStatus = 'stopped';
      transitionReason = `All trades closed (reason: ${closeReason || 'unknown'})`;
    }

    const transitionResult = await goalSessionStateMachine.transition(sessionId, targetStatus, {
      reason: transitionReason,
      triggeredBy: 'TradeClosureCoordinator',
      additionalData: {
        closeReason,
        isManualClose,
        isSystemClose,
      },
    });

    if (transitionResult.success && targetStatus === 'stopped') {
      await notificationCoordinator.send({
        userId,
        type: 'session_ended',
        title: 'Session Ended',
        message: isManualClose
          ? 'Your trading session has ended because you closed all trades.'
          : isSystemClose
          ? `Your trading session has ended. Trade closed by ${closeReason === 'stop_loss' ? 'Stop Loss' : 'Take Profit'}.`
          : 'Your trading session has ended.',
        sessionId,
        priority: 'medium',
        metadata: { reason: transitionReason, closeReason },
      });
    }
  }

  private async createTradeClosedModal(
    sessionId: string,
    userId: string,
    closeReason: CloseReason,
    tradeId?: string
  ): Promise<void> {
    try {
      const [
        { data: session },
        { data: closedTrade },
        { count: tradesCount },
      ] = await Promise.all([
        supabase.from('goal_sessions').select('target_value, current_progress, dollar_risk').eq('id', sessionId).maybeSingle(),
        supabase.from('goal_session_trades').select('symbol, direction, entry_price, exit_price, profit_loss, stop_loss, take_profit').eq('goal_session_id', sessionId).eq('close_reason', closeReason).order('closed_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('goal_session_trades').select('*', { count: 'exact', head: true }).eq('goal_session_id', sessionId),
      ]);

      if (!session || !closedTrade) return;

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
          dollar_risk: session.dollar_risk || 0,
          trades_in_session: tradesCount || 0,
          isGoalAchieved,
          // CCIP FIX (2026-02-19): Carry tradeId so GlobalDialogManager can deduplicate
          // across the persistent-queue path and the Realtime event path
          trade_id: tradeId,
        }
      );

    } catch {
      // Non-fatal — modal will surface via pending_user_modals subscription
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
    if (this.closureEventChannel) {
      return;
    }

    try {
      this.closureEventChannel = supabase
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
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR') {
            realtimeConnectionManager.logChannelError('TradeClosureCoordinator');
          }
        });

    } catch (error) {
      console.error('[TradeClosureCoordinator] Failed to subscribe to closure events:', error);
      this.closureEventChannel = null;
    }
  }

  cleanupClosureEvents(): void {
    if (this.closureEventChannel) {
      supabase.removeChannel(this.closureEventChannel);
      this.closureEventChannel = null;
    }
  }

  /**
   * Handle a trade closure event from the event stream
   * Runs post-processing pipeline: notifications, analysis, rewards, state transitions
   */
  private async handleClosureEvent(event: any): Promise<void> {
    const { tradeClosureEventProcessor } = await import('../trade-closure-event-processor');

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


    // SSOT AUTHORITY (2026-02-20): This is the ONLY place that shows the trade-closed
    // modal. The position-monitor.ts no longer creates its own modal (SSOT violation
    // removed). ALL close reasons must show a dialog so users always see the outcome.
    //
    // CCIP FIX (2026-03-04 TP1-ONCE-PER-TRADE): Replace broken closureLocks dedup.
    // closureLocks was always deleted in the closeTrade() finally block before this
    // Realtime event ever fires — making the check permanently false. shownDialogForTrade
    // is the correct Set for cross-path dedup: the realtime-trade-notification-listener
    // also calls globalDialogManager.showTradeClosed() via fetchAndShowTradeClosedModal(),
    // but GlobalDialogManager's own 30-second dedup keyed on tradeId is the final safety net.
    // Both paths call globalDialogManager.showTradeClosed(); GDM deduplicates on tradeId.
    if (this.shownDialogForTrade.has(event.trade_id)) return;

    try {
      // Run all 3 queries in parallel to minimize modal latency (Phase 2)
      const [
        { data: tradeData },
        { data: session },
        { count: tradesCount },
      ] = await Promise.all([
        supabase
          .from('goal_session_trades')
          .select('symbol, direction, entry_price, exit_price, profit_loss, stop_loss, take_profit, tp1_pnl, tp2_pnl, tp1_hit')
          .eq('id', event.trade_id)
          .maybeSingle(),
        supabase
          .from('goal_sessions')
          .select('target_value, current_progress, dollar_risk')
          .eq('id', event.goal_session_id)
          .maybeSingle(),
        supabase
          .from('goal_session_trades')
          .select('*', { count: 'exact', head: true })
          .eq('goal_session_id', event.goal_session_id),
      ]);

      if (tradeData && session) {
        const isGoalAchieved = (session.current_progress || 0) >= (session.target_value || Infinity);

        this.markDialogShown(event.trade_id);

        const { globalDialogManager } = await import('../global-dialog-manager');
        globalDialogManager.showTradeClosed({
          symbol: tradeData.symbol,
          direction: tradeData.direction,
          entryPrice: tradeData.entry_price,
          exitPrice: tradeData.exit_price,
          profitLoss: tradeData.profit_loss,
          closeReason: event.close_reason,
          stopLoss: tradeData.stop_loss,
          takeProfit: tradeData.take_profit,
          currentProgress: session.current_progress || 0,
          targetValue: session.target_value || 0,
          tradesInSession: tradesCount || 0,
          dollarRisk: session.dollar_risk || 0,
          isGoalAchieved,
          sessionId: event.goal_session_id,
          tradeId: event.trade_id,
          tp1Pnl: tradeData.tp1_hit && tradeData.tp1_pnl != null ? parseFloat(String(tradeData.tp1_pnl)) : null,
          tp2Pnl: tradeData.tp2_pnl != null ? parseFloat(String(tradeData.tp2_pnl)) : null,
        });
      }
    } catch {
      // Non-fatal — pending_user_modals subscription is the fallback path
    }
  }
}

export const tradeClosureCoordinator = new TradeClosureCoordinator();
