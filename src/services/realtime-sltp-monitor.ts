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
  tp1_price?: number | null;
  tp2_price?: number | null;
  tp1_hit?: boolean;
  tp2_hit?: boolean;
  position_size: number;
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
  private abortController: AbortController | null = null;

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

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.openPositions.clear();
    this.lastCheckTime.clear();
  }

  private async refreshOpenPositions(): Promise<void> {
    try {
      this.abortController = new AbortController();

      const { data: positions, error } = await supabase
        .from('goal_session_trades')
        .select('id, symbol, direction, entry_price, stop_loss, take_profit, tp1_price, tp2_price, tp1_hit, tp2_hit, position_size, user_id, goal_session_id, status')
        .eq('status', 'open')
        .abortSignal(this.abortController.signal);

      if (error) {
        if (error.message?.includes('AbortError') || error.code === 'ABORTED') {
          return;
        }
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

    // PRIORITY 1: Check Stop Loss (always full close)
    const shouldCloseAtStopLoss = position.direction === 'buy'
      ? currentPrice <= position.stop_loss
      : currentPrice >= position.stop_loss;

    if (shouldCloseAtStopLoss) {
      console.log(`[RealtimeSLTPMonitor] 🛑 STOP LOSS DETECTED: ${position.symbol} ${position.direction} @ ${currentPrice.toFixed(5)} (SL: ${position.stop_loss.toFixed(5)})`);
      this.removePosition(position.id, position.symbol);

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
      return;
    }

    // PRIORITY 2: Check Dual TP System
    const hasDualTP = position.tp1_price && position.tp2_price;

    if (hasDualTP) {
      // Dual TP System: Check TP1 and TP2 separately
      const shouldHitTP1 = !position.tp1_hit && (position.direction === 'buy'
        ? currentPrice >= position.tp1_price!
        : currentPrice <= position.tp1_price!);

      const shouldHitTP2 = position.tp1_hit && !position.tp2_hit && (position.direction === 'buy'
        ? currentPrice >= position.tp2_price!
        : currentPrice <= position.tp2_price!);

      if (shouldHitTP1) {
        console.log(`[RealtimeSLTPMonitor] 🎯 TP1 HIT (70% close): ${position.symbol} @ ${currentPrice.toFixed(5)} (TP1: ${position.tp1_price!.toFixed(5)})`);
        await this.handleTP1Hit(position, currentPrice);
      } else if (shouldHitTP2) {
        console.log(`[RealtimeSLTPMonitor] 🎯🎯 TP2 HIT (30% close): ${position.symbol} @ ${currentPrice.toFixed(5)} (TP2: ${position.tp2_price!.toFixed(5)})`);
        await this.handleTP2Hit(position, currentPrice);
      }
    } else {
      // Legacy single TP system
      const shouldCloseAtTakeProfit = position.direction === 'buy'
        ? currentPrice >= position.take_profit
        : currentPrice <= position.take_profit;

      if (shouldCloseAtTakeProfit) {
        console.log(`[RealtimeSLTPMonitor] 🎯 TAKE PROFIT DETECTED: ${position.symbol} ${position.direction} @ ${currentPrice.toFixed(5)} (TP: ${position.take_profit.toFixed(5)})`);
        this.removePosition(position.id, position.symbol);

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
  }

  /**
   * Handle TP1 hit: Close 70% of position, update database, keep monitoring for TP2
   */
  private async handleTP1Hit(position: OpenPosition, currentPrice: number): Promise<void> {
    try {
      // Calculate 70% partial close
      const closeSize = position.position_size * 0.7;

      console.log(`[RealtimeSLTPMonitor] Closing 70% (${closeSize.toFixed(2)} lots) at TP1...`);

      // Update database to mark TP1 as hit
      const { error: updateError } = await supabase
        .from('goal_session_trades')
        .update({
          tp1_hit: true,
          tp1_hit_at: new Date().toISOString(),
          tp1_action_taken: 'continued', // Continued to TP2 with 30% remaining
          position_size: position.position_size * 0.3 // Remaining 30%
        })
        .eq('id', position.id);

      if (updateError) {
        console.error(`[RealtimeSLTPMonitor] Failed to update TP1 hit:`, updateError);
      }

      // Calculate partial profit (70% of position)
      const pipInfo = await import('../utils/currencyHelpers').then(m => m.getCurrencyPipInfo(position.symbol));
      const profitPips = Math.abs(currentPrice - position.entry_price) / pipInfo.pipValue;
      const dollarPerPip = closeSize * pipInfo.dollarPerPipPerLot;
      const partialProfit = profitPips * dollarPerPip;

      console.log(`[RealtimeSLTPMonitor] TP1 partial profit: $${partialProfit.toFixed(2)}`);

      // Update position in memory to reflect partial close
      position.position_size = position.position_size * 0.3;
      position.tp1_hit = true;

      // Keep monitoring for TP2 - don't remove from monitoring
      console.log(`[RealtimeSLTPMonitor] TP1 processed. Monitoring continues for TP2...`);

    } catch (error) {
      console.error(`[RealtimeSLTPMonitor] Error handling TP1:`, error);
    }
  }

  /**
   * Handle TP2 hit: Close remaining 30%, full closure
   */
  private async handleTP2Hit(position: OpenPosition, currentPrice: number): Promise<void> {
    try {
      console.log(`[RealtimeSLTPMonitor] TP2 hit - closing remaining 30% position...`);

      // Mark TP2 as hit
      const { error: updateError } = await supabase
        .from('goal_session_trades')
        .update({
          tp2_hit: true,
          tp2_hit_at: new Date().toISOString()
        })
        .eq('id', position.id);

      if (updateError) {
        console.error(`[RealtimeSLTPMonitor] Failed to update TP2 hit:`, updateError);
      }

      // Remove from monitoring - full close
      this.removePosition(position.id, position.symbol);

      // Close the full trade via coordinator
      await tradeClosureCoordinator.closeTrade({
        tradeId: position.id,
        currentPrice,
        closeReason: 'take_profit',
        userId: position.user_id,
        goalSessionId: position.goal_session_id,
        forceClose: false,
      }).catch(error => {
        console.error(`[RealtimeSLTPMonitor] Failed to close at TP2:`, error);
      });

      console.log(`[RealtimeSLTPMonitor] TP2 closure complete!`);
    } catch (error) {
      console.error(`[RealtimeSLTPMonitor] Error handling TP2:`, error);
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
