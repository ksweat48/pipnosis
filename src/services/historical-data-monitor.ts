/**
 * Historical Data Availability Monitor
 *
 * Tracks data completeness for each symbol/timeframe combination
 * and provides insights into backfill requirements.
 *
 * Key Features:
 * - Real-time data availability checking
 * - Gap detection and reporting
 * - Backfill progress monitoring
 * - Storage usage tracking
 */

import { supabase } from '@/lib/supabase';
import { Timeframe } from '@/services/chart-preferences';
import {
  getDisplayLimit,
  getMinRequiredCandles,
  getLookbackHours,
  getHistoricalStorage,
  calculateStorageRequirements
} from '@/utils/timeframe-candle-limits';
import { logger, LogCategory } from '@/lib/logger';

export interface DataAvailability {
  symbol: string;
  timeframe: Timeframe;
  candleCount: number;
  minRequired: number;
  displayLimit: number;
  historicalTarget: number;
  sufficient: boolean;
  completeness: number; // 0-100%
  oldestCandle: Date | null;
  newestCandle: Date | null;
  gapHours: number | null; // Hours between newest candle and now
}

export interface BackfillStatus {
  inProgress: boolean;
  lastRun: Date | null;
  totalCandles: number;
  symbols: Array<{
    symbol: string;
    progress: number; // 0-100%
    candlesAdded: number;
  }>;
}

export interface StorageStats {
  totalCandles: number;
  storageMB: number;
  percentUsed: number;
  symbolCount: number;
  timeframeStats: Array<{
    timeframe: Timeframe;
    candleCount: number;
    symbols: number;
  }>;
}

/**
 * Check data availability for a specific symbol and timeframe
 */
export async function checkDataAvailability(
  symbol: string,
  timeframe: Timeframe
): Promise<DataAvailability> {
  try {
    // Get candle count and time range
    const { data, error } = await supabase
      .from('forex_candles')
      .select('open_time')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .order('open_time', { ascending: true });

    if (error) {
      logger.error(LogCategory.CHART_POLLER, 'Error checking data availability:', error);
      throw error;
    }

    const candleCount = data?.length || 0;
    const minRequired = getMinRequiredCandles(timeframe);
    const displayLimit = getDisplayLimit(timeframe);
    const historicalTarget = getHistoricalStorage(timeframe);
    const sufficient = candleCount >= minRequired;
    const completeness = historicalTarget > 0
      ? Math.min(100, (candleCount / historicalTarget) * 100)
      : 0;

    const oldestCandle = data && data.length > 0
      ? new Date(data[0].open_time)
      : null;

    const newestCandle = data && data.length > 0
      ? new Date(data[data.length - 1].open_time)
      : null;

    const gapHours = newestCandle
      ? (Date.now() - newestCandle.getTime()) / (1000 * 60 * 60)
      : null;

    return {
      symbol,
      timeframe,
      candleCount,
      minRequired,
      displayLimit,
      historicalTarget,
      sufficient,
      completeness: Math.round(completeness * 10) / 10,
      oldestCandle,
      newestCandle,
      gapHours: gapHours ? Math.round(gapHours * 10) / 10 : null
    };
  } catch (error) {
    logger.error(LogCategory.CHART_POLLER, `Error checking ${symbol} ${timeframe}:`, error);
    throw error;
  }
}

/**
 * Check data availability for all primary symbols
 */
export async function checkAllDataAvailability(
  symbols: string[] = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'],
  timeframes: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1']
): Promise<DataAvailability[]> {
  const results: DataAvailability[] = [];

  for (const symbol of symbols) {
    for (const timeframe of timeframes) {
      try {
        const availability = await checkDataAvailability(symbol, timeframe);
        results.push(availability);
      } catch (error) {
        logger.error(LogCategory.CHART_POLLER,
          `Failed to check ${symbol} ${timeframe}:`, error);
      }
    }
  }

  return results;
}

/**
 * Get storage statistics across all data
 */
export async function getStorageStats(): Promise<StorageStats> {
  try {
    // Get count of candles per symbol and timeframe
    const { data, error } = await supabase
      .from('forex_candles')
      .select('symbol, timeframe')
      .order('symbol')
      .order('timeframe');

    if (error) throw error;

    const totalCandles = data?.length || 0;
    const BYTES_PER_CANDLE = 95;
    const storageMB = (totalCandles * BYTES_PER_CANDLE) / (1024 * 1024);
    const SUPABASE_FREE_TIER_MB = 500;
    const percentUsed = (storageMB / SUPABASE_FREE_TIER_MB) * 100;

    // Count unique symbols
    const symbols = new Set(data?.map(row => row.symbol) || []);
    const symbolCount = symbols.size;

    // Group by timeframe
    const timeframeGroups = new Map<Timeframe, { candleCount: number; symbols: Set<string> }>();

    data?.forEach(row => {
      const tf = row.timeframe as Timeframe;
      if (!timeframeGroups.has(tf)) {
        timeframeGroups.set(tf, { candleCount: 0, symbols: new Set() });
      }
      const group = timeframeGroups.get(tf)!;
      group.candleCount++;
      group.symbols.add(row.symbol);
    });

    const timeframeStats = Array.from(timeframeGroups.entries()).map(([timeframe, stats]) => ({
      timeframe,
      candleCount: stats.candleCount,
      symbols: stats.symbols.size
    }));

    return {
      totalCandles,
      storageMB: Math.round(storageMB * 100) / 100,
      percentUsed: Math.round(percentUsed * 100) / 100,
      symbolCount,
      timeframeStats
    };
  } catch (error) {
    logger.error(LogCategory.CHART_POLLER, 'Error getting storage stats:', error);
    throw error;
  }
}

/**
 * Identify symbols/timeframes that need backfill
 */
export function identifyBackfillNeeds(
  availabilities: DataAvailability[]
): Array<{ symbol: string; timeframe: Timeframe; reason: string; priority: number }> {
  const needs: Array<{ symbol: string; timeframe: Timeframe; reason: string; priority: number }> = [];

  availabilities.forEach(availability => {
    if (!availability.sufficient) {
      // CRITICAL: Not enough data for indicators
      needs.push({
        symbol: availability.symbol,
        timeframe: availability.timeframe,
        reason: `Only ${availability.candleCount}/${availability.minRequired} candles (insufficient for indicators)`,
        priority: 1 // High priority
      });
    } else if (availability.completeness < 50) {
      // WARNING: Less than 50% of target historical data
      needs.push({
        symbol: availability.symbol,
        timeframe: availability.timeframe,
        reason: `Only ${availability.completeness}% of target historical data`,
        priority: 2 // Medium priority
      });
    } else if (availability.gapHours && availability.gapHours > 24) {
      // INFO: Data is stale (more than 24 hours old)
      needs.push({
        symbol: availability.symbol,
        timeframe: availability.timeframe,
        reason: `Data is ${Math.round(availability.gapHours)}h old`,
        priority: 3 // Low priority
      });
    }
  });

  // Sort by priority (1 = highest)
  needs.sort((a, b) => a.priority - b.priority);

  return needs;
}

/**
 * Get summary of data availability across all monitored pairs
 */
export function getSummary(availabilities: DataAvailability[]): {
  total: number;
  sufficient: number;
  insufficient: number;
  averageCompleteness: number;
  critical: number; // < 25% complete
  warning: number; // 25-75% complete
  good: number; // > 75% complete
} {
  const total = availabilities.length;
  const sufficient = availabilities.filter(a => a.sufficient).length;
  const insufficient = total - sufficient;

  const avgCompleteness = availabilities.length > 0
    ? availabilities.reduce((sum, a) => sum + a.completeness, 0) / availabilities.length
    : 0;

  const critical = availabilities.filter(a => a.completeness < 25).length;
  const warning = availabilities.filter(a => a.completeness >= 25 && a.completeness < 75).length;
  const good = availabilities.filter(a => a.completeness >= 75).length;

  return {
    total,
    sufficient,
    insufficient,
    averageCompleteness: Math.round(avgCompleteness * 10) / 10,
    critical,
    warning,
    good
  };
}

/**
 * Trigger historical backfill via Netlify function
 * Note: This requires admin access
 */
export async function triggerHistoricalBackfill(
  symbol: string,
  timeframe: Timeframe,
  daysBack: number = 365,
  adminKey?: string
): Promise<{ success: boolean; message: string }> {
  try {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - daysBack * 24 * 60 * 60 * 1000);

    const response = await fetch('/.netlify/functions/dukascopy-historical-backfill', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(adminKey ? { 'X-Admin-Key': adminKey } : {})
      },
      body: JSON.stringify({
        symbol,
        timeframe,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        overwrite: false
      })
    });

    const result = await response.json();

    if (!response.ok) {
      return {
        success: false,
        message: result.error || 'Backfill request failed'
      };
    }

    return {
      success: true,
      message: `Backfill started: ${result.candlesInserted} candles added`
    };
  } catch (error) {
    logger.error(LogCategory.CHART_POLLER, 'Error triggering backfill:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to trigger backfill'
    };
  }
}

/**
 * Calculate estimated backfill time based on symbol/timeframe
 */
export function estimateBackfillDuration(
  symbol: string,
  timeframe: Timeframe,
  daysBack: number
): { minutes: number; candlesEstimate: number } {
  // Rough estimates based on timeframe
  const candlesPerDay: Record<Timeframe, number> = {
    M1: 1440,
    M5: 288,
    M15: 96,
    M30: 48,
    H1: 24,
    H4: 6,
    D1: 1
  };

  const candlesEstimate = Math.round(candlesPerDay[timeframe] * daysBack);

  // Assume ~1000 candles per minute for Dukascopy backfill
  const minutes = Math.max(1, Math.ceil(candlesEstimate / 1000));

  return { minutes, candlesEstimate };
}
