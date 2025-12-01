/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🧪 PRICE VALIDATION TESTS - Range & Velocity Protection
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { priceValidationService } from '@/services/price-validation-service';

describe('Price Validation - Range & Velocity Protection', () => {
  beforeEach(() => {
    // Reset service state before each test
    priceValidationService['lastPrices'].clear();
  });

  describe('Price Range Validation', () => {
    test('should accept valid EURUSD prices', () => {
      const validPrices = [0.90, 1.00, 1.10, 1.20, 1.30, 1.40];
      validPrices.forEach(price => {
        const result = priceValidationService.validatePrice('EURUSD', price);
        expect(result.isValid).toBe(true);
      });
    });

    test('should reject EURUSD prices outside range', () => {
      const invalidPrices = [0.50, 0.89, 1.41, 2.00];
      invalidPrices.forEach(price => {
        const result = priceValidationService.validatePrice('EURUSD', price);
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('outside valid range');
      });
    });

    test('should accept valid XAUUSD prices', () => {
      const validPrices = [1800, 2000, 2400, 2800, 3200, 3500];
      validPrices.forEach(price => {
        const result = priceValidationService.validatePrice('XAUUSD', price);
        expect(result.isValid).toBe(true);
      });
    });

    test('should reject XAUUSD prices outside range', () => {
      const invalidPrices = [1000, 1799, 3501, 5000];
      invalidPrices.forEach(price => {
        const result = priceValidationService.validatePrice('XAUUSD', price);
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('outside valid range');
      });
    });

    test('should accept valid US30 prices', () => {
      const validPrices = [30000, 35000, 40000, 45000, 50000];
      validPrices.forEach(price => {
        const result = priceValidationService.validatePrice('US30', price);
        expect(result.isValid).toBe(true);
      });
    });

    test('should reject US30 prices outside range', () => {
      const invalidPrices = [20000, 29999, 50001, 60000];
      invalidPrices.forEach(price => {
        const result = priceValidationService.validatePrice('US30', price);
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('outside valid range');
      });
    });

    test('should accept valid GBPUSD prices', () => {
      const validPrices = [1.00, 1.20, 1.30, 1.50, 1.60];
      validPrices.forEach(price => {
        const result = priceValidationService.validatePrice('GBPUSD', price);
        expect(result.isValid).toBe(true);
      });
    });

    test('should accept valid USDJPY prices', () => {
      const validPrices = [90, 110, 130, 150, 170, 180];
      validPrices.forEach(price => {
        const result = priceValidationService.validatePrice('USDJPY', price);
        expect(result.isValid).toBe(true);
      });
    });
  });

  describe('Velocity Validation', () => {
    test('should accept normal price movements', () => {
      // First price
      priceValidationService.validatePrice('EURUSD', 1.1000);

      // Wait 2 seconds, move 0.5% (within 1%/sec limit)
      jest.advanceTimersByTime(2000);
      const result = priceValidationService.validatePrice('EURUSD', 1.1055);

      expect(result.isValid).toBe(true);
    });

    test('should reject extreme price velocity', () => {
      // First price
      priceValidationService.validatePrice('EURUSD', 1.1000);

      // Immediate jump of 5% (exceeds 1%/sec limit)
      jest.advanceTimersByTime(100); // 0.1 seconds
      const result = priceValidationService.validatePrice('EURUSD', 1.1550);

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('velocity');
    });

    test('should allow gradual price increases', () => {
      let price = 1.1000;

      for (let i = 0; i < 10; i++) {
        const result = priceValidationService.validatePrice('EURUSD', price);
        expect(result.isValid).toBe(true);

        price += 0.0005; // Small increment
        jest.advanceTimersByTime(1000); // 1 second
      }
    });

    test('should track velocity per symbol independently', () => {
      // Set EURUSD price
      priceValidationService.validatePrice('EURUSD', 1.1000);

      // Set XAUUSD price (should not affect EURUSD tracking)
      priceValidationService.validatePrice('XAUUSD', 2600);

      jest.advanceTimersByTime(1000);

      // Both should accept reasonable moves
      const eurusdResult = priceValidationService.validatePrice('EURUSD', 1.1010);
      const xauusdResult = priceValidationService.validatePrice('XAUUSD', 2610);

      expect(eurusdResult.isValid).toBe(true);
      expect(xauusdResult.isValid).toBe(true);
    });
  });

  describe('Cross-Contamination Detection', () => {
    test('should detect XAUUSD price in EURUSD', () => {
      const mismatch = priceValidationService.detectPossibleSymbolMismatch(
        'EURUSD',
        2600 // This is XAUUSD price
      );

      expect(mismatch).toBe('XAUUSD');
    });

    test('should detect US30 price in EURUSD', () => {
      const mismatch = priceValidationService.detectPossibleSymbolMismatch(
        'EURUSD',
        39500 // This is US30 price
      );

      expect(mismatch).toBe('US30');
    });

    test('should detect EURUSD price in XAUUSD', () => {
      const mismatch = priceValidationService.detectPossibleSymbolMismatch(
        'XAUUSD',
        1.1050 // This is EURUSD price
      );

      expect(mismatch).toBe('EURUSD');
    });

    test('should detect USDJPY price in EURUSD', () => {
      const mismatch = priceValidationService.detectPossibleSymbolMismatch(
        'EURUSD',
        149.50 // This is USDJPY price
      );

      expect(mismatch).toBe('USDJPY');
    });

    test('should return null for correct symbol prices', () => {
      const mismatch1 = priceValidationService.detectPossibleSymbolMismatch('EURUSD', 1.1050);
      const mismatch2 = priceValidationService.detectPossibleSymbolMismatch('XAUUSD', 2600);
      const mismatch3 = priceValidationService.detectPossibleSymbolMismatch('US30', 39500);

      expect(mismatch1).toBeNull();
      expect(mismatch2).toBeNull();
      expect(mismatch3).toBeNull();
    });
  });

  describe('Candle Validation', () => {
    test('should accept valid candles', () => {
      const result = priceValidationService.validateCandle('EURUSD', {
        open: 1.1000,
        high: 1.1020,
        low: 1.0980,
        close: 1.1010,
      });

      expect(result.isValid).toBe(true);
    });

    test('should reject candles with invalid structure', () => {
      const result = priceValidationService.validateCandle('EURUSD', {
        open: 1.1000,
        high: 1.0980, // High less than low
        low: 1.1020,
        close: 1.1010,
      });

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('High must be >= Low');
    });

    test('should reject candles with open outside range', () => {
      const result = priceValidationService.validateCandle('EURUSD', {
        open: 1.1050, // Open > high
        high: 1.1020,
        low: 1.0980,
        close: 1.1010,
      });

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('between high and low');
    });

    test('should reject candles with prices outside valid range', () => {
      const result = priceValidationService.validateCandle('EURUSD', {
        open: 2.0000, // Way outside EURUSD range
        high: 2.0050,
        low: 1.9950,
        close: 2.0010,
      });

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('outside valid range');
    });

    test('should detect cross-contamination in candles', () => {
      // XAUUSD prices in EURUSD candle
      const result = priceValidationService.validateCandle('EURUSD', {
        open: 2600,
        high: 2610,
        low: 2590,
        close: 2605,
      });

      expect(result.isValid).toBe(false);

      const mismatch = priceValidationService.detectPossibleSymbolMismatch('EURUSD', 2600);
      expect(mismatch).toBe('XAUUSD');
    });
  });

  describe('Edge Cases', () => {
    test('should handle NaN prices', () => {
      const result = priceValidationService.validatePrice('EURUSD', NaN);
      expect(result.isValid).toBe(false);
    });

    test('should handle Infinity', () => {
      const result = priceValidationService.validatePrice('EURUSD', Infinity);
      expect(result.isValid).toBe(false);
    });

    test('should handle negative prices', () => {
      const result = priceValidationService.validatePrice('EURUSD', -1.0);
      expect(result.isValid).toBe(false);
    });

    test('should handle zero price', () => {
      const result = priceValidationService.validatePrice('EURUSD', 0);
      expect(result.isValid).toBe(false);
    });
  });
});
