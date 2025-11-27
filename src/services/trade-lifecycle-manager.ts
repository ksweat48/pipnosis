import { supabase } from '../lib/supabase';
import { goalSessionManager } from './goal-session-manager';

export interface PriceUpdate {
  symbol: string;
  bid: number;
  ask: number;
  timestamp: Date;
}

class TradeLifecycleManager {
  private monitoringInterval: number | null = null;
  private isMonitoring: boolean = false;

  async startMonitoring(intervalMs: number = 5000): void {
    if (this.isMonitoring) {
      console.log('[Trade Lifecycle] Already monitoring');
      return;
    }

    this.isMonitoring = true;
    console.log('[Trade Lifecycle] Starting trade monitoring...');

    this.monitorOpenTrades();

    this.monitoringInterval = window.setInterval(() => {
      this.monitorOpenTrades();
    }, intervalMs);
  }

  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      this.isMonitoring = false;
      console.log('[Trade Lifecycle] Stopped monitoring');
    }
  }

  async monitorOpenTrades(): Promise<void> {
    try {
      const { data: openTrades, error } = await supabase
        .from('goal_session_trades')
        .select('*, goal_sessions!inner(user_id, auto_execute)')
        .eq('status', 'open');

      if (error) {
        console.error('[Trade Lifecycle] Error fetching open trades:', error);
        return;
      }

      if (!openTrades || openTrades.length === 0) {
        return;
      }

      console.log(`[Trade Lifecycle] Monitoring ${openTrades.length} open trade(s)`);

      for (const trade of openTrades) {
        await this.checkTradeTargets(trade);
      }
    } catch (error) {
      console.error('[Trade Lifecycle] Error monitoring trades:', error);
    }
  }

  async checkTradeTargets(trade: any): Promise<void> {
    try {
      const currentPrice = await this.getCurrentPrice(trade.symbol);
      if (!currentPrice) {
        console.warn(`[Trade Lifecycle] No price data for ${trade.symbol}`);
        return;
      }

      const price = trade.direction === 'buy' ? currentPrice.bid : currentPrice.ask;

      let shouldClose = false;
      let closeReason = '';
      let profitLoss = 0;

      // Calculate current P&L using proper dollar per pip calculation
      const { calculateDollarPerPip, calculatePipDistance } = await import('../utils/currencyHelpers');
      const pipDistance = calculatePipDistance(trade.symbol, trade.entry_price, price);
      const dollarPerPip = calculateDollarPerPip(trade.symbol, trade.position_size);
      const unrealizedPnL = trade.direction === 'buy'
        ? pipDistance * dollarPerPip
        : -pipDistance * dollarPerPip;

      // CRITICAL: Check goal completion FIRST
      if (trade.goal_session_id) {
        const { data: goalSession } = await supabase
          .from('goal_sessions')
          .select('target_amount, starting_balance, auto_close_on_goal')
          .eq('id', trade.goal_session_id)
          .maybeSingle();

        if (goalSession && unrealizedPnL >= goalSession.target_amount) {
          const autoClose = goalSession.auto_close_on_goal !== false; // Default to true

          if (autoClose) {
            console.log(`[Trade Lifecycle] 🎯 GOAL REACHED! Target: $${goalSession.target_amount}, Current P&L: $${unrealizedPnL.toFixed(2)}`);
            console.log(`[Trade Lifecycle] Auto-closing position to lock in profits...`);

            shouldClose = true;
            closeReason = 'Goal target reached';
            profitLoss = unrealizedPnL;

            // Mark goal session as completed
            await supabase
              .from('goal_sessions')
              .update({
                status: 'completed',
                actual_profit: profitLoss,
                completed_at: new Date().toISOString()
              })
              .eq('id', trade.goal_session_id);
          } else {
            console.log(`[Trade Lifecycle] 🎯 Goal reached but auto-close disabled. Continuing to monitor...`);
          }
        }
      }

      // Check SL/TP only if goal completion didn't trigger close
      if (!shouldClose) {
        if (trade.direction === 'buy') {
          if (price <= trade.stop_loss) {
            shouldClose = true;
            closeReason = 'Stop loss hit';
            profitLoss = (trade.stop_loss - trade.entry_price) * dollarPerPip / calculatePipDistance(trade.symbol, trade.entry_price, trade.stop_loss);
          } else if (price >= trade.take_profit) {
            shouldClose = true;
            closeReason = 'Take profit hit';
            profitLoss = (trade.take_profit - trade.entry_price) * dollarPerPip / calculatePipDistance(trade.symbol, trade.entry_price, trade.take_profit);
          }
        } else {
          if (price >= trade.stop_loss) {
            shouldClose = true;
            closeReason = 'Stop loss hit';
            profitLoss = (trade.entry_price - trade.stop_loss) * dollarPerPip / calculatePipDistance(trade.symbol, trade.entry_price, trade.stop_loss);
          } else if (price <= trade.take_profit) {
            shouldClose = true;
            closeReason = 'Take profit hit';
            profitLoss = (trade.entry_price - trade.take_profit) * dollarPerPip / calculatePipDistance(trade.symbol, trade.entry_price, trade.take_profit);
          }
        }
      }

      if (shouldClose) {
        await this.closeTrade(trade, price, profitLoss, closeReason);
      }
    } catch (error) {
      console.error(`[Trade Lifecycle] Error checking targets for trade ${trade.id}:`, error);
    }
  }

  async getCurrentPrice(symbol: string): Promise<PriceUpdate | null> {
    try {
      const { data, error } = await supabase
        .from('realtime_prices')
        .select('symbol, bid, ask, timestamp')
        .eq('symbol', symbol)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        const { data: candleData } = await supabase
          .from('forex_candles')
          .select('symbol, close, open_time')
          .eq('symbol', symbol)
          .order('open_time', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (candleData) {
          return {
            symbol: candleData.symbol,
            bid: parseFloat(candleData.close),
            ask: parseFloat(candleData.close),
            timestamp: new Date(candleData.timestamp)
          };
        }

        return null;
      }

      return {
        symbol: data.symbol,
        bid: parseFloat(data.bid),
        ask: parseFloat(data.ask),
        timestamp: new Date(data.timestamp)
      };
    } catch (error) {
      console.error(`[Trade Lifecycle] Error getting price for ${symbol}:`, error);
      return null;
    }
  }

  async closeTrade(
    trade: any,
    exitPrice: number,
    profitLoss: number,
    reason: string
  ): Promise<void> {
    try {
      console.log(`[Trade Lifecycle] Closing trade ${trade.id} on ${trade.symbol}: ${reason}`);

      const { error: updateError } = await supabase
        .from('goal_session_trades')
        .update({
          status: 'closed',
          exit_price: exitPrice,
          profit_loss: profitLoss,
          closed_at: new Date().toISOString()
        })
        .eq('id', trade.id);

      if (updateError) {
        console.error('[Trade Lifecycle] Failed to update trade:', updateError);
        return;
      }

      const userId = trade.goal_sessions.user_id;
      const isProfit = profitLoss > 0;

      await goalSessionManager.addAIMessage(
        trade.goal_session_id,
        userId,
        `Trade on ${trade.symbol} closed! ${reason}. ${trade.direction.toUpperCase()} position exited at ${exitPrice.toFixed(5)}. ${isProfit ? 'Profit' : 'Loss'}: $${Math.abs(profitLoss).toFixed(2)}. Entry was ${trade.entry_price.toFixed(5)}.`,
        { trade, exitPrice, profitLoss, reason },
        isProfit ? 'celebratory' : 'neutral'
      );

      await supabase.from('goal_notifications').insert({
        goal_session_id: trade.goal_session_id,
        user_id: userId,
        notification_type: 'progress',
        priority: isProfit ? 'high' : 'medium',
        title: `Trade Closed: ${trade.symbol}`,
        message: `${reason}. ${isProfit ? 'Profit' : 'Loss'}: $${Math.abs(profitLoss).toFixed(2)}`,
        data: { trade, exitPrice, profitLoss, reason },
        channels: ['in_app', 'email']
      });

      const { data: otherOpenTrades } = await supabase
        .from('goal_session_trades')
        .select('id')
        .eq('goal_session_id', trade.goal_session_id)
        .eq('status', 'open');

      if (!otherOpenTrades || otherOpenTrades.length === 0) {
        await supabase
          .from('goal_sessions')
          .update({ status: 'scanning' })
          .eq('id', trade.goal_session_id);
      }

      console.log(`[Trade Lifecycle] Trade ${trade.id} closed successfully`);
    } catch (error) {
      console.error('[Trade Lifecycle] Error closing trade:', error);
    }
  }

  async manualCloseTrade(
    tradeId: string,
    userId: string,
    reason: string = 'Manual close by user'
  ): Promise<{ success: boolean; message: string }> {
    try {
      const { data: trade, error: fetchError } = await supabase
        .from('goal_session_trades')
        .select('*, goal_sessions!inner(user_id)')
        .eq('id', tradeId)
        .eq('goal_sessions.user_id', userId)
        .single();

      if (fetchError || !trade) {
        return { success: false, message: 'Trade not found' };
      }

      if (trade.status !== 'open') {
        return { success: false, message: `Trade is ${trade.status}, cannot close` };
      }

      const currentPrice = await this.getCurrentPrice(trade.symbol);
      if (!currentPrice) {
        return { success: false, message: 'Could not get current price' };
      }

      const exitPrice = trade.direction === 'buy' ? currentPrice.bid : currentPrice.ask;
      const profitLoss = trade.direction === 'buy'
        ? (exitPrice - trade.entry_price) * trade.position_size
        : (trade.entry_price - exitPrice) * trade.position_size;

      await this.closeTrade(trade, exitPrice, profitLoss, reason);

      return {
        success: true,
        message: `Trade closed at ${exitPrice.toFixed(5)}. ${profitLoss >= 0 ? 'Profit' : 'Loss'}: $${Math.abs(profitLoss).toFixed(2)}`
      };
    } catch (error) {
      console.error('[Trade Lifecycle] Error in manual close:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async getOpenTrades(userId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('goal_session_trades')
        .select('*, goal_sessions!inner(user_id)')
        .eq('goal_sessions.user_id', userId)
        .eq('status', 'open')
        .order('opened_at', { ascending: false });

      if (error) {
        console.error('[Trade Lifecycle] Error fetching open trades:', error);
        return [];
      }

      const tradesWithPrices = await Promise.all(
        (data || []).map(async (trade) => {
          const currentPrice = await this.getCurrentPrice(trade.symbol);
          const price = currentPrice ? (trade.direction === 'buy' ? currentPrice.bid : currentPrice.ask) : trade.entry_price;
          const unrealizedPL = trade.direction === 'buy'
            ? (price - trade.entry_price) * trade.position_size
            : (trade.entry_price - price) * trade.position_size;

          return {
            ...trade,
            current_price: price,
            unrealized_pl: unrealizedPL
          };
        })
      );

      return tradesWithPrices;
    } catch (error) {
      console.error('[Trade Lifecycle] Error getting open trades:', error);
      return [];
    }
  }
}

export const tradeLifecycleManager = new TradeLifecycleManager();
