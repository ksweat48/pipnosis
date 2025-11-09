import { supabase } from '@/lib/supabase';
import { simulatedTradingService } from './simulated-trading';
import { smartRequestQueue } from './smart-request-queue';
import { globalPollingCoordinator } from './global-polling-coordinator';

interface MonitoredPosition {
  id: string;
  user_id: string;
  symbol: string;
  position_type: 'buy' | 'sell';
  order_type: 'market' | 'limit';
  entry_price: number | null;
  limit_price: number | null;
  stop_loss: number;
  take_profit: number;
  status: 'pending' | 'open' | 'closed';
  lot_size: number;
}

class PositionMonitorService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private criticalPositionIntervalId: NodeJS.Timeout | null = null;
  private normalPositionIntervalId: NodeJS.Timeout | null = null;
  private criticalSymbols: Set<string> = new Set();

  start() {
    if (this.isRunning) return;

    console.log('[PositionMonitor] Starting position monitor service with adaptive polling');
    this.isRunning = true;

    this.monitorPositions();
    this.criticalPositionIntervalId = setInterval(() => this.monitorCriticalPositions(), 500);
    this.normalPositionIntervalId = setInterval(() => this.monitorNormalPositions(), 2000);
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
    console.log('[PositionMonitor] Stopped position monitor service');
  }

  async monitorPositions() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: positions, error } = await supabase
        .from('simulated_positions')
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
      console.error('[PositionMonitor] Error monitoring positions:', error);
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

  private async monitorCriticalPositions(): Promise<void> {
    if (this.criticalSymbols.size === 0) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: positions, error } = await supabase
        .from('simulated_positions')
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
        .from('simulated_positions')
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
      const priceData = await smartRequestQueue.requestPrice(position.symbol, priority);
      const currentPrice = position.position_type === 'buy' ? priceData.bid : priceData.ask;

      await this.updateOpenPosition(position, { bid: priceData.bid, ask: priceData.ask }, currentPrice);
    } catch (error) {
      console.error(`[PositionMonitor] Failed to update position for ${position.symbol}:`, error);
    }
  }

  private async checkPendingOrderWithPriority(
    order: MonitoredPosition,
    priority: 'normal'
  ): Promise<void> {
    try {
      const priceData = await smartRequestQueue.requestPrice(order.symbol, priority);
      await this.checkPendingOrder(order, { bid: priceData.bid, ask: priceData.ask });
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

    const actualCurrentPrice = currentPrice || (position.position_type === 'buy' ? price.bid : price.ask);

    const pnl = simulatedTradingService.calculatePnL(
      position.position_type,
      position.entry_price,
      actualCurrentPrice,
      position.lot_size,
      position.symbol
    );

    await supabase
      .from('simulated_positions')
      .update({
        current_price: actualCurrentPrice,
        current_pnl: pnl
      })
      .eq('id', position.id);

    const shouldCloseAtStopLoss = position.position_type === 'buy'
      ? actualCurrentPrice <= position.stop_loss
      : actualCurrentPrice >= position.stop_loss;

    const shouldCloseAtTakeProfit = position.position_type === 'buy'
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

    if (order.position_type === 'buy') {
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
      console.log(`[PositionMonitor] Filling pending order ${order.id} at ${fillPrice}`);

      await supabase
        .from('simulated_positions')
        .update({
          status: 'open',
          entry_price: fillPrice,
          current_price: fillPrice,
          current_pnl: 0,
          opened_at: new Date().toISOString()
        })
        .eq('id', order.id);

      await supabase
        .from('balance_transactions')
        .insert({
          user_id: order.user_id,
          transaction_type: 'margin_reserve',
          amount: -order.lot_size * 1000,
          balance_before: 0,
          balance_after: 0,
          position_id: order.id,
          description: `Limit order filled: ${order.position_type} ${order.symbol} ${order.lot_size} lots at ${fillPrice}`
        });

      console.log(`[PositionMonitor] Order ${order.id} filled successfully`);
    } catch (error) {
      console.error(`[PositionMonitor] Failed to fill order ${order.id}:`, error);
    }
  }

  private async autoClosePosition(
    position: MonitoredPosition,
    closePrice: number,
    reason: 'stop_loss' | 'take_profit'
  ) {
    try {
      console.log(`[PositionMonitor] Auto-closing position ${position.id} due to ${reason}`);

      const pnl = simulatedTradingService.calculatePnL(
        position.position_type,
        position.entry_price!,
        closePrice,
        position.lot_size,
        position.symbol
      );

      await supabase
        .from('simulated_positions')
        .update({
          status: 'closed',
          current_price: closePrice,
          current_pnl: pnl,
          closed_at: new Date().toISOString(),
          close_reason: reason
        })
        .eq('id', position.id);

      const { data: goalTrade } = await supabase
        .from('goal_session_trades')
        .select('id, goal_session_id')
        .eq('simulated_position_id', position.id)
        .eq('status', 'open')
        .maybeSingle();

      if (goalTrade) {
        console.log(`[PositionMonitor] Syncing closure to goal_session_trade ${goalTrade.id}`);
        await supabase
          .from('goal_session_trades')
          .update({
            status: 'closed',
            exit_price: closePrice,
            profit_loss: pnl,
            closed_at: new Date().toISOString()
          })
          .eq('id', goalTrade.id);

        const { data: otherTrades } = await supabase
          .from('goal_session_trades')
          .select('id')
          .eq('goal_session_id', goalTrade.goal_session_id)
          .eq('status', 'open');

        if (!otherTrades || otherTrades.length === 0) {
          await supabase
            .from('goal_sessions')
            .update({ status: 'scanning' })
            .eq('id', goalTrade.goal_session_id);
        }
      }

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('demo_balance')
        .eq('id', position.user_id)
        .single();

      const currentBalance = parseFloat(profile?.demo_balance || '10000');
      const newBalance = currentBalance + pnl;

      await supabase
        .from('user_profiles')
        .update({ demo_balance: newBalance })
        .eq('id', position.user_id);

      await supabase
        .from('balance_transactions')
        .insert({
          user_id: position.user_id,
          transaction_type: 'trade_pnl',
          amount: pnl,
          balance_before: currentBalance,
          balance_after: newBalance,
          position_id: position.id,
          description: `Position auto-closed (${reason}): ${position.symbol} ${position.position_type} ${position.lot_size} lots`
        });

      // Record trade in history for AI learning
      await supabase
        .from('trade_history')
        .insert({
          user_id: position.user_id,
          position_id: position.id,
          symbol: position.symbol,
          position_type: position.position_type,
          lot_size: position.lot_size,
          entry_price: position.entry_price!,
          exit_price: closePrice,
          stop_loss: position.stop_loss,
          take_profit: position.take_profit,
          profit_loss: pnl,
          opened_at: position.opened_at,
          closed_at: new Date().toISOString(),
          close_reason: reason,
          strategy_name: (position as any).strategy_name || null,
          confidence_score: (position as any).confidence_score || 75,
          setup_type: (position as any).setup_type || 'Auto-closed position',
          market_conditions: (position as any).market_conditions || {},
          ai_decision_id: (position as any).ai_decision_id || null,
          ai_analyzed: false
        });

      console.log(`[PositionMonitor] Position ${position.id} closed with P&L: $${pnl.toFixed(2)}`);
    } catch (error) {
      console.error(`[PositionMonitor] Failed to auto-close position ${position.id}:`, error);
    }
  }
}

export const positionMonitorService = new PositionMonitorService();
