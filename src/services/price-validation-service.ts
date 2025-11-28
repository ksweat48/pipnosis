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
  // Major Forex Pairs
  EURUSD: { min: 0.50, max: 2.00, typical: 1.10 },
  GBPUSD: { min: 0.50, max: 3.00, typical: 1.27 },
  USDJPY: { min: 50, max: 200, typical: 149 },
  AUDUSD: { min: 0.40, max: 1.50, typical: 0.65 },
  USDCAD: { min: 0.80, max: 2.00, typical: 1.36 },
  NZDUSD: { min: 0.40, max: 1.50, typical: 0.59 },
  USDCHF: { min: 0.60, max: 1.50, typical: 0.88 },

  // Cross Pairs
  EURGBP: { min: 0.60, max: 1.20, typical: 0.86 },
  EURJPY: { min: 80, max: 220, typical: 163 },
  GBPJPY: { min: 100, max: 250, typical: 189 },
  AUDJPY: { min: 50, max: 150, typical: 97 },
  EURAUD: { min: 1.00, max: 2.00, typical: 1.70 },

  // Commodities
  XAUUSD: { min: 1000, max: 10000, typical: 2600 }, // Gold
  XAGUSD: { min: 10, max: 100, typical: 30 }, // Silver
  XPTUSD: { min: 500, max: 2000, typical: 950 }, // Platinum
  XPDUSD: { min: 500, max: 3500, typical: 1000 }, // Palladium

  // Indices (CFD)
  US30: { min: 10000, max: 60000, typical: 39500 }, // Dow Jones
  NAS100: { min: 5000, max: 25000, typical: 16200 }, // NASDAQ
  SPX500: { min: 2000, max: 7000, typical: 5000 }, // S&P 500
  UK100: { min: 4000, max: 10000, typical: 7500 }, // FTSE 100
  GER40: { min: 8000, max: 20000, typical: 17200 }, // DAX

  // Crypto (common pairs)
  BTCUSD: { min: 10000, max: 150000, typical: 65000 },
  ETHUSD: { min: 500, max: 10000, typical: 3200 },

  // Oil
  USOIL: { min: 20, max: 200, typical: 75 }, // WTI Crude
  UKOIL: { min: 20, max: 200, typical: 78 }, // Brent Crude
};

export interface PriceValidationResult {
  isValid: boolean;
  reason?: string;
  expectedRange?: PriceRange;
  deviation?: number; // How far from typical price (as percentage)
}

export class PriceValidationService {
  /**
   * Validates if a price is within acceptable range for a symbol
   */
  validatePrice(symbol: string, price: number): PriceValidationResult {
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

    return {
      isValid: true,
      expectedRange: range,
      deviation
    };
  }

  /**
   * Validates a candle's OHLC values
   */
  validateCandle(symbol: string, candle: { open: number; high: number; low: number; close: number }): PriceValidationResult {
    const prices = [candle.open, candle.high, candle.low, candle.close];

    // Validate each price
    for (const price of prices) {
      const result = this.validatePrice(symbol, price);
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
        if (deviation < 20) { // Price is within 20% of typical for this symbol
          logger.error(LogCategory.CHART, `[PriceValidation] 🚨 CROSS-CONTAMINATION DETECTED: ${symbol} received ${otherSymbol} price ${price}`);
          return otherSymbol;
        }
      }
    }

    return null; // Price is just invalid, not a clear mismatch
  }
}

export const priceValidationService = new PriceValidationService();
