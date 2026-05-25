/**
 * ATR Type-Safe Extraction Utilities (TIER 3 FIX)
 *
 * SSOT Authority: Safe extraction of ATR values from market data
 *
 * Governance:
 * - Validates: Ensures ATR data exists and is valid before use
 * - Alpha Decides: Uses safe ATR values with confidence in data quality
 * - Degrades Intelligently: Returns fallback values with warnings, never undefined
 *
 * CCIP Compliance: Non-breaking safety enhancement
 *
 * TIER 3 Enhancement: Type-safe ATR extraction to prevent undefined behavior
 * and improve reliability of volatility-based calculations.
 */

import { logger } from '../lib/logger';

export interface SafeATRResult {
  value: number;
  source: 'market_data' | 'fallback' | 'estimated';
  confidence: 'high' | 'medium' | 'low';
  warning?: string;
}

export interface ATRTimeframeData {
  M5?: number;
  M15?: number;
  H1?: number;
  H4?: number;
}

/**
 * TIER 3 FIX: Safe ATR value extraction
 *
 * Extracts ATR value from market data with type safety and fallback logic.
 * Never returns undefined - always provides a usable value with confidence indicator.
 *
 * @param data Market data object that may contain ATR
 * @param symbol Currency pair (for fallback estimation)
 * @returns SafeATRResult with value and metadata
 */
export function safeExtractATRValue(
  data: any,
  symbol: string
): SafeATRResult {
  // Try direct ATR field
  if (data && typeof data.atr === 'number' && data.atr > 0) {
    return {
      value: data.atr,
      source: 'market_data',
      confidence: 'high'
    };
  }

  // Try nested indicator field
  if (data?.indicators?.atr && typeof data.indicators.atr === 'number' && data.indicators.atr > 0) {
    return {
      value: data.indicators.atr,
      source: 'market_data',
      confidence: 'high'
    };
  }

  // Try ATR object with value property
  if (data?.atr?.value && typeof data.atr.value === 'number' && data.atr.value > 0) {
    return {
      value: data.atr.value,
      source: 'market_data',
      confidence: 'high'
    };
  }

  // Fallback: estimate from current price if available
  if (data?.currentPrice || data?.price || data?.close) {
    const price = data.currentPrice || data.price || data.close;
    const estimatedATR = estimateATRFromPrice(price, symbol);

    logger.warn('ATR safe extractor: Market data missing ATR, using price-based estimate', {
      symbol,
      price,
      estimatedATR,
      dataKeys: data ? Object.keys(data) : []
    });

    return {
      value: estimatedATR,
      source: 'estimated',
      confidence: 'low',
      warning: 'ATR unavailable in market data - using price-based estimate'
    };
  }

  // Ultimate fallback: use symbol-based default
  const defaultATR = getDefaultATRForSymbol(symbol);

  logger.warn('ATR safe extractor: No ATR or price data, using symbol default', {
    symbol,
    defaultATR
  });

  return {
    value: defaultATR,
    source: 'fallback',
    confidence: 'low',
    warning: 'No ATR data available - using conservative symbol default'
  };
}

/**
 * TIER 3 FIX: Safe multi-timeframe ATR extraction
 *
 * Extracts ATR values for multiple timeframes with fallback logic.
 *
 * @param data Market data that may contain timeframe-specific ATR values
 * @param symbol Currency pair
 * @param requestedTimeframe Primary timeframe to extract
 * @returns SafeATRResult for requested timeframe
 */
export function safeExtractATRTimeframe(
  data: any,
  symbol: string,
  requestedTimeframe: 'M5' | 'M15' | 'H1' | 'H4'
): SafeATRResult {
  // Try direct timeframe access
  if (data?.atr?.[requestedTimeframe]) {
    const value = data.atr[requestedTimeframe];
    if (typeof value === 'number' && value > 0) {
      return {
        value,
        source: 'market_data',
        confidence: 'high'
      };
    }
  }

  // Try nested timeframe structure
  if (data?.indicators?.atr?.[requestedTimeframe]) {
    const value = data.indicators.atr[requestedTimeframe];
    if (typeof value === 'number' && value > 0) {
      return {
        value,
        source: 'market_data',
        confidence: 'high'
      };
    }
  }

  // Fallback to any available ATR
  const fallbackResult = safeExtractATRValue(data, symbol);

  logger.warn('ATR safe extractor: Requested timeframe ATR unavailable, using fallback', {
    symbol,
    requestedTimeframe,
    fallbackValue: fallbackResult.value,
    fallbackSource: fallbackResult.source
  });

  return {
    ...fallbackResult,
    warning: `${requestedTimeframe} ATR unavailable - using ${fallbackResult.source} ATR`
  };
}

/**
 * Extract all available timeframe ATRs with safety
 */
export function safeExtractAllTimeframeATRs(
  data: any,
  symbol: string
): { data: ATRTimeframeData; confidence: 'high' | 'medium' | 'low' } {
  const result: ATRTimeframeData = {};
  let foundCount = 0;

  const timeframes: Array<'M5' | 'M15' | 'H1' | 'H4'> = ['M5', 'M15', 'H1', 'H4'];

  for (const tf of timeframes) {
    const extracted = safeExtractATRTimeframe(data, symbol, tf);
    if (extracted.source === 'market_data') {
      result[tf] = extracted.value;
      foundCount++;
    }
  }

  const confidence: 'high' | 'medium' | 'low' =
    foundCount >= 3 ? 'high' : foundCount >= 2 ? 'medium' : 'low';

  return { data: result, confidence };
}

/**
 * Estimate ATR from current price (rough approximation)
 * Uses typical ATR/price ratios for different asset classes
 */
function estimateATRFromPrice(price: number, symbol: string): number {
  const normalized = symbol.toUpperCase();

  // Crypto: typically 2-5% daily volatility
  if (normalized.includes('BTC') || normalized.includes('ETH') || normalized.includes('SOL')) {
    return price * 0.03; // 3% estimate
  }

  // Gold/Silver: typically 1-2% daily volatility
  if (normalized.includes('XAU') || normalized.includes('XAG')) {
    return price * 0.015; // 1.5% estimate
  }

  // Indices: typically 1-3% daily volatility
  if (normalized.includes('US30') || normalized.includes('SPX') || normalized.includes('NAS')) {
    return price * 0.02; // 2% estimate
  }

  // Forex: typical ATR is 0.5-1% of price
  return price * 0.007; // 0.7% estimate for forex
}

/**
 * Get conservative default ATR for symbol
 */
function getDefaultATRForSymbol(symbol: string): number {
  const normalized = symbol.toUpperCase();

  // Crypto defaults (in USD terms)
  if (normalized.includes('BTC')) return 1500;
  if (normalized.includes('ETH')) return 80;
  if (normalized.includes('SOL')) return 5;

  // Metals defaults
  if (normalized.includes('XAU')) return 30; // Gold
  if (normalized.includes('XAG')) return 0.5; // Silver

  // Indices defaults
  if (normalized.includes('US30')) return 250;
  if (normalized.includes('SPX')) return 30;
  if (normalized.includes('NAS')) return 120;

  // Forex defaults (in pips)
  if (normalized.includes('JPY')) return 0.5; // 50 pips for JPY pairs
  if (normalized.includes('GBP')) return 0.008; // 80 pips for GBP pairs
  if (normalized.includes('EUR')) return 0.0007; // 70 pips for EUR pairs

  // Generic forex default
  return 0.0006; // 60 pips
}

/**
 * Validate ATR value is reasonable for the symbol
 * Returns true if value seems valid, false if suspicious
 */
export function validateATRValue(
  atr: number,
  price: number,
  symbol: string
): { valid: boolean; reason?: string } {
  // ATR should never be zero or negative
  if (atr <= 0) {
    return { valid: false, reason: 'ATR is zero or negative' };
  }

  // ATR should not exceed price (that would be insane volatility)
  if (atr > price) {
    return { valid: false, reason: 'ATR exceeds current price - likely data error' };
  }

  // Check reasonable ranges as percentage of price
  const atrPercent = (atr / price) * 100;

  // Forex: 0.3% - 2% is reasonable
  if (!symbol.toUpperCase().includes('XAU') && !symbol.toUpperCase().includes('US30')) {
    if (atrPercent < 0.3 || atrPercent > 2) {
      return { valid: false, reason: `ATR ${atrPercent.toFixed(2)}% of price is outside typical forex range (0.3-2%)` };
    }
  }

  return { valid: true };
}
