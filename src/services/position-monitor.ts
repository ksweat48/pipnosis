import { supabase } from '@/lib/supabase';
import { positionService } from './position-service';
import { globalPollingCoordinator } from './global-polling-coordinator';
import { logger, LogCategory, LogLevel } from '@/lib/logger';
import type { GoalSessionTrade } from '@/types/position';
import { calculatePnL } from '@/types/position';
import { prodLogger } from '@/lib/production-logger';

logger.setCategoryLevel(LogCategory.POSITION_MONITOR, LogLevel.ERROR);

type MonitoredPosition = GoalSessionTrade;

class PositionMonitorService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private criticalPositionIntervalId: NodeJS.Timeout | null = null;
  private normalPositionIntervalId: NodeJS.Timeout | null = null;
  private criticalSymbols: Set<string> = new Set();
  private updateRetryCount: Map<string, number> = new Map();
  private maxRetries = 3;

  start() {
    if (this.isRunning) return;

    logger.debug(LogCategory.POSITION_MONITOR, ' Starting position monitor service with adaptive polling');
    this.isRunning = true;

    this.monitorPositions();
    this.criticalPositionIntervalId = setInterval(() => this.monitorCriticalPositions(), 2000);
    this.normalPositionIntervalId = setInterval(() => this.monitorNormalPositions(), 3000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.criticalPositionIntervalId) {
      clearInterval(this.criticalPositionIntervalId);
      this.criticalPositionIntervalId = null;
    }
    if (this.normalPositionIntervalId) {
      clearInterval(this.normalPositionIntervalId);
      this.normalPositionIntervalId = null;
    }
    this.isRunning = false;
    this.criticalSymbols.clear();
    this.updateRetryCount.clear();
    logger.debug(LogCategory.POSITION_MONITOR, ' Stopped position monitor service');
  }

  async monitorPositions() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: positions, error } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', user.id)
        .in('status', ['open', 'pending']);

      if (error) throw error;
      if (!positions || positions.length === 0) {
        this.criticalSymbols.clear();
        return;
      }

      const symbols = Array.from(new Set(positions.map(p => p.symbol)));

      symbols.forEach(symbol => {
        globalPollingCoordinator.setSymbolHasPosition(symbol, true);
      });

      this.updateCriticalSymbols(positions);
    } catch (error) {
      logger.error(LogCategory.POSITION_MONITOR, 'Error monitoring positions:', error);
    }
  }

  private updateCriticalSymbols(positions: MonitoredPosition[]): void {
    const newCriticalSymbols = new Set<string>();

    for (const position of positions) {
      if (position.status !== 'open' || !position.entry_price) continue;

      const currentPrice = position.current_price || position.entry_price;
      const distanceToSL = Math.abs(currentPrice - position.stop_loss);
      const distanceToTP = Math.abs(currentPrice - position.take_profit);
      const priceRange = Math.abs(position.take_profit - position.stop_loss);

      const isNearSLorTP = (distanceToSL / priceRange < 0.15) || (distanceToTP / priceRange < 0.15);

      if (isNearSLorTP) {
        newCriticalSymbols.add(position.symbol);
      }
    }

    this.criticalSymbols = newCriticalSymbols;
  }

  private async updatePositionWithRetry(
    positionId: string,
    currentPrice: number,
    pnl: number,
    userId: string
  ): Promise<boolean> {
    const currentRetries = this.updateRetryCount.get(positionId) || 0;

    // Direct table update with proper columns
    const { error: updateError } = await supabase
      .from('goal_session_trades')
      .update({
        current_price: currentPrice,
        current_pnl: pnl
      })
      .eq('id', positionId)
      .eq('user_id', userId);

    if (!updateError) {
      this.updateRetryCount.delete(positionId);
      return true;
    }

    console.error(`[PositionMonitor] Update failed (attempt ${currentRetries + 1}/${this.maxRetries}):`, {
      positionId,
      error: updateError
    });

    // Increment retry count
    this.updateRetryCount.set(positionId, currentRetries + 1);

    if (currentRetries >= this.maxRetries) {
      console.error(`[PositionMonitor] Max retries exceeded for position ${positionId}`);
      this.updateRetryCount.delete(positionId);
      return false;
    }

    // Exponential backoff
    const backoffMs = 1000 * (currentRetries + 1);
    await new Promise(resolve => setTimeout(resolve, backoffMs));

    return false;
  }

  private async monitorCriticalPositions(): Promise<void> {
    if (this.criticalSymbols.size === 0) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: positions, error } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'open')
        .in('symbol', Array.from(this.criticalSymbols));

      if (error) throw error;
      if (!positions || positions.length === 0) return;

      for (const position of positions) {
        await this.updatePositionWithPriority(position, 'critical');
      }
    } catch (error) {
      console.error('[PositionMonitor] Error monitoring critical positions:', error);
    }
  }

  private async monitorNormalPositions(): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: positions, error } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', user.id)
        .in('status', ['open', 'pending']);

      if (error) throw error;
      if (!positions || positions.length === 0) return;

      for (const position of positions) {
        if (position.status === 'open' && !this.criticalSymbols.has(position.symbol)) {
          await this.updatePositionWithPriority(position, 'high');
        } else if (position.status === 'pending') {
          await this.checkPendingOrderWithPriority(position, 'normal');
        }
      }
    } catch (error) {
      console.error('[PositionMonitor] Error monitoring normal positions:', error);
    }
  }

  private async updatePositionWithPriority(
    position: MonitoredPosition,
    priority: 'critical' | 'high'
  ): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('realtime_prices')
        .select('bid, ask')
        .eq('symbol', position.symbol)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        console.error(`[PositionMonitor] Failed to get price for ${position.symbol}:`, error);
        return;
      }

      const bid = parseFloat(data.bid);
      const ask = parseFloat(data.ask);
      const currentPrice = position.direction === 'buy' ? bid : ask;

      await this.updateOpenPosition(position, { bid, ask }, currentPrice);
    } catch (error) {
      console.error(`[PositionMonitor] Failed to update position for ${position.symbol}:`, error);
    }
  }

  private async checkPendingOrderWithPriority(
    order: MonitoredPosition,
    priority: 'normal'
  ): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('realtime_prices')
        .select('bid, ask')
        .eq('symbol', order.symbol)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        console.error(`[PositionMonitor] Failed to get price for ${order.symbol}:`, error);
        return;
      }

      const bid = parseFloat(data.bid);
      const ask = parseFloat(data.ask);
      await this.checkPendingOrder(order, { bid, ask });
    } catch (error) {
      console.error(`[PositionMonitor] Failed to check pending order for ${order.symbol}:`, error);
    }
  }

  private async updateOpenPosition(
    position: MonitoredPosition,
    price: { bid: number; ask: number },
    currentPrice?: number
  ) {
    if (!position.entry_price) return;

    const actualCurrentPrice = currentPrice || (position.direction === 'buy' ? price.bid : price.ask);

    const pnl = calculatePnL(
      position.direction,
      position.entry_price,
      actualCurrentPrice,
      position.lot_size || position.position_size,
      position.symbol
    );

    console.log(`[PositionMonitor] PnL Calculation for ${position.symbol}:`, {
      direction: position.direction,
      entry: position.entry_price,
      current: actualCurrentPrice,
      lotSize: position.lot_size || position.position_size,
      calculatedPnL: pnl.toFixed(2)
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.error('[PositionMonitor] No authenticated user - cannot update position');
      return;
    }

    const updateSuccess = await this.updatePositionWithRetry(
      position.id,
      actualCurrentPrice,
      pnl,
      user.id
    );

    if (!updateSuccess) {
      console.error(`[PositionMonitor] All update attempts failed for position ${position.id}`);
      return;
    }

    // CRITICAL: Check if goal is reached FIRST (before SL/TP check)
    let shouldCloseForGoal = false;
    if (position.goal_session_id) {
      const { data: goalSession } = await supabase
        .from('goal_sessions')
        .select('target_value, auto_close_on_goal, goal_achieved_at')
        .eq('id', position.goal_session_id)
        .maybeSingle();

      if (goalSession && !goalSession.goal_achieved_at && pnl >= goalSession.target_value) {
        console.log(`[PositionMonitor] 🎯 GOAL REACHED! Target: $${goalSession.target_value}, Current P&L: $${pnl.toFixed(2)}`);

        // Mark goal as met (even if auto-close is disabled, we track this)
        await supabase
          .from('goal_session_trades')
          .update({
            goal_met_at: new Date().toISOString(),
            goal_met_price: actualCurrentPrice,
            unrealized_goal_achievement: true
          })
          .eq('id', position.id);

        await supabase
          .from('goal_sessions')
          .update({
            goal_achieved_at: new Date().toISOString(),
            goal_achieved_pnl: pnl
          })
          .eq('id', position.goal_session_id);

        // Create permanent achievement record
        await supabase.from('goal_achievements').insert({
          user_id: user.id,
          goal_session_id: position.goal_session_id,
          achieved_pnl: pnl,
          target_amount: goalSession.target_value,
          trade_id: position.id,
          symbol: position.symbol,
          entry_price: position.entry_price,
          current_price_at_achievement: actualCurrentPrice,
          take_profit: position.take_profit,
          stop_loss_before: position.stop_loss
        });

        if (goalSession.auto_close_on_goal !== false) {
          console.log(`[PositionMonitor] Auto-close enabled - closing position at goal`);
          shouldCloseForGoal = true;
        }
      }
    }

    if (shouldCloseForGoal) {
      await this.autoClosePosition(position, actualCurrentPrice, 'goal_met');
      return;
    }

    const shouldCloseAtStopLoss = position.direction === 'buy'
      ? actualCurrentPrice <= position.stop_loss
      : actualCurrentPrice >= position.stop_loss;

    const shouldCloseAtTakeProfit = position.direction === 'buy'
      ? actualCurrentPrice >= position.take_profit
      : actualCurrentPrice <= position.take_profit;

    if (shouldCloseAtStopLoss) {
      await this.autoClosePosition(position, actualCurrentPrice, 'stop_loss');
    } else if (shouldCloseAtTakeProfit) {
      await this.autoClosePosition(position, actualCurrentPrice, 'take_profit');
    }
  }

  private async checkPendingOrder(
    order: MonitoredPosition,
    price: { bid: number; ask: number }
  ) {
    if (!order.limit_price) return;

    let shouldFill = false;

    if (order.direction === 'buy') {
      shouldFill = price.ask <= order.limit_price;
    } else {
      shouldFill = price.bid >= order.limit_price;
    }

    if (shouldFill) {
      await this.fillPendingOrder(order, order.limit_price);
    }
  }

  private async fillPendingOrder(order: MonitoredPosition, fillPrice: number) {
    try {
      logger.debug(LogCategory.POSITION_MONITOR, ` Filling pending order ${order.id} at ${fillPrice}`);

      await supabase
        .from('goal_session_trades')
        .update({
          status: 'open',
          entry_price: fillPrice,
          current_price: fillPrice,
          current_pnl: 0,
          opened_at: new Date().toISOString()
        })
        .eq('id', order.id);

      logger.debug(LogCategory.POSITION_MONITOR, ` Order ${order.id} filled successfully`);
    } catch (error) {
      console.error(`[PositionMonitor] Failed to fill order ${order.id}:`, error);
    }
  }

  private async autoClosePosition(
    position: MonitoredPosition,
    closePrice: number,
    reason: 'stop_loss' | 'take_profit' | 'goal_met'
  ) {
    try {
      // Use the secure RPC function to close
      const result = await positionService.closePosition(position.id, closePrice, reason);

      if (result.success && result.pnl !== undefined) {
        const displayReason = reason === 'stop_loss' ? 'SL' : reason === 'take_profit' ? 'TP' : 'GOAL MET';
        prodLogger.position(
          `AUTO-CLOSED (${displayReason})`,
          position.symbol,
          result.pnl
        );

        // Send notification for all close types
        const notificationConfig = {
          goal_met: {
            type: 'goal_achieved' as const,
            priority: 'urgent' as const,
            title: '🎯 Goal Achieved!',
            message: `Your goal has been reached! Trade closed at $${result.pnl.toFixed(2)} profit.`
          },
          take_profit: {
            type: 'trade_closed' as const,
            priority: 'high' as const,
            title: '✅ Take Profit Hit!',
            message: `Trade on ${position.symbol} closed at take profit. Profit: $${result.pnl.toFixed(2)}`
          },
          stop_loss: {
            type: 'trade_closed' as const,
            priority: 'urgent' as const,
            title: '⚠️ Stop Loss Hit',
            message: `Trade on ${position.symbol} closed at stop loss. Loss: $${result.pnl.toFixed(2)}`
          }
        };

        const config = notificationConfig[reason];
        if (config) {
          await supabase.from('goal_notifications').insert({
            goal_session_id: position.goal_session_id,
            user_id: position.user_id,
            notification_type: config.type,
            priority: config.priority,
            title: config.title,
            message: config.message,
            notification_data: {
              trade_id: position.id,
              symbol: position.symbol,
              direction: position.direction,
              entry_price: position.entry_price,
              exit_price: closePrice,
              profit_loss: result.pnl,
              close_reason: reason
            },
            channels: ['in_app']
          });
        }
      }

      // Update goal session status if no more open trades
      const { data: otherTrades } = await supabase
        .from('goal_session_trades')
        .select('id')
        .eq('goal_session_id', position.goal_session_id)
        .eq('status', 'open');

      if (!otherTrades || otherTrades.length === 0) {
        const newStatus = reason === 'goal_met' ? 'goal_achieved' : 'scanning';
        await supabase
          .from('goal_sessions')
          .update({ status: newStatus })
          .eq('id', position.goal_session_id);
      }
    } catch (error) {
      console.error(`[PositionMonitor] Failed to auto-close position ${position.id}:`, error);
    }
  }
}

export const positionMonitorService = new PositionMonitorService();
