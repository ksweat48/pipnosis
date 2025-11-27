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
          .select('target_amount, starting_balance, auto_close_on_goal, goal_achieved_at, user_id')
          .eq('id', trade.goal_session_id)
          .maybeSingle();

        if (goalSession && unrealizedPnL >= goalSession.target_amount) {
          // Check if we've already notified about this goal achievement
          if (!goalSession.goal_achieved_at) {
            console.log(`[Trade Lifecycle] 🎯 GOAL ACHIEVED! Target: $${goalSession.target_amount}, Current: $${unrealizedPnL.toFixed(2)}`);

            // Mark goal as achieved (PERMANENT WIN)
            await supabase
              .from('goal_sessions')
              .update({
                goal_achieved_at: new Date().toISOString(),
                goal_achieved_pnl: unrealizedPnL,
                status: 'goal_achieved'
              })
              .eq('id', trade.goal_session_id);

            // Create permanent achievement record
            const { data: achievement } = await supabase
              .from('goal_achievements')
              .insert({
                user_id: goalSession.user_id,
                goal_session_id: trade.goal_session_id,
                achieved_pnl: unrealizedPnL,
                target_amount: goalSession.target_amount,
                trade_id: trade.id,
                symbol: trade.symbol,
                entry_price: trade.entry_price,
                current_price_at_achievement: price,
                take_profit: trade.take_profit,
                stop_loss_before: trade.stop_loss
              })
              .select()
              .single();

            console.log(`[Trade Lifecycle] ✅ Goal logged as PERMANENT WIN in database`);

            // Check if auto-close is enabled
            if (goalSession.auto_close_on_goal === true) {
              console.log(`[Trade Lifecycle] Auto-close enabled - closing position now`);
              shouldClose = true;
              closeReason = 'Goal target reached (auto-close)';
              profitLoss = unrealizedPnL;
            } else {
              // Create notification with action buttons
              await this.createGoalAchievedNotification(
                goalSession.user_id,
                trade.goal_session_id,
                trade,
                unrealizedPnL,
                goalSession.target_amount,
                price,
                achievement?.id
              );

              console.log(`[Trade Lifecycle] 📬 Notification sent to user with action choices`);
            }
          } else {
            // Goal already achieved, check if we need to take default action
            await this.checkDefaultAction(trade, goalSession, unrealizedPnL);
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

  async createGoalAchievedNotification(
    userId: string,
    goalSessionId: string,
    trade: any,
    currentPnL: number,
    targetAmount: number,
    currentPrice: number,
    achievementId?: string
  ): Promise<void> {
    try {
      const { calculatePipDistance } = await import('../utils/currencyHelpers');

      // Calculate potential additional profit to TP
      const tpDistance = calculatePipDistance(trade.symbol, currentPrice, trade.take_profit);
      const tpPotential = currentPnL * (Math.abs(trade.take_profit - trade.entry_price) / Math.abs(currentPrice - trade.entry_price));

      // Calculate breakeven and safety prices
      const breakevenPrice = trade.entry_price;
      const safetyPips = calculatePipDistance(trade.symbol, trade.entry_price, currentPrice) * 0.5;
      const safetyPrice = trade.direction === 'buy'
        ? trade.entry_price + (safetyPips * 0.01)
        : trade.entry_price - (safetyPips * 0.01);

      const notification = {
        user_id: userId,
        goal_session_id: goalSessionId,
        notification_type: 'goal_achieved',
        priority: 'high',
        title: '🎯 Goal Achieved!',
        message: `Congratulations! Your $${targetAmount} goal has been reached with current P&L of $${currentPnL.toFixed(2)}. This win is now permanently logged. What would you like to do?`,
        data: {
          achievement_id: achievementId,
          trade_id: trade.id,
          symbol: trade.symbol,
          current_pnl: currentPnL,
          target_amount: targetAmount,
          entry_price: trade.entry_price,
          current_price: currentPrice,
          take_profit: trade.take_profit,
          stop_loss: trade.stop_loss,
          tp_potential: tpPotential,
          breakeven_price: breakevenPrice,
          safety_price: safetyPrice
        },
        actions: [
          {
            id: 'close_now',
            label: `Close Now - Lock $${currentPnL.toFixed(0)}`,
            description: 'Exit immediately and secure your profit',
            icon: '💰'
          },
          {
            id: 'continue_breakeven',
            label: `Continue to TP ($${tpPotential.toFixed(0)}) - Breakeven Protection`,
            description: `Move stop loss to entry (${breakevenPrice.toFixed(5)}). Worst case: $0, Best case: $${tpPotential.toFixed(0)}`,
            icon: '🛡️'
          },
          {
            id: 'continue_safety',
            label: `Continue to TP ($${tpPotential.toFixed(0)}) - Lock 50%`,
            description: `Move stop loss to ${safetyPrice.toFixed(5)}. Worst case: Keep $${(currentPnL * 0.5).toFixed(0)}, Best case: $${tpPotential.toFixed(0)}`,
            icon: '⚡'
          }
        ],
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 minutes
      };

      await supabase
        .from('goal_notifications')
        .insert(notification);

      console.log(`[Trade Lifecycle] ✅ Created goal achievement notification for user ${userId}`);
    } catch (error) {
      console.error('[Trade Lifecycle] Error creating goal achievement notification:', error);
    }
  }

  async checkDefaultAction(trade: any, goalSession: any, currentPnL: number): Promise<void> {
    try {
      // Check if user has made a choice
      if (goalSession.user_choice) {
        return; // User already chose, nothing to do
      }

      // Check if notification has expired (5 minutes)
      const achievedAt = new Date(goalSession.goal_achieved_at);
      const now = new Date();
      const minutesElapsed = (now.getTime() - achievedAt.getTime()) / (1000 * 60);

      if (minutesElapsed >= 5) {
        console.log(`[Trade Lifecycle] ⏱️  No response after 5 minutes - applying default breakeven protection`);

        // Default action: Move SL to breakeven
        await this.moveStopLossToBreakeven(trade, goalSession);

        // Update goal session
        await supabase
          .from('goal_sessions')
          .update({
            user_choice: 'default_breakeven'
          })
          .eq('id', goalSession.id);

        // Send notification about auto-action
        await supabase
          .from('goal_notifications')
          .insert({
            user_id: goalSession.user_id,
            goal_session_id: goalSession.id,
            notification_type: 'auto_action_taken',
            priority: 'medium',
            title: '🛡️ Breakeven Protection Applied',
            message: 'No action was taken within 5 minutes, so we automatically moved your stop loss to breakeven to protect your profits.',
            data: {
              trade_id: trade.id,
              new_stop_loss: trade.entry_price,
              action: 'default_breakeven'
            }
          });
      }

      // Check if P&L is fading
      if (currentPnL < goalSession.goal_achieved_pnl * 0.75) {
        console.log(`[Trade Lifecycle] ⚠️  Profit fading! Was $${goalSession.goal_achieved_pnl}, now $${currentPnL.toFixed(2)}`);

        // Send urgent notification
        await supabase
          .from('goal_notifications')
          .insert({
            user_id: goalSession.user_id,
            goal_session_id: goalSession.id,
            notification_type: 'goal_fading',
            priority: 'urgent',
            title: '⚠️ Profit Fading!',
            message: `Your profit has dropped from $${goalSession.goal_achieved_pnl.toFixed(2)} to $${currentPnL.toFixed(2)}. Consider closing or protecting your position!`,
            data: {
              trade_id: trade.id,
              peak_pnl: goalSession.goal_achieved_pnl,
              current_pnl: currentPnL,
              fade_percentage: ((1 - currentPnL / goalSession.goal_achieved_pnl) * 100).toFixed(1)
            }
          });
      }
    } catch (error) {
      console.error('[Trade Lifecycle] Error checking default action:', error);
    }
  }

  async moveStopLossToBreakeven(trade: any, goalSession: any): Promise<void> {
    try {
      const breakevenPrice = trade.entry_price;

      console.log(`[Trade Lifecycle] Moving SL to breakeven: ${trade.stop_loss} → ${breakevenPrice}`);

      await supabase
        .from('goal_session_trades')
        .update({
          stop_loss: breakevenPrice
        })
        .eq('id', trade.id);

      // Update achievement record
      await supabase
        .from('goal_achievements')
        .update({
          stop_loss_after: breakevenPrice,
          user_choice: 'default_breakeven',
          choice_made_at: new Date().toISOString()
        })
        .eq('goal_session_id', goalSession.id);

      console.log(`[Trade Lifecycle] ✅ Stop loss moved to breakeven successfully`);
    } catch (error) {
      console.error('[Trade Lifecycle] Error moving stop loss to breakeven:', error);
    }
  }
}

export const tradeLifecycleManager = new TradeLifecycleManager();
