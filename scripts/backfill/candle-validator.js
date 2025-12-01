/**
 * Candle validation using the chart protection system
 * Ensures no contaminated candles reach the database
 */

// Price ranges for validation (from price-validation-service.ts)
const PRICE_RANGES = {
  EURUSD: { min: 0.90, max: 1.40, typical: 1.10 },
  GBPUSD: { min: 1.00, max: 1.60, typical: 1.30 },
  USDJPY: { min: 90, max: 180, typical: 140 },
  AUDUSD: { min: 0.55, max: 0.90, typical: 0.70 },
  NZDUSD: { min: 0.50, max: 0.75, typical: 0.62 },
  USDCAD: { min: 1.20, max: 1.50, typical: 1.35 },
  USDCHF: { min: 0.80, max: 1.10, typical: 0.95 },
  XAUUSD: { min: 1800, max: 3500, typical: 2400 },
  XAGUSD: { min: 15, max: 40, typical: 25 },
  US30: { min: 30000, max: 50000, typical: 38000 },
  NAS100: { min: 10000, max: 20000, typical: 15000 },
  SPX500: { min: 3500, max: 6000, typical: 4500 },
  BTCUSD: { min: 15000, max: 100000, typical: 50000 },
  ETHUSD: { min: 1000, max: 10000, typical: 3000 },
};

// Known symbols (from symbol.ts)
const KNOWN_SYMBOLS = [
  'XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY',
  'AUDUSD', 'USDCAD', 'NZDUSD', 'USDCHF', 'EURGBP',
  'EURJPY', 'GBPJPY', 'AUDJPY', 'EURAUD', 'XAGUSD',
  'XPTUSD', 'XPDUSD', 'NAS100', 'SPX500', 'UK100',
  'GER40', 'BTCUSD', 'ETHUSD', 'USOIL', 'UKOIL',
];

class CandleValidator {
  constructor() {
    this.stats = {
      total: 0,
      valid: 0,
      invalidSymbol: 0,
      invalidRange: 0,
      invalidStructure: 0,
      contamination: 0,
    };
  }

  // Validate symbol
  validateSymbol(symbol) {
    if (typeof symbol !== 'string' || !symbol.trim()) {
      return { isValid: false, error: 'Symbol must be a non-empty string' };
    }

    const normalized = symbol.trim().toUpperCase();
    if (!KNOWN_SYMBOLS.includes(normalized)) {
      return { isValid: false, error: `Unknown symbol: ${symbol}` };
    }

    return { isValid: true, symbol: normalized };
  }

  // Validate price is within range for symbol
  validatePriceRange(symbol, price) {
    const range = PRICE_RANGES[symbol];
    if (!range) {
      // No specific range, do basic validation
      return price > 0 && price < 1000000;
    }

    return price >= range.min && price <= range.max;
  }

  // Detect cross-contamination (wrong symbol's prices)
  detectContamination(symbol, price) {
    // Check if this price matches another symbol's range better
    for (const [otherSymbol, range] of Object.entries(PRICE_RANGES)) {
      if (otherSymbol === symbol) continue;

      // If price is in other symbol's typical range but not in this symbol's range
      if (price >= range.min && price <= range.max) {
        const ourRange = PRICE_RANGES[symbol];
        if (ourRange && (price < ourRange.min || price > ourRange.max)) {
          return otherSymbol; // Contamination detected
        }
      }
    }

    return null;
  }

  // Validate OHLC structure
  validateCandleStructure(candle) {
    const errors = [];

    // Check all prices exist
    if (typeof candle.open !== 'number' || isNaN(candle.open) || !isFinite(candle.open)) {
      errors.push('Invalid open price');
    }
    if (typeof candle.high !== 'number' || isNaN(candle.high) || !isFinite(candle.high)) {
      errors.push('Invalid high price');
    }
    if (typeof candle.low !== 'number' || isNaN(candle.low) || !isFinite(candle.low)) {
      errors.push('Invalid low price');
    }
    if (typeof candle.close !== 'number' || isNaN(candle.close) || !isFinite(candle.close)) {
      errors.push('Invalid close price');
    }

    if (errors.length > 0) {
      return { isValid: false, errors };
    }

    // Check all prices are positive
    if (candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0) {
      errors.push('All prices must be positive');
    }

    // High must be >= Low
    if (candle.high < candle.low) {
      errors.push(`High ${candle.high} must be >= Low ${candle.low}`);
    }

    // Open must be between high and low
    if (candle.open < candle.low || candle.open > candle.high) {
      errors.push(`Open ${candle.open} must be between Low ${candle.low} and High ${candle.high}`);
    }

    // Close must be between high and low
    if (candle.close < candle.low || candle.close > candle.high) {
      errors.push(`Close ${candle.close} must be between Low ${candle.low} and High ${candle.high}`);
    }

    // Check time is valid
    if (typeof candle.time !== 'number' || candle.time <= 0) {
      errors.push('Invalid timestamp');
    }

    // Check time is not in far future (allow 1 hour buffer)
    const now = Date.now() / 1000;
    if (candle.time > now + 3600) {
      errors.push('Timestamp is in the future');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // Validate single candle completely
  validateCandle(candle) {
    this.stats.total++;

    // Validate symbol
    const symbolValidation = this.validateSymbol(candle.symbol);
    if (!symbolValidation.isValid) {
      this.stats.invalidSymbol++;
      return {
        isValid: false,
        reason: 'invalid_symbol',
        error: symbolValidation.error,
      };
    }

    const symbol = symbolValidation.symbol;

    // Validate structure
    const structureValidation = this.validateCandleStructure(candle);
    if (!structureValidation.isValid) {
      this.stats.invalidStructure++;
      return {
        isValid: false,
        reason: 'invalid_structure',
        error: structureValidation.errors.join('; '),
      };
    }

    // Validate price ranges
    const prices = [candle.open, candle.high, candle.low, candle.close];
    for (const price of prices) {
      if (!this.validatePriceRange(symbol, price)) {
        this.stats.invalidRange++;
        return {
          isValid: false,
          reason: 'invalid_range',
          error: `Price ${price} outside valid range for ${symbol}`,
        };
      }
    }

    // Detect contamination
    for (const price of prices) {
      const contaminationSource = this.detectContamination(symbol, price);
      if (contaminationSource) {
        this.stats.contamination++;
        return {
          isValid: false,
          reason: 'contamination',
          error: `Price ${price} appears to be from ${contaminationSource}, not ${symbol}`,
          contaminatedSymbol: contaminationSource,
        };
      }
    }

    this.stats.valid++;
    return {
      isValid: true,
      candle: {
        ...candle,
        symbol, // Use normalized symbol
      },
    };
  }

  // Validate batch of candles
  validateBatch(candles, expectedSymbol) {
    const results = {
      valid: [],
      invalid: [],
      stats: {
        total: candles.length,
        valid: 0,
        invalidSymbol: 0,
        invalidRange: 0,
        invalidStructure: 0,
        contamination: 0,
      },
    };

    for (const candle of candles) {
      // Verify symbol matches expected
      if (candle.symbol !== expectedSymbol) {
        results.invalid.push({
          candle,
          reason: 'symbol_mismatch',
          error: `Expected ${expectedSymbol}, got ${candle.symbol}`,
        });
        results.stats.invalidSymbol++;
        continue;
      }

      const validation = this.validateCandle(candle);
      if (validation.isValid) {
        results.valid.push(validation.candle);
        results.stats.valid++;
      } else {
        results.invalid.push({
          candle,
          ...validation,
        });

        // Update stats
        if (validation.reason === 'invalid_symbol') results.stats.invalidSymbol++;
        else if (validation.reason === 'invalid_range') results.stats.invalidRange++;
        else if (validation.reason === 'invalid_structure') results.stats.invalidStructure++;
        else if (validation.reason === 'contamination') results.stats.contamination++;
      }
    }

    return results;
  }

  // Get validation statistics
  getStats() {
    return {
      ...this.stats,
      validationRate: this.stats.total > 0
        ? ((this.stats.valid / this.stats.total) * 100).toFixed(2) + '%'
        : '0%',
    };
  }

  // Reset statistics
  resetStats() {
    this.stats = {
      total: 0,
      valid: 0,
      invalidSymbol: 0,
      invalidRange: 0,
      invalidStructure: 0,
      contamination: 0,
    };
  }
}

module.exports = { CandleValidator, KNOWN_SYMBOLS, PRICE_RANGES };
