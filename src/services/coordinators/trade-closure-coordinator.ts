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

export type CloseReason =
  | 'stop_loss'
  | 'take_profit'
  | 'manual'
  | 'goal_achieved'
  | 'goal_met'
  | 'session_timeout'
  | 'force_close'
  | 'weekend_shutdown'
  | 'risk_limit'
  | 'trailing_stop';

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
          success: true,
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

      await this.updateSessionAfterClose(request.goalSessionId, request.userId);

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

    await notificationCoordinator.send({
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
      .select('goal_amount, target_value, current_progress, status')
      .eq('id', sessionId)
      .maybeSingle();

    if (!session || session.status === 'goal_achieved') return null;

    const goalAmount = session.target_value
      || (typeof session.goal_amount === 'object'
        ? (session.goal_amount as Record<string, number>).amount
        : session.goal_amount);

    return await goalAchievementCoordinator.checkAndProcessGoalAchievement({
      sessionId,
      userId,
      targetAmount: goalAmount,
      currentCumulativePnL: session.current_progress || 0,
    });
  }

  private async updateSessionAfterClose(sessionId: string, userId: string): Promise<void> {
    const { data: openTrades } = await supabase
      .from('goal_session_trades')
      .select('id')
      .eq('goal_session_id', sessionId)
      .eq('status', 'open');

    if (!openTrades || openTrades.length === 0) {
      const currentStatus = await goalSessionStateMachine.getCurrentStatus(sessionId);

      if (currentStatus === 'active') {
        await goalSessionStateMachine.transition(sessionId, 'scanning', {
          reason: 'All trades closed, returning to scanning',
          triggeredBy: 'TradeClosureCoordinator',
        });
      }
    }
  }

  private getNotificationType(closeReason: CloseReason): NotificationType {
    switch (closeReason) {
      case 'stop_loss':
        return 'stop_loss_hit';
      case 'take_profit':
        return 'take_profit_hit';
      case 'goal_achieved':
      case 'goal_met':
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
      case 'goal_met':
        return 'Goal Achieved!';
      case 'manual':
        return pnl >= 0 ? 'Trade Closed in Profit' : 'Trade Closed';
      case 'session_timeout':
        return 'Session Timeout - Trade Closed';
      case 'force_close':
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
      case 'goal_met':
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

    for (const trade of openTrades) {
      const { data: priceData } = await supabase
        .from('realtime_prices')
        .select('bid, ask')
        .eq('symbol', trade.symbol)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const currentPrice = priceData ? (priceData.bid + priceData.ask) / 2 : 0;

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
}

export const tradeClosureCoordinator = new TradeClosureCoordinator();
