/**
 * Wick Reconstruction Service
 *
 * Reconstructs realistic wicks for flat or low-tick candles using:
 * 1. ATR (Average True Range) for volatility estimation
 * 2. Historical wick patterns for the symbol
 * 3. Statistical modeling based on timeframe
 *
 * This significantly improves chart quality when tick data is sparse.
 */

import { supabase } from '../lib/supabase';

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  open_time: string | Date;
  symbol: string;
  timeframe: string;
}

interface ReconstructedCandle extends Candle {
  reconstructed: boolean;
  reconstruction_method?: string;
  original_high?: number;
  original_low?: number;
}

interface ATRData {
  atr: number;
  avgWickPercent: number;
  avgUpperWickPercent: number;
  avgLowerWickPercent: number;
}

interface ATRCacheEntry {
  data: ATRData;
  timestamp: number;
}

/**
 * ATR Cache with LRU eviction
 * Max 50 entries, 5-minute TTL per entry
 * Provides <5ms lookups after first calculation
 */
class ATRCache {
  private cache = new Map<string, ATRCacheEntry>();
  private readonly MAX_SIZE = 50;
  private readonly TTL_MS = 5 * 60 * 1000; // 5 minutes

  get(key: string): ATRData | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check if expired
    if (Date.now() - entry.timestamp > this.TTL_MS) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (LRU)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.data;
  }

  set(key: string, data: ATRData): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.MAX_SIZE) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  clear(): void {
    this.cache.clear();
  }

  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.MAX_SIZE,
      ttlMs: this.TTL_MS
    };
  }
}

const atrCache = new ATRCache();

/**
 * Calculate ATR (Average True Range) from recent candles
 * OPTIMIZED: Uses aggressive caching (5-minute TTL)
 * First call: ~50-200ms, subsequent calls: <5ms
 */
async function calculateATR(
  symbol: string,
  timeframe: string,
  lookbackPeriods: number = 14
): Promise<ATRData | null> {
  // Check cache first
  const cacheKey = `${symbol}_${timeframe}`;
  const cached = atrCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  try {
    const { data: recentCandles, error } = await supabase
      .from('forex_candles')
      .select('open, high, low, close, volume')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .order('open_time', { ascending: false })
      .limit(lookbackPeriods + 1);

    if (error || !recentCandles || recentCandles.length < 2) {
      return null;
    }

    // Calculate True Range for each candle
    const trueRanges: number[] = [];
    let totalUpperWickPercent = 0;
    let totalLowerWickPercent = 0;

    for (let i = 1; i < recentCandles.length; i++) {
      const current = recentCandles[i];
      const previous = recentCandles[i - 1];

      // True Range = max(high - low, abs(high - prevClose), abs(low - prevClose))
      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close)
      );
      trueRanges.push(tr);

      // Calculate wick percentages
      const bodySize = Math.abs(current.close - current.open);
      if (bodySize > 0) {
        const upperWick = current.high - Math.max(current.open, current.close);
        const lowerWick = Math.min(current.open, current.close) - current.low;
        totalUpperWickPercent += upperWick / bodySize;
        totalLowerWickPercent += lowerWick / bodySize;
      }
    }

    // Calculate ATR (simple moving average)
    const atr = trueRanges.reduce((sum, tr) => sum + tr, 0) / trueRanges.length;
    const avgUpperWickPercent = totalUpperWickPercent / (recentCandles.length - 1);
    const avgLowerWickPercent = totalLowerWickPercent / (recentCandles.length - 1);

    const atrData: ATRData = {
      atr,
      avgWickPercent: (avgUpperWickPercent + avgLowerWickPercent) / 2,
      avgUpperWickPercent,
      avgLowerWickPercent
    };

    // Cache the result
    atrCache.set(cacheKey, atrData);

    return atrData;
  } catch (error) {
    console.error('[WickReconstruction] Error calculating ATR:', error);
    return null;
  }
}

/**
 * Determine if a candle needs wick reconstruction
 * CRITICAL FIX: Only reconstruct COMPLETELY FLAT candles
 * We NEVER extend wicks on candles with actual price data
 * This preserves data integrity for Alpha's trading decisions
 */
function needsReconstruction(candle: Candle, atrData: ATRData | null): boolean {
  const range = candle.high - candle.low;

  // ONLY reconstruct if it's a completely flat candle (all OHLC values identical)
  // This means we have NO actual price movement data
  if (range === 0 && candle.open === candle.high && candle.high === candle.low && candle.low === candle.close) {
    return true;
  }

  // If candle has ANY actual range, we preserve it exactly as-is
  // Real market data is ALWAYS more accurate than statistical estimates
  return false;
}

/**
 * Reconstruct wicks using ATR-based estimation
 * CRITICAL FIX: Only called for completely flat candles
 * Creates minimal realistic range without extending beyond actual price data
 */
function reconstructWicksFromATR(candle: Candle, atrData: ATRData): ReconstructedCandle {
  const bodyMid = (candle.open + candle.close) / 2;

  // ONLY reconstruct completely flat candles
  // Use minimal ATR percentage to avoid creating artificial volatility
  const wickSize = atrData.atr * 0.3; // Reduced from 0.5 to 0.3 for conservative estimate

  console.warn(
    `[WickReconstruction] ⚠️ Reconstructing FLAT candle for ${candle.symbol} ${candle.timeframe} ` +
    `at ${new Date(candle.open_time).toISOString()} - Original: ${candle.high}/${candle.low}, ` +
    `New: ${(bodyMid + wickSize / 2).toFixed(5)}/${(bodyMid - wickSize / 2).toFixed(5)}`
  );

  return {
    ...candle,
    high: bodyMid + wickSize / 2,
    low: bodyMid - wickSize / 2,
    reconstructed: true,
    reconstruction_method: 'atr_flat_only',
    original_high: candle.high,
    original_low: candle.low
  };
}

/**
 * Fallback reconstruction using simple percentage of body
 * CRITICAL FIX: Only for completely flat candles, minimal extension
 */
function reconstructWicksFallback(candle: Candle): ReconstructedCandle {
  const bodyMid = (candle.open + candle.close) / 2;

  // ONLY reconstruct flat candles - use minimal 0.05% of price as wick
  // This is conservative to avoid creating artificial volatility
  const price = candle.open;
  const wickSize = price * 0.0005; // Reduced from 0.001 to 0.0005

  console.warn(
    `[WickReconstruction] ⚠️ Fallback reconstruction for FLAT candle ${candle.symbol} ${candle.timeframe} ` +
    `at ${new Date(candle.open_time).toISOString()} - Creating minimal range: ` +
    `${(bodyMid + wickSize).toFixed(5)}/${(bodyMid - wickSize).toFixed(5)}`
  );

  return {
    ...candle,
    high: bodyMid + wickSize,
    low: bodyMid - wickSize,
    reconstructed: true,
    reconstruction_method: 'fallback_flat_minimal',
    original_high: candle.high,
    original_low: candle.low
  };
}

/**
 * Main function: Reconstruct wicks for a candle if needed
 */
export async function reconstructCandle(candle: Candle): Promise<ReconstructedCandle> {
  // Calculate ATR for this symbol/timeframe
  const atrData = await calculateATR(candle.symbol, candle.timeframe);

  // Check if reconstruction is needed
  if (!needsReconstruction(candle, atrData)) {
    return {
      ...candle,
      reconstructed: false
    };
  }

  // Reconstruct using ATR if available
  if (atrData) {
    return reconstructWicksFromATR(candle, atrData);
  }

  // Fallback to simple percentage method
  return reconstructWicksFallback(candle);
}

/**
 * Batch reconstruct multiple candles
 */
export async function reconstructCandles(candles: Candle[]): Promise<ReconstructedCandle[]> {
  if (candles.length === 0) return [];

  // Group by symbol/timeframe to reuse ATR calculations
  const groups = new Map<string, Candle[]>();
  candles.forEach(candle => {
    const key = `${candle.symbol}_${candle.timeframe}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(candle);
  });

  const results: ReconstructedCandle[] = [];

  // Process each group
  for (const [key, groupCandles] of groups) {
    const [symbol, timeframe] = key.split('_');
    const atrData = await calculateATR(symbol, timeframe);

    for (const candle of groupCandles) {
      if (!needsReconstruction(candle, atrData)) {
        results.push({
          ...candle,
          reconstructed: false
        });
        continue;
      }

      if (atrData) {
        results.push(reconstructWicksFromATR(candle, atrData));
      } else {
        results.push(reconstructWicksFallback(candle));
      }
    }
  }

  return results;
}

/**
 * Get reconstruction statistics for a set of candles
 */
export function getReconstructionStats(candles: ReconstructedCandle[]): {
  total: number;
  reconstructed: number;
  percentageReconstructed: number;
  byMethod: Record<string, number>;
} {
  const total = candles.length;
  const reconstructed = candles.filter(c => c.reconstructed).length;
  const byMethod: Record<string, number> = {};

  candles.forEach(candle => {
    if (candle.reconstructed && candle.reconstruction_method) {
      byMethod[candle.reconstruction_method] = (byMethod[candle.reconstruction_method] || 0) + 1;
    }
  });

  return {
    total,
    reconstructed,
    percentageReconstructed: (reconstructed / total) * 100,
    byMethod
  };
}

/**
 * Get ATR cache statistics for monitoring
 */
export function getATRCacheStats() {
  return atrCache.getStats();
}

/**
 * Clear ATR cache (useful for testing or forcing recalculation)
 */
export function clearATRCache() {
  atrCache.clear();
}
