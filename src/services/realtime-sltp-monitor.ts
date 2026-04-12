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
import { isXAUUSD, isJPYPair, getCurrencyPipInfo } from '../utils/currencyHelpers';
import { calculatePnL } from '@/types/position';
import { notificationCoordinator } from './coordinators/notification-coordinator';
import { audioAlertService } from './audio-alert-service';
import { pushNotificationDispatcher } from './push-notification-dispatcher';

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
   * Compute fallback ATR when the realtime_prices table ATR is unavailable.
   *
   * CCIP 2026-03-02: The original path silently skipped the SL move if ATR was null,
   * leaving the stop at the original entry distance after TP1.  This caused both
   * XAUUSD trades on 2026-03-02 to run all the way back through the original SL
   * after TP1 was hit and logged.
   *
   * Fallback is intentionally conservative: uses a fixed pip value that is smaller
   * than a typical live ATR so it never over-moves the SL, but still ensures the
   * position is at minimum protected at breakeven.
   *
   * SSOT: Symbol classification from currencyHelpers.
   */
  private getFallbackATR(symbol: string): number {
    const pipInfo = getCurrencyPipInfo(symbol);
    if (isXAUUSD(symbol)) {
      return 8 * pipInfo.pipValue;   // 8 pips XAUUSD = 0.08 points
    }
    if (isJPYPair(symbol)) {
      return 0.08;                   // ~8 pips for JPY pairs
    }
    return 5 * pipInfo.pipValue;     // 5 pips standard forex
  }

  /**
   * Handle TP1 hit: Mark TP1 as hit, auto-move SL to breakeven+ATR buffer, keep monitoring for TP2
   * CRITICAL: position_size/lot_size NEVER changes - only TP1 flag and SL are updated
   * SSOT: Delegates to authority for all database updates
   *
   * CCIP 2026-03-02: ATR fallback added — SL move is now GUARANTEED after TP1.
   * Previous code silently skipped when ATR was null; that left trades unprotected.
   *
   * CCIP 2026-03-04 TP1-ONCE-PER-TRADE: markTP1Hit() uses an optimistic DB lock
   * (.eq('tp1_hit', false)) so only one monitor wins the write race. When
   * already_processed=true, all downstream logic (SL move, notification) is skipped.
   * A 'tp1_milestone' notification (not 'take_profit_hit') is sent so the
   * realtime-trade-notification-listener does NOT misroute it as a trade closure modal.
   */
  private async handleTP1Hit(position: MonitoredPosition, currentPrice: number): Promise<void> {
    try {
      console.log(`[RealtimeSLTPMonitor] TP1 HIT @ ${currentPrice.toFixed(5)} - marking flag, lot size unchanged`);

      // SSOT: Use authority to mark TP1 — optimistic lock ensures only one monitor wins
      const result = await positionMonitoringAuthority.markTP1Hit(position.id, position.user_id, currentPrice);

      if (result.already_processed) {
        console.log(`[RealtimeSLTPMonitor] TP1 already processed for ${position.id} — skipping duplicate`);
        return;
      }

      if (!result.success) {
        console.error(`[RealtimeSLTPMonitor] Failed to mark TP1:`, result.error);
        return;
      }

      // Update position in memory (flag only, NOT size)
      position.tp1_hit = true;

      // ── BACKUP BE SL FAILSAFE ──────────────────────────────────────────────
      // PRIMARY authority is the database trigger (check_and_close_positions_on_price_update).
      // It moves the SL atomically in the same UPDATE as tp1_hit=true, on every price tick.
      // This TypeScript path is a BACKUP that only fires if the trigger has NOT yet moved the
      // SL (e.g. the tick that triggered TP1 arrived before the trigger fired, or realtime
      // prices are being inserted at low frequency for this symbol).
      //
      // CCIP-2026-BE001: Re-fetch tp1_breakeven_price from the DB immediately after markTP1Hit
      // succeeds to check if the trigger already handled it. In-memory position.tp1_breakeven_price
      // is always null at this point (the in-memory copy predates the trigger's UPDATE).
      const { data: freshTrade } = await import('@/lib/supabase').then(m =>
        m.supabase
          .from('goal_session_trades')
          .select('tp1_breakeven_price, stop_loss')
          .eq('id', position.id)
          .maybeSingle()
      );

      if (freshTrade?.tp1_breakeven_price != null) {
        // Trigger already handled it — sync in-memory state and skip TS BE move
        position.stop_loss = freshTrade.stop_loss;
        position.tp1_breakeven_price = freshTrade.tp1_breakeven_price;
        console.log(`[RealtimeSLTPMonitor] BE SL already set by trigger: ${freshTrade.tp1_breakeven_price.toFixed(5)} — skipping TS backup path`);
      } else {
        // Trigger has NOT fired yet — execute the backup BE SL move
        let atr = await this.fetchATR(position.symbol);

        let isFallbackATR = false;
        if (atr === null) {
          atr = this.getFallbackATR(position.symbol);
          isFallbackATR = true;
          console.warn(
            `[RealtimeSLTPMonitor] ATR unavailable for ${position.symbol} — ` +
            `using fallback ATR=${atr.toFixed(5)} (TS backup path, trigger did not fire).`
          );
        }

        const slResult = await positionMonitoringAuthority.autoMoveSLAfterTP1(
          position.id,
          position.user_id,
          position.direction,
          position.entry_price,
          atr,
          isFallbackATR
        );

        if (slResult.success && slResult.newSL !== undefined) {
          position.stop_loss = slResult.newSL;
          position.tp1_breakeven_price = slResult.newSL;
          console.log(`[RealtimeSLTPMonitor] TS backup: SL moved to ${slResult.newSL.toFixed(5)} after TP1 (ATR=${atr.toFixed(5)})`);
        } else {
          console.error(
            `[RealtimeSLTPMonitor] CRITICAL: TS backup BE SL move failed for trade ${position.id}:`,
            slResult.error
          );
        }
      }

      // CCIP FIX (2026-03-04 TP1-ONCE-PER-TRADE): Send 'tp1_milestone' notification.
      // Previously 'take_profit_hit' was sent here, which the realtime-trade-notification-listener
      // routed to fetchAndShowTradeClosedModal() for a still-open trade — producing a blank modal.
      // 'tp1_milestone' is handled by the listener as audio-only (no modal).
      // The TP1 Decision Modal is owned by GoalSessionDashboard's Realtime subscription on tp1_hit.
      await notificationCoordinator.send({
        userId: position.user_id,
        type: 'tp1_milestone',
        title: `TP1 Hit: ${position.symbol}`,
        message: `First take profit level reached at ${currentPrice.toFixed(5)}. Trade is now protected and running for TP2.`,
        tradeId: position.id,
        sessionId: position.goal_session_id,
        priority: 'high',
        metadata: {
          symbol: position.symbol,
          tp1_price: currentPrice,
          tp_level: 'tp1',
          milestone_only: true,
        },
      }).catch(err => {
        console.warn(`[RealtimeSLTPMonitor] TP1 milestone notification failed (non-blocking):`, err);
      });

      // CCIP-2026-0320D: Push notification — user receives device alert when TP1 is hit.
      // PnL is computed at TP1 price using the trade's lot size (SSOT: calculatePnL authority).
      // newSL reflects the post-auto-move stop loss already written to position in memory above.
      const lotSizeForPnL = position.lot_size ?? position.position_size;
      const pnlAtTP1 = calculatePnL(position.direction, position.entry_price, currentPrice, lotSizeForPnL, position.symbol);

      pushNotificationDispatcher.sendTP1MilestoneAlert({
        userId: position.user_id,
        tradeId: position.id,
        symbol: position.symbol,
        direction: position.direction,
        tp1Price: currentPrice,
        newSL: position.stop_loss,
        pnlAtTP1,
      }).catch(err => {
        console.warn(`[RealtimeSLTPMonitor] TP1 push notification failed (non-blocking):`, err);
      });

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
