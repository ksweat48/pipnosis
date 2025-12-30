/**
 * Price Validation Service
 *
 * Provides symbol-specific price range validation to prevent cross-symbol contamination.
 * Rejects any price that falls outside the expected range for a given symbol.
 */

import { logger, LogCategory } from '@/lib/logger';

interface PriceRange {
  min: number;
  max: number;
  typical: number; // Typical/average price for reference
}

const SYMBOL_PRICE_RANGES: Record<string, PriceRange> = {
  // Major Forex Pairs - UPDATED RANGES (Dec 2025)
  EURUSD: { min: 0.95, max: 1.30, typical: 1.16 },
  GBPUSD: { min: 1.10, max: 1.50, typical: 1.32 },
  USDJPY: { min: 100, max: 180, typical: 155 },
  AUDUSD: { min: 0.50, max: 0.90, typical: 0.65 },
  USDCAD: { min: 1.15, max: 1.60, typical: 1.36 },
  NZDUSD: { min: 0.45, max: 0.80, typical: 0.59 },
  USDCHF: { min: 0.75, max: 1.10, typical: 0.88 },

  // Cross Pairs - TIGHTENED RANGES
  EURGBP: { min: 0.70, max: 1.00, typical: 0.86 },
  EURJPY: { min: 120, max: 200, typical: 163 },
  GBPJPY: { min: 140, max: 220, typical: 189 },
  AUDJPY: { min: 70, max: 120, typical: 97 },
  EURAUD: { min: 1.40, max: 1.90, typical: 1.70 },

  // Commodities - UPDATED RANGES (Dec 2025)
  XAUUSD: { min: 2000, max: 5500, typical: 4500 }, // Gold - updated for current rally (Dec 29: trading at 4480-4520)
  XAGUSD: { min: 18, max: 50, typical: 30 }, // Silver
  XPTUSD: { min: 700, max: 1300, typical: 950 }, // Platinum
  XPDUSD: { min: 700, max: 1800, typical: 1000 }, // Palladium

  // Indices (CFD) - UPDATED RANGES (Dec 30, 2025)
  US30: { min: 35000, max: 52000, typical: 42500 }, // Dow Jones - Updated Dec 30, 2025 (trading at ~42,500)
  NAS100: { min: 20000, max: 30000, typical: 25500 }, // NASDAQ - Updated Dec 30, 2025 (trading at ~25,500)
  SPX500: { min: 4500, max: 6500, typical: 5900 }, // S&P 500 - Updated Dec 30, 2025 (trading at ~5,900)
  UK100: { min: 6500, max: 8800, typical: 7500 }, // FTSE 100
  GER40: { min: 14000, max: 20000, typical: 17200 }, // DAX

  // Crypto (common pairs) - ULTRA-TIGHT RANGES (Dec 2025)
  // CRITICAL FIX: Narrow ranges based on current market conditions to prevent stale data
  BTCUSD: { min: 82000, max: 102000, typical: 95000 }, // BTC current trading range
  ETHUSD: { min: 2800, max: 3800, typical: 3300 }, // ETH current trading range

  // Oil - TIGHTENED RANGES
  USOIL: { min: 50, max: 110, typical: 75 }, // WTI Crude
  UKOIL: { min: 55, max: 115, typical: 78 }, // Brent Crude
};

export interface PriceValidationResult {
  isValid: boolean;
  reason?: string;
  expectedRange?: PriceRange;
  deviation?: number; // How far from typical price (as percentage)
}

// Crypto symbols for stricter validation
const CRYPTO_SYMBOLS = ['BTCUSD', 'ETHUSD'];

export class PriceValidationService {
  // Track last prices for velocity validation
  private lastPrices: Map<string, { price: number; timestamp: number }> = new Map();

  // Maximum price change per second (as percentage of typical price)
  private readonly MAX_VELOCITY_PERCENT_PER_SECOND = 1.0; // 1% per second max (forex/indices)
  private readonly MAX_CRYPTO_VELOCITY_PERCENT_PER_SECOND = 0.5; // 0.5% per second max (crypto - stricter)

  /**
   * Validates if a price is within acceptable range for a symbol
   * @param skipVelocity - Skip velocity validation (for historical data)
   */
  validatePrice(symbol: string, price: number, skipVelocity: boolean = false): PriceValidationResult {
    // Check if price is a valid number
    if (typeof price !== 'number' || isNaN(price) || !isFinite(price)) {
      return {
        isValid: false,
        reason: `Invalid price value: ${price} (type: ${typeof price})`
      };
    }

    // Get expected range for symbol
    const range = SYMBOL_PRICE_RANGES[symbol];

    if (!range) {
      // Unknown symbol - log warning but allow (conservative approach)
      logger.warn(LogCategory.CHART, `[PriceValidation] Unknown symbol ${symbol}, no validation range defined`);
      return {
        isValid: true,
        reason: 'Unknown symbol - validation skipped'
      };
    }

    // Check if price is within range
    if (price < range.min || price > range.max) {
      const deviation = Math.abs((price - range.typical) / range.typical * 100);

      logger.error(LogCategory.CHART, `[PriceValidation] ❌ REJECTED ${symbol} price ${price} (expected ${range.min}-${range.max}, typical: ${range.typical}, deviation: ${deviation.toFixed(1)}%)`);

      return {
        isValid: false,
        reason: `Price ${price} outside valid range ${range.min}-${range.max}`,
        expectedRange: range,
        deviation
      };
    }

    // Calculate deviation from typical price
    const deviation = Math.abs((price - range.typical) / range.typical * 100);

    // Warn if price is unusual (>50% deviation from typical)
    if (deviation > 50) {
      logger.warn(LogCategory.CHART, `[PriceValidation] ⚠️ UNUSUAL ${symbol} price ${price} (${deviation.toFixed(1)}% from typical ${range.typical})`);
    }

    // CRITICAL FIX: Skip velocity validation for historical/database-sourced data
    if (!skipVelocity) {
      const velocityCheck = this.validatePriceVelocity(symbol, price, range);
      if (!velocityCheck.isValid) {
        return velocityCheck;
      }

      // Update last price for next velocity check
      this.lastPrices.set(symbol, { price, timestamp: Date.now() });
    }

    return {
      isValid: true,
      expectedRange: range,
      deviation
    };
  }

  /**
   * Validates price velocity (rate of change)
   * IMPORTANT: Only validates LIVE prices, not historical data
   */
  private validatePriceVelocity(
    symbol: string,
    newPrice: number,
    range: PriceRange
  ): PriceValidationResult {
    const lastPriceData = this.lastPrices.get(symbol);

    // First price - no velocity to check
    if (!lastPriceData) {
      return { isValid: true };
    }

    const timeDiff = (Date.now() - lastPriceData.timestamp) / 1000; // seconds

    // CRITICAL FIX: Skip velocity check if insufficient time has passed (<0.5s)
    // This prevents false positives when checking the same price multiple times rapidly
    if (timeDiff < 0.5) {
      return { isValid: true };
    }

    // CRITICAL FIX: Skip velocity check if too much time has passed (>10 seconds)
    // This indicates we're loading historical data or recovering from pause, not live ticking
    if (timeDiff > 10) {
      // Reset the last price to avoid false positives
      this.lastPrices.set(symbol, { price: newPrice, timestamp: Date.now() });
      return { isValid: true };
    }

    const priceDiff = Math.abs(newPrice - lastPriceData.price);
    const percentChange = (priceDiff / range.typical) * 100;

    // Calculate velocity (percent change per second)
    const velocity = timeDiff > 0 ? percentChange / timeDiff : 0;

    // CRITICAL FIX: Use stricter velocity limit for crypto
    const isCrypto = CRYPTO_SYMBOLS.includes(symbol);
    const maxVelocity = isCrypto
      ? this.MAX_CRYPTO_VELOCITY_PERCENT_PER_SECOND
      : this.MAX_VELOCITY_PERCENT_PER_SECOND;

    // Check if velocity exceeds maximum
    if (velocity > maxVelocity) {
      logger.error(
        LogCategory.CHART,
        `[PriceValidation] ❌ VELOCITY LIMIT EXCEEDED for ${symbol}: ${velocity.toFixed(2)}%/s (max: ${maxVelocity}%/s)${isCrypto ? ' [CRYPTO]' : ''}`
      );

      return {
        isValid: false,
        reason: `Price changed too fast: ${priceDiff.toFixed(5)} in ${timeDiff.toFixed(1)}s (${velocity.toFixed(2)}%/s)`,
        expectedRange: range,
        deviation: percentChange,
      };
    }

    // Warn if velocity is high but under limit
    if (velocity > maxVelocity * 0.7) {
      logger.warn(
        LogCategory.CHART,
        `[PriceValidation] ⚠️ HIGH VELOCITY for ${symbol}: ${velocity.toFixed(2)}%/s (limit: ${maxVelocity}%/s)${isCrypto ? ' [CRYPTO]' : ''}`
      );
    }

    return { isValid: true };
  }

  /**
   * Validates a candle's OHLC values
   * @param skipVelocity - Skip velocity validation (for historical data)
   */
  validateCandle(symbol: string, candle: { open: number; high: number; low: number; close: number }, skipVelocity: boolean = false): PriceValidationResult {
    const prices = [candle.open, candle.high, candle.low, candle.close];

    // Validate each price (skip velocity for historical data)
    for (const price of prices) {
      const result = this.validatePrice(symbol, price, skipVelocity);
      if (!result.isValid) {
        return result;
      }
    }

    // Additional candle-specific validations
    if (candle.high < candle.low) {
      return {
        isValid: false,
        reason: `Invalid candle: high ${candle.high} < low ${candle.low}`
      };
    }

    if (candle.open < candle.low || candle.open > candle.high) {
      return {
        isValid: false,
        reason: `Invalid candle: open ${candle.open} outside range [${candle.low}, ${candle.high}]`
      };
    }

    if (candle.close < candle.low || candle.close > candle.high) {
      return {
        isValid: false,
        reason: `Invalid candle: close ${candle.close} outside range [${candle.low}, ${candle.high}]`
      };
    }

    return { isValid: true };
  }

  /**
   * Gets the expected price range for a symbol
   */
  getPriceRange(symbol: string): PriceRange | null {
    return SYMBOL_PRICE_RANGES[symbol] || null;
  }

  /**
   * Checks if a symbol has a defined price range
   */
  hasValidationRange(symbol: string): boolean {
    return symbol in SYMBOL_PRICE_RANGES;
  }

  /**
   * Detects if a price likely belongs to a different symbol
   */
  detectPossibleSymbolMismatch(symbol: string, price: number): string | null {
    // First check if price is valid for the intended symbol
    const validationResult = this.validatePrice(symbol, price);
    if (validationResult.isValid) {
      return null; // No mismatch
    }

    // Check if this price matches a different symbol's range
    for (const [otherSymbol, range] of Object.entries(SYMBOL_PRICE_RANGES)) {
      if (otherSymbol === symbol) continue;

      // Check if price falls within this other symbol's range and is close to typical
      if (price >= range.min && price <= range.max) {
        const deviation = Math.abs((price - range.typical) / range.typical * 100);
        // CRITICAL FIX: Increase threshold to 30% to reduce false positives
        // Gold at 4240 and SPX500 at 5000 can overlap, so we need stricter matching
        if (deviation < 10) { // Price is within 10% of typical for this symbol (very close match)
          logger.error(LogCategory.CHART, `[PriceValidation] 🚨 CROSS-CONTAMINATION DETECTED: ${symbol} received ${otherSymbol} price ${price}`);
          return otherSymbol;
        }
      }
    }

    return null; // Price is just invalid, not a clear mismatch
  }
}

export const priceValidationService = new PriceValidationService();
