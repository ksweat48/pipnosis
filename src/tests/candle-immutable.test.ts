/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🧪 IMMUTABLE CANDLE TESTS - Data Integrity Protection
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  createImmutableCandle,
  validateCandle,
  verifyCandle,
  toImmutableCandle,
  updateCandlePrice,
  mergeCandles,
  validateCandleArray,
  cloneCandle,
} from '@/types/candle-immutable';
import { createValidatedSymbol } from '@/types/symbol';

describe('Immutable Candle - Data Integrity Protection', () => {
  const EURUSD = createValidatedSymbol('EURUSD');
  const XAUUSD = createValidatedSymbol('XAUUSD');
  const now = Math.floor(Date.now() / 1000);

  describe('createImmutableCandle()', () => {
    test('should create valid candle', () => {
      const candle = createImmutableCandle(
        EURUSD,
        now,
        1.0850,
        1.0860,
        1.0840,
        1.0855,
        'database',
        100
      );

      expect(candle.symbol).toBe(EURUSD);
      expect(candle.time).toBe(now);
      expect(candle.open).toBe(1.0850);
      expect(candle.high).toBe(1.0860);
      expect(candle.low).toBe(1.0840);
      expect(candle.close).toBe(1.0855);
      expect(candle.volume).toBe(100);
      expect(candle.source).toBe('database');
      expect(candle.checksum).toBeDefined();
      expect(Object.isFrozen(candle)).toBe(true);
    });

    test('should reject candle with high < low', () => {
      expect(() =>
        createImmutableCandle(
          EURUSD,
          now,
          1.0850,
          1.0840, // high less than low
          1.0860, // low greater than high
          1.0855,
          'database'
        )
      ).toThrow('High');
    });

    test('should reject candle with open outside range', () => {
      expect(() =>
        createImmutableCandle(
          EURUSD,
          now,
          1.0900, // open > high
          1.0860,
          1.0840,
          1.0855,
          'database'
        )
      ).toThrow('between');
    });

    test('should reject candle with close outside range', () => {
      expect(() =>
        createImmutableCandle(
          EURUSD,
          now,
          1.0850,
          1.0860,
          1.0840,
          1.0900, // close > high
          'database'
        )
      ).toThrow('between');
    });

    test('should reject invalid prices', () => {
      expect(() =>
        createImmutableCandle(EURUSD, now, -1, 1, 1, 1, 'database')
      ).toThrow('positive');

      expect(() =>
        createImmutableCandle(EURUSD, now, NaN, 1, 1, 1, 'database')
      ).toThrow('number');
    });

    test('should reject invalid time', () => {
      expect(() =>
        createImmutableCandle(EURUSD, -1, 1.0850, 1.0860, 1.0840, 1.0855, 'database')
      ).toThrow('positive');

      expect(() =>
        createImmutableCandle(EURUSD, NaN, 1.0850, 1.0860, 1.0840, 1.0855, 'database')
      ).toThrow('number');
    });
  });

  describe('Immutability', () => {
    test('should freeze candle object', () => {
      const candle = createImmutableCandle(
        EURUSD,
        now,
        1.0850,
        1.0860,
        1.0840,
        1.0855,
        'database'
      );

      expect(Object.isFrozen(candle)).toBe(true);
    });

    test('should prevent mutations', () => {
      const candle = createImmutableCandle(
        EURUSD,
        now,
        1.0850,
        1.0860,
        1.0840,
        1.0855,
        'database'
      );

      expect(() => {
        (candle as any).close = 2.0000;
      }).toThrow();
    });

    test('should create new object on update', () => {
      const candle1 = createImmutableCandle(
        EURUSD,
        now,
        1.0850,
        1.0860,
        1.0840,
        1.0855,
        'database'
      );

      const candle2 = updateCandlePrice(candle1, 1.0865);

      expect(candle1).not.toBe(candle2);
      expect(candle1.close).toBe(1.0855);
      expect(candle2.close).toBe(1.0865);
      expect(candle2.high).toBe(1.0865); // Should update high
    });
  });

  describe('Checksum Verification', () => {
    test('should generate valid checksum', () => {
      const candle = createImmutableCandle(
        EURUSD,
        now,
        1.0850,
        1.0860,
        1.0840,
        1.0855,
        'database'
      );

      expect(candle.checksum).toBeDefined();
      expect(candle.checksum.length).toBeGreaterThan(0);
    });

    test('should verify valid candle', () => {
      const candle = createImmutableCandle(
        EURUSD,
        now,
        1.0850,
        1.0860,
        1.0840,
        1.0855,
        'database'
      );

      expect(verifyCandle(candle)).toBe(true);
    });

    test('should detect tampered candle', () => {
      const candle = createImmutableCandle(
        EURUSD,
        now,
        1.0850,
        1.0860,
        1.0840,
        1.0855,
        'database'
      );

      const tampered = { ...candle, close: 2.0000 };
      expect(verifyCandle(tampered as any)).toBe(false);
    });

    test('should generate different checksums for different data', () => {
      const candle1 = createImmutableCandle(
        EURUSD,
        now,
        1.0850,
        1.0860,
        1.0840,
        1.0855,
        'database'
      );

      const candle2 = createImmutableCandle(
        EURUSD,
        now,
        1.0850,
        1.0860,
        1.0840,
        1.0856, // Different close
        'database'
      );

      expect(candle1.checksum).not.toBe(candle2.checksum);
    });
  });

  describe('Cross-Contamination Prevention', () => {
    test('should reject merging candles from different symbols', () => {
      const eurusdCandle = createImmutableCandle(
        EURUSD,
        now,
        1.0850,
        1.0860,
        1.0840,
        1.0855,
        'database'
      );

      const xauusdCandle = createImmutableCandle(
        XAUUSD,
        now,
        2600,
        2610,
        2590,
        2605,
        'database'
      );

      expect(() => mergeCandles([eurusdCandle, xauusdCandle], EURUSD)).toThrow(
        'symbol mismatch'
      );
    });

    test('should detect symbol mismatch in array validation', () => {
      const eurusdCandle = createImmutableCandle(
        EURUSD,
        now,
        1.0850,
        1.0860,
        1.0840,
        1.0855,
        'database'
      );

      const xauusdCandle = createImmutableCandle(
        XAUUSD,
        now,
        2600,
        2610,
        2590,
        2605,
        'database'
      );

      const result = validateCandleArray([eurusdCandle, xauusdCandle], EURUSD);

      expect(result.isValid).toBe(false);
      expect(result.invalidIndices).toContain(1);
      expect(result.errors.some(e => e.includes('symbol mismatch'))).toBe(true);
    });

    test('should validate homogeneous candle arrays', () => {
      const candles = [
        createImmutableCandle(EURUSD, now, 1.0850, 1.0860, 1.0840, 1.0855, 'database'),
        createImmutableCandle(EURUSD, now + 60, 1.0855, 1.0865, 1.0845, 1.0860, 'database'),
        createImmutableCandle(EURUSD, now + 120, 1.0860, 1.0870, 1.0850, 1.0865, 'database'),
      ];

      const result = validateCandleArray(candles, EURUSD);

      expect(result.isValid).toBe(true);
      expect(result.invalidIndices).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    test('should successfully merge candles from same symbol', () => {
      const candles = [
        createImmutableCandle(EURUSD, now, 1.0850, 1.0860, 1.0840, 1.0855, 'database'),
        createImmutableCandle(EURUSD, now + 60, 1.0855, 1.0870, 1.0850, 1.0865, 'database'),
      ];

      const merged = mergeCandles(candles, EURUSD);

      expect(merged).not.toBeNull();
      expect(merged!.symbol).toBe(EURUSD);
      expect(merged!.open).toBe(1.0850);
      expect(merged!.close).toBe(1.0865);
      expect(merged!.high).toBe(1.0870);
      expect(merged!.low).toBe(1.0840);
    });
  });

  describe('Clone and Update Operations', () => {
    test('should create independent clone', () => {
      const original = createImmutableCandle(
        EURUSD,
        now,
        1.0850,
        1.0860,
        1.0840,
        1.0855,
        'database'
      );

      const clone = cloneCandle(original);

      expect(clone).not.toBe(original);
      expect(clone.symbol).toBe(original.symbol);
      expect(clone.time).toBe(original.time);
      expect(clone.open).toBe(original.open);
      expect(clone.checksum).toBe(original.checksum);
    });
  });
});
