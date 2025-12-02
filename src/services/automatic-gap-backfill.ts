/**
 * Automatic Gap Backfill Service
 *
 * Runs transparently in the background to detect and fill gaps
 * in historical candle data. Triggered automatically when charts load.
 */

import { supabase } from '@/lib/supabase';
import { Timeframe, appTimeframeToDb } from '@/services/chart-preferences';

interface BackfillState {
  isRunning: boolean;
  lastRun: Record<string, number>; // symbol_timeframe -> timestamp
  cooldownMs: number;
}

class AutomaticGapBackfillService {
  private state: BackfillState = {
    isRunning: false,
    lastRun: {},
    cooldownMs: 5 * 60 * 1000 // 5 minutes cooldown between runs for same symbol/timeframe
  };

  private readonly NETLIFY_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL?.replace('/supabase', '')}/.netlify/functions/historical-backfill`;
  private readonly MAX_DAYS_BACK = 30; // Maximum days to backfill automatically
  private readonly GAP_THRESHOLD_MINUTES = 15; // Only backfill if gaps are > 15 minutes

  /**
   * Check and backfill gaps for a symbol/timeframe
   * Called automatically when charts load
   */
  async checkAndBackfill(symbol: string, timeframe: Timeframe): Promise<void> {
    const key = `${symbol}_${timeframe}`;

    // Check cooldown
    const lastRun = this.state.lastRun[key] || 0;
    const timeSinceLastRun = Date.now() - lastRun;

    if (timeSinceLastRun < this.state.cooldownMs) {
      console.log(`[AutoBackfill] Skipping ${key} - cooldown active (${Math.round((this.state.cooldownMs - timeSinceLastRun) / 1000)}s remaining)`);
      return;
    }

    // Check if already running
    if (this.state.isRunning) {
      console.log(`[AutoBackfill] Skipping ${key} - backfill already in progress`);
      return;
    }

    try {
      this.state.isRunning = true;

      // Quick gap check
      const hasSignificantGaps = await this.detectSignificantGaps(symbol, timeframe);

      if (!hasSignificantGaps) {
        console.log(`[AutoBackfill] No significant gaps detected for ${key}`);
        this.state.lastRun[key] = Date.now();
        return;
      }

      console.log(`[AutoBackfill] Significant gaps detected for ${key} - triggering backfill...`);

      // Trigger backfill in background (don't await - let it run async)
      this.executeBackfill(symbol, timeframe, key).catch(err => {
        console.error(`[AutoBackfill] Background backfill failed for ${key}:`, err);
      });

    } finally {
      this.state.isRunning = false;
    }
  }

  /**
   * Detect if there are significant gaps worth backfilling
   */
  private async detectSignificantGaps(symbol: string, timeframe: Timeframe): Promise<boolean> {
    try {
      const dbTimeframe = appTimeframeToDb(timeframe);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - this.MAX_DAYS_BACK);

      // Fetch recent candles to check for gaps
      const { data: candles, error } = await supabase
        .from('forex_candles')
        .select('open_time')
        .eq('symbol', symbol)
        .eq('timeframe', dbTimeframe)
        .gte('open_time', startDate.toISOString())
        .order('open_time', { ascending: true })
        .limit(500); // Sample last 500 candles

      if (error || !candles || candles.length < 10) {
        // Not enough data or error - assume we need backfill
        return true;
      }

      // Calculate expected interval
      const intervalMinutes = this.getTimeframeMinutes(timeframe);
      const intervalMs = intervalMinutes * 60 * 1000;
      const gapThresholdMs = this.GAP_THRESHOLD_MINUTES * 60 * 1000;

      // Check for gaps
      let significantGapsFound = 0;

      for (let i = 1; i < candles.length; i++) {
        const prevTime = new Date(candles[i - 1].open_time).getTime();
        const currTime = new Date(candles[i].open_time).getTime();
        const gap = currTime - prevTime;

        // Significant gap if > threshold and not just 1-2 missing candles
        if (gap > gapThresholdMs && gap > intervalMs * 2.5) {
          significantGapsFound++;

          // If we find multiple significant gaps, definitely need backfill
          if (significantGapsFound >= 2) {
            return true;
          }
        }
      }

      return significantGapsFound > 0;

    } catch (error) {
      console.error('[AutoBackfill] Gap detection failed:', error);
      return false; // Fail safe - don't trigger backfill on error
    }
  }

  /**
   * Execute the backfill operation
   */
  private async executeBackfill(symbol: string, timeframe: Timeframe, key: string): Promise<void> {
    try {
      console.log(`[AutoBackfill] Starting background backfill for ${key}...`);

      const response = await fetch(this.NETLIFY_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          symbol,
          timeframe,
          daysBack: this.MAX_DAYS_BACK,
          dryRun: false
        })
      });

      if (!response.ok) {
        throw new Error(`Backfill failed: ${response.status}`);
      }

      const result = await response.json();

      console.log(`[AutoBackfill] ✅ Completed for ${key}:`, {
        candlesInserted: result.candlesInserted,
        candlesSkipped: result.candlesSkipped
      });

      // Update last run timestamp
      this.state.lastRun[key] = Date.now();

      // Broadcast event so charts can refresh if needed
      window.dispatchEvent(new CustomEvent('gap-backfill-complete', {
        detail: { symbol, timeframe, result }
      }));

    } catch (error) {
      console.error(`[AutoBackfill] Failed for ${key}:`, error);
      throw error;
    }
  }

  /**
   * Get timeframe in minutes
   */
  private getTimeframeMinutes(timeframe: Timeframe): number {
    const map: Record<Timeframe, number> = {
      M1: 1,
      M5: 5,
      M15: 15,
      M30: 30,
      H1: 60,
      H4: 240,
      D1: 1440,
      W1: 10080
    };
    return map[timeframe] || 5;
  }

  /**
   * Reset cooldown for a symbol/timeframe (useful for manual refresh)
   */
  resetCooldown(symbol: string, timeframe: Timeframe): void {
    const key = `${symbol}_${timeframe}`;
    delete this.state.lastRun[key];
    console.log(`[AutoBackfill] Cooldown reset for ${key}`);
  }

  /**
   * Check if backfill is currently running
   */
  isBackfilling(): boolean {
    return this.state.isRunning;
  }
}

export const automaticGapBackfill = new AutomaticGapBackfillService();
