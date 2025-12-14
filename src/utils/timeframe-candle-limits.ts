/**
 * Dynamic Candle Loading Configuration
 *
 * Optimizes chart performance by requesting appropriate amounts of data
 * based on timeframe characteristics and indicator calculation requirements.
 *
 * Storage Impact (5 primary symbols with full historical data):
 * - Total candles: 229,295
 * - Storage: 21.8 MB
 * - Supabase free tier: 500 MB (only 4.4% used)
 */

import { Timeframe } from '@/services/chart-preferences';

interface TimeframeLimits {
  /**
   * Optimal number of candles to request for chart display
   * Balances performance vs. data availability for technical indicators
   */
  displayLimit: number;

  /**
   * Minimum required candles for reliable indicator calculations
   * (e.g., EMA200 needs at least 200 candles)
   */
  minRequired: number;

  /**
   * Lookback hours for time-based queries
   * Ensures we get enough historical data across market closures
   */
  lookbackHours: number;

  /**
   * Total candles stored in database per symbol
   * Based on getTimeframeLookbackHours function
   */
  historicalStorage: number;
}

/**
 * Configuration for each timeframe
 *
 * Display limits are optimized for:
 * - Fast chart loading (fewer candles = faster)
 * - Sufficient indicator data (EMA, SMA, etc.)
 * - Good visual context (not too zoomed in/out)
 */
const TIMEFRAME_LIMITS: Record<Timeframe, TimeframeLimits> = {
  /**
   * M1 (1-minute): Short-term scalping timeframe
   * - Display: 200 candles = 3.3 hours of price action
   * - Historical: 20,160 candles = 14 days
   * - Reason: M1 charts don't need deep history, focus on recent action
   */
  M1: {
    displayLimit: 200,
    minRequired: 100,
    lookbackHours: 336, // 14 days
    historicalStorage: 20160
  },

  /**
   * M5 (5-minute): Intraday trading timeframe
   * - Display: 300 candles = 25 hours of price action
   * - Historical: 8,640 candles = 30 days
   * - Reason: M5 benefits from seeing 1+ day of history for context
   */
  M5: {
    displayLimit: 300,
    minRequired: 150,
    lookbackHours: 720, // 30 days
    historicalStorage: 8640
  },

  /**
   * M15 (15-minute): Swing trading timeframe
   * - Display: 400 candles = 100 hours (4+ days) of price action
   * - Historical: 5,760 candles = 60 days
   * - Reason: M15 needs multi-day context for pattern recognition
   */
  M15: {
    displayLimit: 400,
    minRequired: 200,
    lookbackHours: 1440, // 60 days
    historicalStorage: 5760
  },

  /**
   * M30 (30-minute): Position trading timeframe
   * - Display: 500 candles = 250 hours (10+ days) of price action
   * - Historical: 4,320 candles = 90 days
   * - Reason: M30 traders need 1-2 weeks visible for trend analysis
   */
  M30: {
    displayLimit: 500,
    minRequired: 250,
    lookbackHours: 2160, // 90 days
    historicalStorage: 4320
  },

  /**
   * H1 (1-hour): Daily trend analysis
   * - Display: 500 candles = 500 hours (20+ days) of price action
   * - Historical: 4,320 candles = 180 days (6 months)
   * - Reason: H1 needs enough data for EMA200 and swing structure
   */
  H1: {
    displayLimit: 500,
    minRequired: 250,
    lookbackHours: 4320, // 180 days
    historicalStorage: 4320
  },

  /**
   * H4 (4-hour): Swing trading & position management
   * - Display: 500 candles = 2,000 hours (83 days) of price action
   * - Historical: 2,190 candles = 365 days (1 year)
   * - Reason: H4 requires deep history for major support/resistance levels
   */
  H4: {
    displayLimit: 500,
    minRequired: 250,
    lookbackHours: 8760, // 365 days (1 year)
    historicalStorage: 2190
  },

  /**
   * D1 (Daily): Long-term trend analysis
   * - Display: 365 candles = 1 year of price action
   * - Historical: 365 candles = 1 year
   * - Reason: D1 charts show yearly trends and major market cycles
   */
  D1: {
    displayLimit: 365,
    minRequired: 200,
    lookbackHours: 8760, // 365 days (1 year)
    historicalStorage: 365
  }
};

/**
 * Get the optimal display limit for a timeframe
 * This is the number of candles to fetch for chart display
 */
export function getDisplayLimit(timeframe: Timeframe): number {
  return TIMEFRAME_LIMITS[timeframe]?.displayLimit || 500;
}

/**
 * Get the minimum required candles for indicator calculations
 */
export function getMinRequiredCandles(timeframe: Timeframe): number {
  return TIMEFRAME_LIMITS[timeframe]?.minRequired || 200;
}

/**
 * Get the lookback hours for time-based queries
 */
export function getLookbackHours(timeframe: Timeframe): number {
  return TIMEFRAME_LIMITS[timeframe]?.lookbackHours || 720;
}

/**
 * Get the total historical storage per symbol for this timeframe
 */
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
