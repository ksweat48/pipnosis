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

/**
 * Calculate ATR (Average True Range) from recent candles
 */
async function calculateATR(
  symbol: string,
  timeframe: string,
  lookbackPeriods: number = 14
): Promise<ATRData | null> {
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

    return {
      atr,
      avgWickPercent: (avgUpperWickPercent + avgLowerWickPercent) / 2,
      avgUpperWickPercent,
      avgLowerWickPercent
    };
  } catch (error) {
    console.error('[WickReconstruction] Error calculating ATR:', error);
    return null;
  }
}

/**
 * Determine if a candle needs wick reconstruction
 * Flat candle = open == high == low == close (only 1 tick)
 * Low-quality candle = very small range relative to ATR
 */
function needsReconstruction(candle: Candle, atrData: ATRData | null): boolean {
  const range = candle.high - candle.low;

  // Definitely needs reconstruction if it's a flat candle
  if (range === 0) {
    return true;
  }

  // If we have ATR data, check if range is suspiciously small
  if (atrData && range < atrData.atr * 0.1) {
    // Range is less than 10% of typical ATR
    return true;
  }

  // Low tick volume also indicates poor quality
  if (candle.volume <= 2) {
    return true;
  }

  return false;
}

/**
 * Reconstruct wicks using ATR-based estimation
 */
function reconstructWicksFromATR(candle: Candle, atrData: ATRData): ReconstructedCandle {
  const bodyMid = (candle.open + candle.close) / 2;
  const bodySize = Math.abs(candle.close - candle.open);

  // If flat candle (no body), use ATR directly
  if (bodySize === 0) {
    const wickSize = atrData.atr * 0.5; // Use 50% of ATR for wick estimation
    return {
      ...candle,
      high: bodyMid + wickSize / 2,
      low: bodyMid - wickSize / 2,
      reconstructed: true,
      reconstruction_method: 'atr_flat',
      original_high: candle.high,
      original_low: candle.low
    };
  }

  // For non-flat candles, add realistic wicks based on historical patterns
  const upperWick = bodySize * atrData.avgUpperWickPercent;
  const lowerWick = bodySize * atrData.avgLowerWickPercent;

  const bodyTop = Math.max(candle.open, candle.close);
  const bodyBottom = Math.min(candle.open, candle.close);

  return {
    ...candle,
    high: Math.max(candle.high, bodyTop + upperWick),
    low: Math.min(candle.low, bodyBottom - lowerWick),
    reconstructed: true,
    reconstruction_method: 'atr_pattern',
    original_high: candle.high,
    original_low: candle.low
  };
}

/**
 * Fallback reconstruction using simple percentage of body
 */
function reconstructWicksFallback(candle: Candle): ReconstructedCandle {
  const bodyMid = (candle.open + candle.close) / 2;
  const bodySize = Math.abs(candle.close - candle.open);

  // Default: 30% wick on each side
  const DEFAULT_WICK_PERCENT = 0.3;

  if (bodySize === 0) {
    // Flat candle: use 0.1% of price as wick
    const price = candle.open;
    const wickSize = price * 0.001;
    return {
      ...candle,
      high: bodyMid + wickSize,
      low: bodyMid - wickSize,
      reconstructed: true,
      reconstruction_method: 'fallback_flat',
      original_high: candle.high,
      original_low: candle.low
    };
  }

  const upperWick = bodySize * DEFAULT_WICK_PERCENT;
  const lowerWick = bodySize * DEFAULT_WICK_PERCENT;

  const bodyTop = Math.max(candle.open, candle.close);
  const bodyBottom = Math.min(candle.open, candle.close);

  return {
    ...candle,
    high: Math.max(candle.high, bodyTop + upperWick),
    low: Math.min(candle.low, bodyBottom - lowerWick),
    reconstructed: true,
    reconstruction_method: 'fallback_pattern',
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
