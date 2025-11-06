import { supabase } from '../lib/supabase';
import { goalSessionManager } from './goal-session-manager';
import { goalNotificationSystem } from './goal-notifications';

export interface TradeHealth {
  tradeId: string;
  health: 'excellent' | 'good' | 'concerning' | 'poor';
  currentPL: number;
  plPercentage: number;
  recommendation: string;
  shouldEarlyExit: boolean;
  shouldTrailStop: boolean;
  trailingStopPrice?: number;
}

class GoalTradeMonitor {
  async monitorActiveTrades(sessionId: string, userId: string): Promise<void> {
    try {
      const { data: trades, error } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('goal_session_id', sessionId)
        .eq('status', 'open');

      if (error || !trades || trades.length === 0) {
        return;
      }

      for (const trade of trades) {
        const health = await this.evaluateTradeHealth(trade);

        if (health.shouldEarlyExit) {
          await goalNotificationSystem.sendAlertNotification(
            sessionId,
            userId,
            'Early Exit Recommended',
            health.recommendation,
            { trade, health }
          );
        }

        if (health.shouldTrailStop) {
          await goalSessionManager.addAIMessage(
            sessionId,
            userId,
            `Trailing stop suggested for ${trade.symbol}: Move SL to ${health.trailingStopPrice?.toFixed(5)} to secure profits.`,
            { trade, health },
            'educational'
          );
        }

        const milestones = [25, 50, 75, 100];
        for (const milestone of milestones) {
          if (this.shouldNotifyMilestone(trade, health.plPercentage, milestone)) {
            await this.sendMilestoneNotification(sessionId, userId, trade, milestone, health);
          }
        }
      }
    } catch (error) {
      console.error('Error monitoring trades:', error);
    }
  }

  async evaluateTradeHealth(trade: any): Promise<TradeHealth> {
    try {
      const { data: candles } = await supabase
        .from('forex_candles')
        .select('*')
        .eq('symbol', trade.symbol)
        .eq('timeframe', '5m')
        .order('open_time', { ascending: false })
        .limit(10);

      if (!candles || candles.length === 0) {
        return this.getDefaultHealth(trade);
      }

      const currentPrice = candles[0].close;
      const entryPrice = trade.entry_price;
      const stopLoss = trade.stop_loss;
      const takeProfit = trade.take_profit;

      const direction = trade.direction === 'buy' ? 1 : -1;
      const currentPL = (currentPrice - entryPrice) * direction;
      const totalRisk = Math.abs(entryPrice - stopLoss);
      const totalReward = Math.abs(takeProfit - entryPrice);
      const plPercentage = (Math.abs(currentPL) / totalReward) * 100 * (currentPL >= 0 ? 1 : -1);

      let health: 'excellent' | 'good' | 'concerning' | 'poor' = 'good';
      let recommendation = '';
      let shouldEarlyExit = false;
      let shouldTrailStop = false;
      let trailingStopPrice: number | undefined;

      const distanceToSL = Math.abs(currentPrice - stopLoss) / totalRisk;
      const distanceToTP = Math.abs(currentPrice - takeProfit) / totalReward;

      if (plPercentage > 75) {
        health = 'excellent';
        shouldTrailStop = true;
        trailingStopPrice = trade.direction === 'buy'
          ? currentPrice - (totalRisk * 0.5)
          : currentPrice + (totalRisk * 0.5);
        recommendation = `Trade performing excellently at ${plPercentage.toFixed(1)}% of target. Consider trailing stop to ${trailingStopPrice.toFixed(5)} to secure profits.`;
      } else if (plPercentage > 50) {
        health = 'excellent';
        recommendation = `Trade is ${plPercentage.toFixed(1)}% to target profit. Momentum strong, holding position.`;
      } else if (plPercentage > 25) {
        health = 'good';
        recommendation = `Trade progressing well at ${plPercentage.toFixed(1)}% to target. Monitoring price action.`;
      } else if (plPercentage >= 0) {
        health = 'good';
        recommendation = `Trade in profit. Current P/L: $${(currentPL * trade.position_size).toFixed(2)}. Monitoring for continuation.`;
      } else if (plPercentage > -50) {
        health = 'concerning';

        const recentMomentum = await this.analyzeMomentum(candles);
        if (recentMomentum === 'against') {
          shouldEarlyExit = true;
          recommendation = `Price weakening against position. Current loss: $${Math.abs(currentPL * trade.position_size).toFixed(2)}. Consider early exit to preserve capital.`;
        } else {
          recommendation = `Trade currently in drawdown (${plPercentage.toFixed(1)}%). Monitoring for reversal or stop hit.`;
        }
      } else {
        health = 'poor';
        shouldEarlyExit = true;
        recommendation = `Significant drawdown detected. Price approaching stop loss. Early exit recommended to minimize loss.`;
      }

      return {
        tradeId: trade.id,
        health,
        currentPL: currentPL * trade.position_size,
        plPercentage,
        recommendation,
        shouldEarlyExit,
        shouldTrailStop,
        trailingStopPrice,
      };
    } catch (error) {
      console.error('Error evaluating trade health:', error);
      return this.getDefaultHealth(trade);
    }
  }

  getDefaultHealth(trade: any): TradeHealth {
    return {
      tradeId: trade.id,
      health: 'good',
      currentPL: 0,
      plPercentage: 0,
      recommendation: 'Monitoring trade...',
      shouldEarlyExit: false,
      shouldTrailStop: false,
    };
  }

  async analyzeMomentum(candles: any[]): Promise<'with' | 'against' | 'neutral'> {
    if (candles.length < 3) return 'neutral';

    const recentCandles = candles.slice(0, 3);
    const bullishCount = recentCandles.filter(c => c.close > c.open).length;

    if (bullishCount >= 2) return 'with';
    if (bullishCount === 0) return 'against';
    return 'neutral';
  }

  shouldNotifyMilestone(trade: any, plPercentage: number, milestone: number): boolean {
    const lastNotifiedMilestone = trade.last_notified_milestone || 0;
    return plPercentage >= milestone && lastNotifiedMilestone < milestone;
  }

  async sendMilestoneNotification(
    sessionId: string,
    userId: string,
    trade: any,
    milestone: number,
    health: TradeHealth
  ): Promise<void> {
    const messages = {
      25: `Trade on ${trade.symbol} is 25% to target profit. Current P/L: $${health.currentPL.toFixed(2)}.`,
      50: `Halfway there! ${trade.symbol} trade is 50% to target. Strong momentum continuing.`,
      75: `Excellent progress! ${trade.symbol} is 75% to target. Consider securing partial profits.`,
      100: `🎯 Target reached on ${trade.symbol}! Profit: $${health.currentPL.toFixed(2)}.`,
    };

    await goalSessionManager.addAIMessage(
      sessionId,
      userId,
      messages[milestone as keyof typeof messages] || `Trade milestone: ${milestone}%`,
      { trade, milestone, health },
      milestone >= 75 ? 'celebratory' : 'encouraging'
    );

    await supabase
      .from('goal_session_trades')
      .update({ last_notified_milestone: milestone })
      .eq('id', trade.id);
  }

  async createTradeFromSignal(signal: any): Promise<string | null> {
    try {
      const { data, error } = await supabase
        .from('goal_session_trades')
        .insert({
          goal_session_id: signal.sessionId,
          symbol: signal.symbol,
          direction: signal.direction,
          entry_price: signal.entryPrice,
          stop_loss: signal.stopLoss,
          take_profit: signal.takeProfit,
          position_size: signal.positionSize,
          status: 'open',
          opened_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating trade:', error);
        return null;
      }

      await goalSessionManager.transitionStatus(signal.sessionId, 'in_trade');

      return data.id;
    } catch (error) {
      console.error('Error in createTradeFromSignal:', error);
      return null;
    }
  }

  async closeTrade(
    tradeId: string,
    exitPrice: number,
    reason: string = 'target_reached'
  ): Promise<boolean> {
    try {
      const { data: trade, error: fetchError } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('id', tradeId)
        .single();

      if (fetchError || !trade) {
        console.error('Trade not found:', fetchError);
        return false;
      }

      const direction = trade.direction === 'buy' ? 1 : -1;
      const profitLoss = (exitPrice - trade.entry_price) * direction * trade.position_size;

      const { error: updateError } = await supabase
        .from('goal_session_trades')
        .update({
          status: 'closed',
          exit_price: exitPrice,
          profit_loss: profitLoss,
          closed_at: new Date().toISOString(),
        })
        .eq('id', tradeId);

      if (updateError) {
        console.error('Error closing trade:', updateError);
        return false;
      }

      const { data: session } = await supabase
        .from('goal_sessions')
        .select('user_id, current_progress, target_value, progress_percentage')
        .eq('id', trade.goal_session_id)
        .single();

      if (session) {
        await goalNotificationSystem.sendProgressNotification(
          trade.goal_session_id,
          session.user_id,
          session.current_progress,
          session.target_value,
          session.progress_percentage,
          { ...trade, profit_loss: profitLoss }
        );
      }

      return true;
    } catch (error) {
      console.error('Error in closeTrade:', error);
      return false;
    }
  }

  async getOpenTrades(sessionId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('goal_session_id', sessionId)
        .eq('status', 'open')
        .order('opened_at', { ascending: false });

      if (error) {
        console.error('Error fetching open trades:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getOpenTrades:', error);
      return [];
    }
  }

  async getClosedTrades(sessionId: string, limit: number = 20): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('goal_session_id', sessionId)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error fetching closed trades:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getClosedTrades:', error);
      return [];
    }
  }
}

export const goalTradeMonitor = new GoalTradeMonitor();
