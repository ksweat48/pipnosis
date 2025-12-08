/**
 * Recent Candle Backfill Service
 *
 * Simple, silent background service that ALWAYS refreshes the most recent 50-100 candles.
 * No gap detection, no UI indicators - just keeps recent data fresh.
 */

import { Timeframe } from './chart-preferences';
import { logger, LogCategory } from '@/lib/logger';

class RecentCandleBackfill {
  private readonly NETLIFY_FUNCTION_URL = '/.netlify/functions/historical-backfill';
  private activeBackfills = new Set<string>();

  /**
   * Calculate how many days back we need to fetch to get ~100 candles
   */
  private calculateDaysForCandleCount(timeframe: Timeframe, targetCandles: number = 100): number {
    const timeframeMinutes: Record<Timeframe, number> = {
      M1: 1,
      M5: 5,
      M15: 15,
      M30: 30,
      H1: 60,
      H4: 240,
      D1: 1440,
      W1: 10080
    };

    const minutes = timeframeMinutes[timeframe];
    const totalMinutes = minutes * targetCandles;

    // Add 50% buffer to account for weekends and market closures
    const daysNeeded = Math.ceil((totalMinutes / 1440) * 1.5);

    // Cap at reasonable limits
    const daysMap: Record<Timeframe, number> = {
      M1: 1,   // 100 candles = ~1.7 hours → 1 day is safe
      M5: 1,   // 100 candles = ~8 hours → 1 day
      M15: 2,  // 100 candles = ~25 hours → 2 days
      M30: 3,  // 100 candles = ~50 hours → 3 days
      H1: 5,   // 100 candles = ~100 hours → 5 days
      H4: 14,  // 100 candles = ~400 hours → 14 days
      D1: 30,  // 100 candles = ~100 days → 30 days (cap at 1 month)
      W1: 30   // 100 candles = ~700 days → 30 days (cap at 1 month)
    };

    return Math.min(daysMap[timeframe], 30); // Never exceed 30 days
  }

  /**
   * Check if we have sufficient recent data in database
   */
  private async checkDataSufficiency(
    symbol: string,
    timeframe: Timeframe,
    targetCandles: number
  ): Promise<{ sufficient: boolean; currentCount: number; missingCount: number }> {
    const { supabase } = await import('@/lib/supabase');

    const daysBack = this.calculateDaysForCandleCount(timeframe, targetCandles);
    const startTime = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from('forex_candles')
      .select('open_time', { count: 'exact', head: true })
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .gte('open_time', startTime.toISOString())
      .order('open_time', { ascending: false });

    if (error) {
      logger.error(LogCategory.DATA, '[RecentBackfill] Error checking data sufficiency:', error);
      return { sufficient: false, currentCount: 0, missingCount: targetCandles };
    }

    const currentCount = (data as any)?.count || 0;
    const threshold = targetCandles * 0.8; // 80% threshold
    const sufficient = currentCount >= threshold;
    const missingCount = Math.max(0, targetCandles - currentCount);

    return { sufficient, currentCount, missingCount };
  }

  /**
   * Silently backfill recent candles for a symbol/timeframe
   * Only calls MetaAPI if we're actually missing significant data
   */
  async backfillRecent(symbol: string, timeframe: Timeframe): Promise<void> {
    const key = `${symbol}_${timeframe}`;

    // Prevent duplicate backfills for same symbol/timeframe
    if (this.activeBackfills.has(key)) {
      logger.debug(LogCategory.DATA, `[RecentBackfill] Already backfilling ${key}, skipping`);
      return;
    }

    this.activeBackfills.add(key);

    try {
      const targetCandles = 100;

      // Check if we already have sufficient data
      const sufficiency = await this.checkDataSufficiency(symbol, timeframe, targetCandles);

      if (sufficiency.sufficient) {
        logger.info(
          LogCategory.DATA,
          `[RecentBackfill] ✅ ${symbol} ${timeframe} has sufficient data (${sufficiency.currentCount}/${targetCandles} candles), skipping MetaAPI fetch`
        );
        return;
      }

      logger.info(
        LogCategory.DATA,
        `[RecentBackfill] 📊 ${symbol} ${timeframe} needs more data (${sufficiency.currentCount}/${targetCandles}), missing ${sufficiency.missingCount} candles`
      );

      const daysBack = this.calculateDaysForCandleCount(timeframe, targetCandles);

      logger.info(
        LogCategory.DATA,
        `[RecentBackfill] Starting MetaAPI fetch for ${symbol} ${timeframe} (${daysBack} days back)`
      );

      const response = await fetch(this.NETLIFY_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol,
          timeframe,
          daysBack,
          dryRun: false
        })
      });

      if (response.ok) {
        const result = await response.json();
        logger.info(
          LogCategory.DATA,
          `[RecentBackfill] ✅ Completed for ${symbol} ${timeframe}: ${result.candlesInserted} new candles inserted`
        );
      } else {
        const errorText = await response.text();

        // Check if error is due to MetaAPI not having symbol
        if (errorText.includes('No MetaAPI account has') || errorText.includes('doesn\'t have')) {
          logger.info(
            LogCategory.DATA,
            `[RecentBackfill] ℹ️ MetaAPI doesn't have ${symbol}, using existing ${sufficiency.currentCount} candles from database`
          );
        } else {
          logger.warn(
            LogCategory.DATA,
            `[RecentBackfill] Failed for ${symbol} ${timeframe}: ${response.status} - using existing database data`
          );
        }
      }
    } catch (error) {
      // Silent failure - don't disrupt user experience
      logger.info(
        LogCategory.DATA,
        `[RecentBackfill] Using existing database data for ${symbol} ${timeframe} (MetaAPI unavailable)`
      );
    } finally {
      this.activeBackfills.delete(key);
    }
  }

  /**
   * Check if a backfill is currently running for a symbol/timeframe
   */
  isBackfilling(symbol: string, timeframe: Timeframe): boolean {
    return this.activeBackfills.has(`${symbol}_${timeframe}`);
  }

  /**
   * Get current active backfills
   */
  getActiveBackfills(): string[] {
    return Array.from(this.activeBackfills);
  }
}

export const recentCandleBackfill = new RecentCandleBackfill();
