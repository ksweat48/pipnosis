/**
 * Realtime SL/TP Monitor
 *
 * EVENT-DRIVEN stop loss and take profit monitoring using Price Polling Coordinator.
 * ARCHITECTURE CHANGE (2026-02-04): Replaced Supabase Realtime with HTTP polling
 * for 95% cost reduction ($442.50/month savings).
 *
 * CRITICAL: This is a backup/redundant system alongside position-monitor.
 * Both systems check SL/TP independently for maximum reliability.
 *
 * Architecture:
 * - Subscribes to pricePollingCoordinator for price updates (2-second polling)
 * - When new price arrives, immediately checks ALL open positions for that symbol
 * - Triggers closure if SL/TP is hit
 * - 1-2 second response time (vs 250ms-1000ms polling)
 *
 * Cost Impact:
 * - Before: Realtime subscription = $442.50/month (176M messages)
 * - After: HTTP polling via edge function = $0
 * - Savings: $442.50/month (95% reduction)
 */

import { supabase } from '@/lib/supabase';
import { tradeClosureCoordinator } from './coordinators/trade-closure-coordinator';
import { positionMonitoringAuthority } from './monitoring/position-monitoring-authority';
import { pricePollingCoordinator, type PriceUpdate } from './price-polling-coordinator';
import type { MonitoredPosition, PriceData } from './monitoring/position-monitoring-authority';
import { tradeProcessingLockService } from './trade-processing-lock-service';

class RealtimeSLTPMonitor {
  private unsubscribe: (() => void) | null = null;
  private openPositions: Map<string, MonitoredPosition[]> = new Map();
  private isRunning = false;
  private lastCheckTime: Map<string, number> = new Map();
  private minCheckIntervalMs = 100;
  private abortController: AbortController | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  private isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError'
      || (error instanceof Error && error.message?.includes('AbortError'))
      || (typeof error === 'object' && error !== null && 'code' in error && (error as any).code === 'ABORTED');
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[RealtimeSLTPMonitor] Already running');
      return;
    }

    console.log('[RealtimeSLTPMonitor] Starting price-polling-based SL/TP monitoring...');
    this.isRunning = true;
    this.abortController = new AbortController();

    await this.refreshOpenPositions();

    // Subscribe to price polling coordinator (replaces Realtime subscription)
    try {
      this.unsubscribe = pricePollingCoordinator.subscribe((update: PriceUpdate) => {
        // Process each price update
        for (const price of update.prices) {
          this.handlePriceUpdate({
            symbol: price.symbol,
            bid: price.bid,
            ask: price.ask,
            timestamp: price.timestamp
          });
        }
      });

      console.log('[RealtimeSLTPMonitor] ✅ Subscribed to price polling coordinator (2-second updates)');
    } catch (error) {
      console.warn('[RealtimeSLTPMonitor] ⚠️ Error subscribing to coordinator:', error);
      this.unsubscribe = null;
    }

    this.refreshInterval = setInterval(() => this.refreshOpenPositions(), 5000);
  }

  stop(): void {
    if (!this.isRunning) return;

    console.log('[RealtimeSLTPMonitor] Stopping...');
    this.isRunning = false;

    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.openPositions.clear();
    this.lastCheckTime.clear();
  }

  private async refreshOpenPositions(): Promise<void> {
    if (!this.isRunning || this.abortController?.signal.aborted) {
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return;
      }

      const result = await positionMonitoringAuthority.getMonitorablePositions(user.id, false);

      if (!result.success) {
        if (result.accessDenied) {
          console.error('[RealtimeSLTPMonitor] Access denied:', result.error);
        } else if (!this.isAbortError(result.error)) {
          console.error('[RealtimeSLTPMonitor] Error fetching positions:', result.error);
        }
        return;
      }

      if (result.positions.length === 0) {
        this.openPositions.clear();
        return;
      }

      const positionsBySymbol = new Map<string, MonitoredPosition[]>();
      for (const pos of result.positions) {
        if (!positionsBySymbol.has(pos.symbol)) {
          positionsBySymbol.set(pos.symbol, []);
        }
        positionsBySymbol.get(pos.symbol)!.push(pos);
      }

      this.openPositions = positionsBySymbol;

      const totalPositions = result.positions.length;
      const symbols = Array.from(positionsBySymbol.keys());
      console.log(`[RealtimeSLTPMonitor] Monitoring ${totalPositions} positions across ${symbols.length} symbols: ${symbols.join(', ')}`);
    } catch (error) {
      if (this.isAbortError(error)) return;
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

    // GOVERNANCE: Validate parsed prices are valid numbers
    if (!isFinite(bidPrice) || !isFinite(askPrice) || bidPrice === 0 || askPrice === 0) {
      console.warn(
        `[RealtimeSLTPMonitor] Invalid prices after parsing: ${symbol} bid=${bidPrice} ask=${askPrice}`
      );
      return;
    }

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
    position: MonitoredPosition,
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

    // SSOT: Use authority for SL/TP decision
    const priceData: PriceData = { bid, ask };
    const decision = positionMonitoringAuthority.checkSLTP(position, priceData);

    if (!decision) {
      // No closure conditions met
      return;
    }

    // Check if it's a TP milestone (TP1)
    if ('milestone' in decision && decision.milestone === 'tp1') {
      console.log(`[RealtimeSLTPMonitor] 🎯 TP1 HIT: ${position.symbol} @ ${decision.price.toFixed(5)}`);
      await this.handleTP1Hit(position, decision.price);
      return;
    }

    // It's a closure decision (SL, TP2, or legacy TP)
    if ('shouldClose' in decision && decision.shouldClose) {
      // SSOT AUTHORITY: Try to acquire database-backed lock FIRST
      // This prevents multiple monitoring systems from processing the same trade
      const lockAcquired = await tradeProcessingLockService.acquireLock(
        position.id,
        'RealtimeSLTPMonitor'
      );

      if (!lockAcquired) {
        console.log(`[RealtimeSLTPMonitor] Skipping trade ${position.id} closure - locked by another system`);
        return;
      }

      try {
        const icon = decision.reason === 'stop_loss' ? '🛑' : '🎯';
        const reasonText = decision.reason === 'stop_loss' ? 'STOP LOSS' :
                           decision.reason === 'take_profit_2' ? 'TP2' : 'TAKE PROFIT';

        console.log(`[RealtimeSLTPMonitor] ${icon} ${reasonText} DETECTED: ${position.symbol} @ ${decision.price.toFixed(5)}`);

        this.removePosition(position.id, position.symbol);

        await tradeClosureCoordinator.closeTrade({
          tradeId: position.id,
          currentPrice: decision.price,
          closeReason: decision.reason,
          userId: position.user_id,
          goalSessionId: position.goal_session_id,
          forceClose: false,
        }).catch(error => {
          console.error(`[RealtimeSLTPMonitor] Failed to close at ${reasonText}:`, error);
        });
      } finally {
        // SSOT AUTHORITY: Release lock
        await tradeProcessingLockService.releaseLock(position.id);
      }
    }
  }

  /**
   * Fetch ATR for a symbol from realtime_prices table.
   * SSOT: ATR is stored server-side by the price polling infrastructure.
   * Returns null if ATR is unavailable — caller must handle gracefully.
   */
  private async fetchATR(symbol: string): Promise<number | null> {
    try {
      const { data, error } = await supabase
        .from('realtime_prices')
        .select('atr')
        .eq('symbol', symbol)
        .maybeSingle();

      if (error || !data || data.atr == null || data.atr <= 0) {
        return null;
      }

      return parseFloat(data.atr);
    } catch {
      return null;
    }
  }

  /**
   * Handle TP1 hit: Mark TP1 as hit, auto-move SL to breakeven+ATR buffer, keep monitoring for TP2
   * CRITICAL: position_size/lot_size NEVER changes - only TP1 flag and SL are updated
   * SSOT: Delegates to authority for all database updates
   */
  private async handleTP1Hit(position: MonitoredPosition, currentPrice: number): Promise<void> {
    try {
      console.log(`[RealtimeSLTPMonitor] TP1 HIT @ ${currentPrice.toFixed(5)} - marking flag, lot size unchanged`);

      // SSOT: Use authority to mark TP1
      const result = await positionMonitoringAuthority.markTP1Hit(position.id, position.user_id, currentPrice);

      if (!result.success) {
        console.error(`[RealtimeSLTPMonitor] Failed to mark TP1:`, result.error);
        return;
      }

      // Update position in memory (flag only, NOT size)
      position.tp1_hit = true;

      // ATR-BASED SL AUTO-MOVE: Protect profits after TP1
      // Only move SL if position doesn't already have a breakeven SL set
      if (!position.tp1_breakeven_price) {
        const atr = await this.fetchATR(position.symbol);

        if (atr !== null) {
          const slResult = await positionMonitoringAuthority.autoMoveSLAfterTP1(
            position.id,
            position.user_id,
            position.direction,
            position.entry_price,
            atr
          );

          if (slResult.success && slResult.newSL !== undefined) {
            position.stop_loss = slResult.newSL;
            position.tp1_breakeven_price = slResult.newSL;
            console.log(`[RealtimeSLTPMonitor] SL auto-moved to ${slResult.newSL.toFixed(5)} after TP1 (ATR=${atr.toFixed(5)})`);
          } else {
            console.warn(`[RealtimeSLTPMonitor] SL auto-move failed (non-blocking):`, slResult.error);
          }
        } else {
          console.warn(`[RealtimeSLTPMonitor] ATR unavailable for ${position.symbol} — SL auto-move skipped (non-blocking)`);
        }
      }

      // Keep monitoring for TP2 - don't remove from monitoring
      console.log(`[RealtimeSLTPMonitor] TP1 complete. Full position still active. Monitoring continues for TP2...`);

    } catch (error) {
      console.error(`[RealtimeSLTPMonitor] Error handling TP1:`, error);
    }
  }

  /**
   * Handle TP2 hit: Close full position
   * CRITICAL: Position size was never reduced at TP1, so this closes the complete position
   * SSOT: Delegates to authority for milestone marking
   * NOTE: This method is now unused as TP2 is handled directly in checkPositionSLTP
   * Keeping for backward compatibility during transition
   */
  private async handleTP2Hit(position: MonitoredPosition, currentPrice: number): Promise<void> {
    // SSOT AUTHORITY: Try to acquire database-backed lock FIRST
    // This prevents multiple monitoring systems from processing the same trade
    const lockAcquired = await tradeProcessingLockService.acquireLock(
      position.id,
      'RealtimeSLTPMonitor'
    );

    if (!lockAcquired) {
      console.log(`[RealtimeSLTPMonitor] Skipping TP2 closure for trade ${position.id} - locked by another system`);
      return;
    }

    try {
      console.log(`[RealtimeSLTPMonitor] TP2 HIT @ ${currentPrice.toFixed(5)} - closing full position...`);

      // SSOT: Use authority to mark TP2
      const result = await positionMonitoringAuthority.markTP2Hit(position.id, position.user_id);

      if (!result.success) {
        console.error(`[RealtimeSLTPMonitor] Failed to mark TP2:`, result.error);
      }

      // Remove from monitoring - full close
      this.removePosition(position.id, position.symbol);

      // Close the full trade via coordinator
      await tradeClosureCoordinator.closeTrade({
        tradeId: position.id,
        currentPrice,
        closeReason: 'take_profit_2',
        userId: position.user_id,
        goalSessionId: position.goal_session_id,
        forceClose: false,
      }).catch(error => {
        console.error(`[RealtimeSLTPMonitor] Failed to close at TP2:`, error);
      });

      console.log(`[RealtimeSLTPMonitor] TP2 closure complete!`);
    } catch (error) {
      console.error(`[RealtimeSLTPMonitor] Error handling TP2:`, error);
    } finally {
      // SSOT AUTHORITY: Release lock
      await tradeProcessingLockService.releaseLock(position.id);
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
