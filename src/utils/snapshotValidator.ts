/**
 * Market Snapshot Validator
 *
 * Validates and sanitizes market snapshots before they're used by trading engines.
 * Ensures all required data is present and valid to prevent runtime errors.
 */

import { normalizeTimeframe, findTimeframeInObject } from './timeframeNormalizer';

export interface TimeframeData {
  currentPrice: number;
  ema9: number;
  ema21: number;
  ema50: number;
  rsi: number;
  atr: number;
  vwap: number;
  trend: 'bullish' | 'bearish' | 'sideways';
  volatility: 'low' | 'medium' | 'high';
}

export interface MarketSnapshot {
  symbol: string;
  timeframes: Record<string, TimeframeData>;
  recentPriceAction: string;
  openPositions: number;
  accountExposure: number;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  normalizedSnapshot?: MarketSnapshot;
}

/**
 * Validate a market snapshot for completeness and correctness
 */
export function validateMarketSnapshot(snapshot: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check if snapshot exists
  if (!snapshot) {
    return {
      isValid: false,
      errors: ['Snapshot is null or undefined'],
      warnings: []
    };
  }

  // Validate symbol
  if (!snapshot.symbol || typeof snapshot.symbol !== 'string') {
    errors.push('Invalid or missing symbol');
  }

  // Validate timeframes object exists
  if (!snapshot.timeframes || typeof snapshot.timeframes !== 'object') {
    errors.push('Missing or invalid timeframes object');
    return { isValid: false, errors, warnings };
  }

  // Check if at least one timeframe exists
  const timeframeKeys = Object.keys(snapshot.timeframes);
  if (timeframeKeys.length === 0) {
    errors.push('No timeframe data available');
    return { isValid: false, errors, warnings };
  }

  // Validate each timeframe
  const normalizedTimeframes: Record<string, TimeframeData> = {};

  for (const [key, data] of Object.entries(snapshot.timeframes)) {
    const tfData = data as any;
    const tfErrors: string[] = [];

    // Validate required numeric fields
    if (typeof tfData.currentPrice !== 'number' || isNaN(tfData.currentPrice) || tfData.currentPrice <= 0) {
      tfErrors.push(`${key}: Invalid currentPrice`);
    }

    if (typeof tfData.ema9 !== 'number' || isNaN(tfData.ema9)) {
      if (typeof tfData.currentPrice === 'number') {
        warnings.push(`${key}: Missing ema9, using currentPrice as fallback`);
        tfData.ema9 = tfData.currentPrice;
      } else {
        tfErrors.push(`${key}: Invalid ema9`);
      }
    }

    if (typeof tfData.ema21 !== 'number' || isNaN(tfData.ema21)) {
      if (typeof tfData.currentPrice === 'number') {
        warnings.push(`${key}: Missing ema21, using currentPrice as fallback`);
        tfData.ema21 = tfData.currentPrice;
      } else {
        tfErrors.push(`${key}: Invalid ema21`);
      }
    }

    if (typeof tfData.ema50 !== 'number' || isNaN(tfData.ema50)) {
      if (typeof tfData.currentPrice === 'number') {
        warnings.push(`${key}: Missing ema50, using currentPrice as fallback`);
        tfData.ema50 = tfData.currentPrice;
      } else {
        tfErrors.push(`${key}: Invalid ema50`);
      }
    }

    if (typeof tfData.rsi !== 'number' || isNaN(tfData.rsi) || tfData.rsi < 0 || tfData.rsi > 100) {
      warnings.push(`${key}: Invalid RSI, using 50 as fallback`);
      tfData.rsi = 50;
    }

    if (typeof tfData.atr !== 'number' || isNaN(tfData.atr) || tfData.atr <= 0) {
      if (typeof tfData.currentPrice === 'number') {
        warnings.push(`${key}: Invalid ATR, estimating from currentPrice`);
        tfData.atr = tfData.currentPrice * 0.001;
      } else {
        tfErrors.push(`${key}: Invalid ATR`);
      }
    }

    if (typeof tfData.vwap !== 'number' || isNaN(tfData.vwap) || tfData.vwap <= 0) {
      if (typeof tfData.currentPrice === 'number') {
        warnings.push(`${key}: Invalid VWAP, using currentPrice as fallback`);
        tfData.vwap = tfData.currentPrice;
      } else {
        tfErrors.push(`${key}: Invalid VWAP`);
      }
    }

    // Validate trend
    const validTrends = ['bullish', 'bearish', 'sideways'];
    if (!tfData.trend || !validTrends.includes(tfData.trend)) {
      warnings.push(`${key}: Invalid trend, defaulting to 'sideways'`);
      tfData.trend = 'sideways';
    }

    // Validate volatility
    const validVolatility = ['low', 'medium', 'high'];
    if (!tfData.volatility || !validVolatility.includes(tfData.volatility)) {
      warnings.push(`${key}: Invalid volatility, defaulting to 'medium'`);
      tfData.volatility = 'medium';
    }

    // If there are critical errors, add them to main errors array
    if (tfErrors.length > 0) {
      errors.push(...tfErrors);
    } else {
      // Normalize timeframe key and store valid data
      const normalizedKey = normalizeTimeframe(key, 'metatrader');
      normalizedTimeframes[normalizedKey] = tfData as TimeframeData;
    }
  }

  // Check if we have at least one valid timeframe after validation
  if (Object.keys(normalizedTimeframes).length === 0) {
    errors.push('No valid timeframe data after validation');
    return { isValid: false, errors, warnings };
  }

  // Validate optional fields with defaults
  const recentPriceAction = snapshot.recentPriceAction || 'No recent price action data';
  const openPositions = typeof snapshot.openPositions === 'number' ? snapshot.openPositions : 0;
  const accountExposure = typeof snapshot.accountExposure === 'number' ? snapshot.accountExposure : 0;

  // Build normalized snapshot
  const normalizedSnapshot: MarketSnapshot = {
    symbol: snapshot.symbol,
    timeframes: normalizedTimeframes,
    recentPriceAction,
    openPositions,
    accountExposure
  };

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    normalizedSnapshot: errors.length === 0 ? normalizedSnapshot : undefined
  };
}

/**
 * Validate and normalize a snapshot, throwing an error if invalid
 */
export function validateAndNormalizeSnapshot(snapshot: any): MarketSnapshot {
  const result = validateMarketSnapshot(snapshot);

  if (!result.isValid) {
    throw new Error(
      `[Snapshot Validator] Invalid market snapshot:\n` +
      result.errors.map(e => `  - ${e}`).join('\n')
    );
  }

  if (result.warnings.length > 0) {
    console.warn('[Snapshot Validator] Warnings:');
    result.warnings.forEach(w => console.warn(`  - ${w}`));
  }

  return result.normalizedSnapshot!;
}

/**
 * Get the best available timeframe from a snapshot
 */
export function getBestTimeframe(
  snapshot: MarketSnapshot,
  preferred: string[] = ['M15', '15m', 'M5', '5m', 'H1', '1h']
): { key: string; data: TimeframeData } | null {
  // Try preferred timeframes first
  for (const pref of preferred) {
    const found = findTimeframeInObject(snapshot.timeframes, pref);
    if (found) {
      return { key: found.key, data: found.value };
    }
  }

  // Fallback to first available
  const firstKey = Object.keys(snapshot.timeframes)[0];
  if (firstKey) {
    return {
      key: firstKey,
      data: snapshot.timeframes[firstKey]
    };
  }

  return null;
}
