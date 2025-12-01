/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🧪 SYMBOL VALIDATION TESTS - Type System Protection
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  validateSymbol,
  isValidatedSymbol,
  createValidatedSymbol,
  assertValidSymbol,
  KNOWN_SYMBOLS,
  PRIMARY_SYMBOLS,
  isPrimarySymbol,
  getSymbolCategory,
} from '@/types/symbol';

describe('Symbol Validation - Type System Protection', () => {
  describe('validateSymbol()', () => {
    test('should accept valid known symbols', () => {
      KNOWN_SYMBOLS.forEach(symbol => {
        const result = validateSymbol(symbol);
        expect(result.isValid).toBe(true);
        expect(result.symbol).toBe(symbol);
        expect(result.error).toBeUndefined();
      });
    });

    test('should reject invalid types', () => {
      const invalidInputs = [null, undefined, 123, {}, [], true];
      invalidInputs.forEach(input => {
        const result = validateSymbol(input);
        expect(result.isValid).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.symbol).toBeUndefined();
      });
    });

    test('should reject empty strings', () => {
      const emptyStrings = ['', '   ', '\t', '\n'];
      emptyStrings.forEach(str => {
        const result = validateSymbol(str);
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('empty');
      });
    });

    test('should reject unknown symbols', () => {
      const unknownSymbols = ['UNKNOWN', 'INVALID', 'FAKE', 'XXXYYY'];
      unknownSymbols.forEach(symbol => {
        const result = validateSymbol(symbol);
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('Unknown symbol');
      });
    });

    test('should normalize symbols to uppercase', () => {
      const result = validateSymbol('eurusd');
      expect(result.isValid).toBe(true);
      expect(result.symbol).toBe('EURUSD');
    });

    test('should provide suggestions for typos', () => {
      const result = validateSymbol('EURSD');
      expect(result.isValid).toBe(false);
      expect(result.suggestion).toBe('EURUSD');
    });

    test('should handle whitespace in symbols', () => {
      const result = validateSymbol('  EURUSD  ');
      expect(result.isValid).toBe(true);
      expect(result.symbol).toBe('EURUSD');
    });
  });

  describe('createValidatedSymbol()', () => {
    test('should create validated symbol from valid string', () => {
      const symbol = createValidatedSymbol('EURUSD');
      expect(symbol).toBe('EURUSD');
    });

    test('should throw on invalid symbol', () => {
      expect(() => createValidatedSymbol('INVALID')).toThrow('Cannot create validated symbol');
    });
  });

  describe('assertValidSymbol()', () => {
    test('should not throw for valid symbols', () => {
      expect(() => assertValidSymbol('EURUSD')).not.toThrow();
      expect(() => assertValidSymbol('XAUUSD')).not.toThrow();
    });

    test('should throw for invalid symbols', () => {
      expect(() => assertValidSymbol('INVALID')).toThrow('Symbol validation failed');
      expect(() => assertValidSymbol(123 as any)).toThrow('Symbol validation failed');
    });

    test('should include suggestion in error message', () => {
      expect(() => assertValidSymbol('EURSD')).toThrow('Did you mean EURUSD');
    });
  });

  describe('isPrimarySymbol()', () => {
    test('should identify primary symbols', () => {
      PRIMARY_SYMBOLS.forEach(symbol => {
        expect(isPrimarySymbol(symbol as any)).toBe(true);
      });
    });

    test('should reject non-primary symbols', () => {
      expect(isPrimarySymbol('NZDUSD' as any)).toBe(false);
      expect(isPrimarySymbol('BTCUSD' as any)).toBe(false);
    });
  });

  describe('getSymbolCategory()', () => {
    test('should categorize forex pairs', () => {
      expect(getSymbolCategory('EURUSD' as any)).toBe('forex');
      expect(getSymbolCategory('GBPUSD' as any)).toBe('forex');
      expect(getSymbolCategory('USDJPY' as any)).toBe('forex');
    });

    test('should categorize metals', () => {
      expect(getSymbolCategory('XAUUSD' as any)).toBe('metal');
      expect(getSymbolCategory('XAGUSD' as any)).toBe('metal');
      expect(getSymbolCategory('XPTUSD' as any)).toBe('metal');
    });

    test('should categorize indices', () => {
      expect(getSymbolCategory('US30' as any)).toBe('index');
      expect(getSymbolCategory('NAS100' as any)).toBe('index');
      expect(getSymbolCategory('SPX500' as any)).toBe('index');
    });

    test('should categorize crypto', () => {
      expect(getSymbolCategory('BTCUSD' as any)).toBe('crypto');
      expect(getSymbolCategory('ETHUSD' as any)).toBe('crypto');
    });

    test('should categorize energy', () => {
      expect(getSymbolCategory('USOIL' as any)).toBe('energy');
      expect(getSymbolCategory('UKOIL' as any)).toBe('energy');
    });
  });

  describe('Cross-Contamination Prevention', () => {
    test('should prevent symbol mixing at type level', () => {
      const eurusd = createValidatedSymbol('EURUSD');
      const xauusd = createValidatedSymbol('XAUUSD');

      expect(eurusd).not.toBe(xauusd);
    });

    test('should catch attempted symbol substitution', () => {
      const result1 = validateSymbol('EURUSD');
      const result2 = validateSymbol('XAUUSD');

      expect(result1.symbol).not.toBe(result2.symbol);
    });
  });
});
