/**
 * Realtime SL/TP Monitor
 *
 * EVENT-DRIVEN stop loss and take profit monitoring using Supabase Realtime.
 * This eliminates polling delays by listening to realtime_prices table changes.
 *
 * CRITICAL: This is a backup/redundant system alongside position-monitor.
 * Both systems check SL/TP independently for maximum reliability.
 *
 * Architecture:
 * - Subscribes to realtime_prices table for INSERT events
 * - When new price arrives, immediately checks ALL open positions for that symbol
 * - Triggers closure if SL/TP is hit
 * - Sub-second response time (vs 250ms-1000ms polling)
 */

import { supabase } from '@/lib/supabase';
import { tradeClosureCoordinator } from './coordinators/trade-closure-coordinator';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface OpenPosition {
  id: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  user_id: string;
  goal_session_id: string;
  status: string;
}

class RealtimeSLTPMonitor {
  private channel: RealtimeChannel | null = null;
  private openPositions: Map<string, OpenPosition[]> = new Map(); // symbol -> positions
  private isRunning = false;
  private lastCheckTime: Map<string, number> = new Map(); // tradeId -> timestamp
  private minCheckIntervalMs = 100; // Prevent duplicate checks within 100ms

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[RealtimeSLTPMonitor] Already running');
      return;
    }

    console.log('[RealtimeSLTPMonitor] 🚀 Starting event-driven SL/TP monitoring...');
    this.isRunning = true;

    // Load current open positions
    await this.refreshOpenPositions();

    // Subscribe to realtime_prices INSERT events
    this.channel = supabase
      .channel('realtime-sltp-monitor')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'realtime_prices'
        },
        (payload) => {
          this.handlePriceUpdate(payload.new as any);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[RealtimeSLTPMonitor] ✅ Subscribed to realtime_prices updates');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[RealtimeSLTPMonitor] ❌ Subscription error');
        }
      });

    // Refresh open positions every 5 seconds (catch new trades)
    setInterval(() => this.refreshOpenPositions(), 5000);
  }

  stop(): void {
    if (!this.isRunning) return;

    console.log('[RealtimeSLTPMonitor] Stopping...');
    this.isRunning = false;

    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }

    this.openPositions.clear();
    this.lastCheckTime.clear();
  }

  private async refreshOpenPositions(): Promise<void> {
    try {
      const { data: positions, error } = await supabase
        .from('goal_session_trades')
        .select('id, symbol, direction, entry_price, stop_loss, take_profit, user_id, goal_session_id, status')
        .eq('status', 'open');

      if (error) {
        console.error('[RealtimeSLTPMonitor] Error fetching positions:', error);
        return;
      }

      if (!positions || positions.length === 0) {
        this.openPositions.clear();
        return;
      }

      // Group by symbol
      const positionsBySymbol = new Map<string, OpenPosition[]>();
      for (const pos of positions) {
        if (!positionsBySymbol.has(pos.symbol)) {
          positionsBySymbol.set(pos.symbol, []);
        }
        positionsBySymbol.get(pos.symbol)!.push(pos as OpenPosition);
      }

      this.openPositions = positionsBySymbol;

      const totalPositions = positions.length;
      const symbols = Array.from(positionsBySymbol.keys());
      console.log(`[RealtimeSLTPMonitor] Monitoring ${totalPositions} positions across ${symbols.length} symbols: ${symbols.join(', ')}`);
    } catch (error) {
      console.error('[RealtimeSLTPMonitor] Error refreshing positions:', error);
    }
  }

  private async handlePriceUpdate(priceData: any): Promise<void> {
    const { symbol, bid, ask } = priceData;

    if (!symbol || !bid || !ask) {
      console.warn('[RealtimeSLTPMonitor] Invalid price data:', priceData);
      return;
    }

    const bidPrice = parseFloat(bid);
    const askPrice = parseFloat(ask);

    // Get all open positions for this symbol
    const positions = this.openPositions.get(symbol);
    if (!positions || positions.length === 0) {
      return; // No positions to check
    }

    console.log(`[RealtimeSLTPMonitor] 📊 Price update: ${symbol} bid=${bidPrice.toFixed(5)} ask=${askPrice.toFixed(5)} | Checking ${positions.length} position(s)`);

    // Check each position
    for (const position of positions) {
      await this.checkPositionSLTP(position, bidPrice, askPrice);
    }
  }

  private async checkPositionSLTP(
    position: OpenPosition,
    bid: number,
    ask: number
  ): Promise<void> {
    // Prevent duplicate checks within minCheckIntervalMs
    const now = Date.now();
    const lastCheck = this.lastCheckTime.get(position.id) || 0;
    if (now - lastCheck < this.minCheckIntervalMs) {
      return; // Too soon since last check
    }
    this.lastCheckTime.set(position.id, now);

    // Use correct price based on direction
    const currentPrice = position.direction === 'buy' ? bid : ask;

    const shouldCloseAtStopLoss = position.direction === 'buy'
      ? currentPrice <= position.stop_loss
      : currentPrice >= position.stop_loss;

    const shouldCloseAtTakeProfit = position.direction === 'buy'
      ? currentPrice >= position.take_profit
      : currentPrice <= position.take_profit;

    if (shouldCloseAtStopLoss) {
      console.log(`[RealtimeSLTPMonitor] 🛑 STOP LOSS DETECTED: ${position.symbol} ${position.direction} @ ${currentPrice.toFixed(5)} (SL: ${position.stop_loss.toFixed(5)})`);

      // Remove from monitoring immediately to prevent duplicate closure attempts
      this.removePosition(position.id, position.symbol);

      // Trigger closure via coordinator
      await tradeClosureCoordinator.closeTrade({
        tradeId: position.id,
        currentPrice,
        closeReason: 'stop_loss',
        userId: position.user_id,
        goalSessionId: position.goal_session_id,
        forceClose: false,
      }).catch(error => {
        console.error(`[RealtimeSLTPMonitor] Failed to close at SL:`, error);
      });
    } else if (shouldCloseAtTakeProfit) {
      console.log(`[RealtimeSLTPMonitor] 🎯 TAKE PROFIT DETECTED: ${position.symbol} ${position.direction} @ ${currentPrice.toFixed(5)} (TP: ${position.take_profit.toFixed(5)})`);

      // Remove from monitoring immediately
      this.removePosition(position.id, position.symbol);

      // Trigger closure via coordinator
      await tradeClosureCoordinator.closeTrade({
        tradeId: position.id,
        currentPrice,
        closeReason: 'take_profit',
        userId: position.user_id,
        goalSessionId: position.goal_session_id,
        forceClose: false,
      }).catch(error => {
        console.error(`[RealtimeSLTPMonitor] Failed to close at TP:`, error);
      });
    }
  }

  private removePosition(tradeId: string, symbol: string): void {
    const positions = this.openPositions.get(symbol);
    if (!positions) return;

    const filtered = positions.filter(p => p.id !== tradeId);
    if (filtered.length === 0) {
      this.openPositions.delete(symbol);
    } else {
      this.openPositions.set(symbol, filtered);
    }

    this.lastCheckTime.delete(tradeId);
  }

  getStatus(): {
    isRunning: boolean;
    monitoredSymbols: string[];
    totalPositions: number;
  } {
    const symbols = Array.from(this.openPositions.keys());
    const totalPositions = symbols.reduce((sum, symbol) => {
      return sum + (this.openPositions.get(symbol)?.length || 0);
    }, 0);

    return {
      isRunning: this.isRunning,
      monitoredSymbols: symbols,
      totalPositions,
    };
  }
}

export const realtimeSLTPMonitor = new RealtimeSLTPMonitor();
