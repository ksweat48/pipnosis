/**
 * TRADE CLOSURE COORDINATOR - Single Source of Truth
 *
 * ALL trade closures MUST go through this coordinator.
 * DO NOT update goal_session_trades.status to 'closed' directly elsewhere.
 *
 * This ensures:
 * - Balance is ALWAYS updated correctly
 * - P&L is calculated using SSOT functions
 * - Notifications are sent consistently
 * - Goal achievement is checked properly
 * - No orphaned or inconsistent trade states
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
}

export interface CloseTradeResult {
  success: boolean;
  tradeId: string;
  pnl?: number;
  closePrice?: number;
  closeReason?: CloseReason;
  error?: string;
  goalAchieved?: boolean;
}

interface TradeData {
  id: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  position_size: number;
  status: string;
  user_id: string;
  goal_session_id: string;
}

class TradeClosureCoordinator {
  private closureLocks = new Map<string, boolean>();

  async closeTrade(request: CloseTradeRequest): Promise<CloseTradeResult> {
    if (this.closureLocks.get(request.tradeId)) {
      return {
        success: false,
        tradeId: request.tradeId,
        error: 'Trade closure already in progress',
      };
    }

    this.closureLocks.set(request.tradeId, true);

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
          success: true,
          tradeId: request.tradeId,
          error: 'Trade already closed',
        };
      }

      if (tradeData.status !== 'open' && !request.forceClose) {
        return {
          success: false,
          tradeId: request.tradeId,
          error: `Cannot close trade with status: ${tradeData.status}`,
        };
      }

      const pnl = calculatePnL(
        tradeData.direction,
        tradeData.entry_price,
        request.currentPrice,
        tradeData.position_size,
        tradeData.symbol
      );

      const { error: rpcError } = await supabase.rpc('close_goal_session_trade', {
        p_trade_id: request.tradeId,
        p_exit_price: request.currentPrice,
        p_close_reason: request.closeReason,
        p_user_id: request.userId,
        p_goal_session_id: request.goalSessionId,
        p_force_close: request.forceClose || false,
      });

      if (rpcError) {
        console.error(`[TradeClosureCoordinator] RPC error:`, rpcError);

        if (request.forceClose) {
          return await this.fallbackDirectClose(request, tradeData, pnl);
        }

        return {
          success: false,
          tradeId: request.tradeId,
          error: rpcError.message,
        };
      }

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
    }
  }

  private async fallbackDirectClose(
    request: CloseTradeRequest,
    trade: TradeData,
    pnl: number
  ): Promise<CloseTradeResult> {
    console.warn(`[TradeClosureCoordinator] Using fallback direct close for trade ${request.tradeId}`);

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
      return {
        success: false,
        tradeId: request.tradeId,
        error: `Fallback close failed: ${updateError.message}`,
      };
    }

    const { data: balance } = await supabase
      .from('token_balance')
      .select('balance')
      .eq('user_id', request.userId)
      .maybeSingle();

    if (balance) {
      await supabase
        .from('token_balance')
        .update({
          balance: balance.balance + pnl,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', request.userId);
    }

    return {
      success: true,
      tradeId: request.tradeId,
      pnl,
      closePrice: request.currentPrice,
      closeReason: request.closeReason,
    };
  }

  private async checkGoalAfterClose(userId: string, sessionId: string) {
    const { data: session } = await supabase
      .from('goal_sessions')
      .select('goal_amount, cumulative_profit, status')
      .eq('id', sessionId)
      .maybeSingle();

    if (!session || session.status === 'goal_achieved') return null;

    const goalAmount = typeof session.goal_amount === 'object'
      ? (session.goal_amount as Record<string, number>).amount
      : session.goal_amount;

    return await goalAchievementCoordinator.checkAndProcessGoalAchievement({
      sessionId,
      userId,
      targetAmount: goalAmount,
      currentCumulativePnL: session.cumulative_profit || 0,
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
        return `${symbol} closed at goal achievement. Result: ${pnlStr}`;
      default:
        return `${symbol} closed. Result: ${pnlStr}`;
    }
  }

  async forceCloseAllTrades(sessionId: string, userId: string, reason: CloseReason): Promise<CloseTradeResult[]> {
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
        });
        results.push(result);
      }
    }

    return results;
  }
}

export const tradeClosureCoordinator = new TradeClosureCoordinator();
