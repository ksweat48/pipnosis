/**
 * Timeframe Candle Limits - Re-exports from SSOT
 *
 * IMPORTANT: This file re-exports from the centralized timeframe-hierarchy.ts
 * to maintain backward compatibility with existing imports.
 *
 * For new code, import directly from '@/config/timeframe-hierarchy'
 */

export {
  type Timeframe,
  type TimeframeLimits,
  TIMEFRAME_LIMITS,
  getDisplayLimit,
  getMinRequiredCandles,
  getLookbackHours,
} from '@/config/timeframe-hierarchy';

import {
  type Timeframe,
  type TimeframeLimits,
  TIMEFRAME_LIMITS,
  getMinRequiredCandles,
} from '@/config/timeframe-hierarchy';

export function getHistoricalStorage(timeframe: Timeframe): number {
  return TIMEFRAME_LIMITS[timeframe]?.historicalStorage || 500;
}

/**
 * Calculate total storage requirements
 */
export function calculateStorageRequirements(symbolCount: number = 5): {
  totalCandles: number;
  storageMB: number;
  percentOfFreeT: number;
} {
  const BYTES_PER_CANDLE = 95;
  const SUPABASE_FREE_TIER_MB = 500;

  // Sum all historical storage across all timeframes
  const candlesPerSymbol = Object.values(TIMEFRAME_LIMITS)
    .reduce((sum, limits) => sum + limits.historicalStorage, 0);

  const totalCandles = candlesPerSymbol * symbolCount;
  const totalBytes = totalCandles * BYTES_PER_CANDLE;
  const storageMB = totalBytes / (1024 * 1024);
  const percentOfFreeTier = (storageMB / SUPABASE_FREE_TIER_MB) * 100;

  return {
    totalCandles,
    storageMB: Math.round(storageMB * 100) / 100,
    percentOfFreeT: Math.round(percentOfFreeTier * 100) / 100
  };
}

/**
 * Check if we have enough data for reliable calculations
 */
export function hasEnoughData(
  timeframe: Timeframe,
  candleCount: number
): { sufficient: boolean; needed: number; message?: string } {
  const minRequired = getMinRequiredCandles(timeframe);

  if (candleCount >= minRequired) {
    return { sufficient: true, needed: minRequired };
  }

  return {
    sufficient: false,
    needed: minRequired,
    message: `Need ${minRequired - candleCount} more candles for reliable ${timeframe} calculations`
  };
}

/**
 * Get all limits for a timeframe
 */
export function getTimeframeLimits(timeframe: Timeframe): TimeframeLimits {
  return TIMEFRAME_LIMITS[timeframe] || TIMEFRAME_LIMITS.M15;
}
