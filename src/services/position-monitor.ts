import { supabase } from '@/lib/supabase';
import { simulatedTradingService } from './simulated-trading';

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

  start() {
    if (this.isRunning) return;

    console.log('[PositionMonitor] Starting position monitor service');
    this.isRunning = true;
    this.monitorPositions();
    this.intervalId = setInterval(() => this.monitorPositions(), 2000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
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
      if (!positions || positions.length === 0) return;

      const symbols = Array.from(new Set(positions.map(p => p.symbol)));
      const prices = await this.fetchPricesForSymbols(symbols);

      for (const position of positions) {
        const price = prices[position.symbol];
        if (!price) continue;

        if (position.status === 'open') {
          await this.updateOpenPosition(position, price);
        } else if (position.status === 'pending') {
          await this.checkPendingOrder(position, price);
        }
      }
    } catch (error) {
      console.error('[PositionMonitor] Error monitoring positions:', error);
    }
  }

  private async fetchPricesForSymbols(symbols: string[]): Promise<Record<string, { bid: number; ask: number }>> {
    const prices: Record<string, { bid: number; ask: number }> = {};

    await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const response = await fetch(`/.netlify/functions/get-live-price?symbol=${symbol}`);
          const data = await response.json();

          if (data.ok && data.bid && data.ask) {
            prices[symbol] = {
              bid: parseFloat(data.bid),
              ask: parseFloat(data.ask)
            };
          }
        } catch (error) {
          console.error(`[PositionMonitor] Failed to fetch price for ${symbol}:`, error);
        }
      })
    );

    return prices;
  }

  private async updateOpenPosition(
    position: MonitoredPosition,
    price: { bid: number; ask: number }
  ) {
    if (!position.entry_price) return;

    const currentPrice = position.position_type === 'buy' ? price.bid : price.ask;

    const pnl = simulatedTradingService.calculatePnL(
      position.position_type,
      position.entry_price,
      currentPrice,
      position.lot_size,
      position.symbol
    );

    await supabase
      .from('simulated_positions')
      .update({
        current_price: currentPrice,
        current_pnl: pnl
      })
      .eq('id', position.id);

    const shouldCloseAtStopLoss = position.position_type === 'buy'
      ? currentPrice <= position.stop_loss
      : currentPrice >= position.stop_loss;

    const shouldCloseAtTakeProfit = position.position_type === 'buy'
      ? currentPrice >= position.take_profit
      : currentPrice <= position.take_profit;

    if (shouldCloseAtStopLoss) {
      await this.autoClosePosition(position, currentPrice, 'stop_loss');
    } else if (shouldCloseAtTakeProfit) {
      await this.autoClosePosition(position, currentPrice, 'take_profit');
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

      console.log(`[PositionMonitor] Position ${position.id} closed with P&L: $${pnl.toFixed(2)}`);
    } catch (error) {
      console.error(`[PositionMonitor] Failed to auto-close position ${position.id}:`, error);
    }
  }
}

export const positionMonitorService = new PositionMonitorService();
