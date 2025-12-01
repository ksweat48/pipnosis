/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🧪 INTEGRATION TESTS - End-to-End Contamination Detection
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { validateSymbol, createValidatedSymbol } from '@/types/symbol';
import { createImmutableCandle, validateCandleArray } from '@/types/candle-immutable';
import { priceValidationService } from '@/services/price-validation-service';
import { ChartCircuitBreaker } from '@/services/chart-circuit-breaker';

describe('Integration - End-to-End Contamination Detection', () => {
  let circuitBreaker: ChartCircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new ChartCircuitBreaker({
      threshold: 3,
      windowMs: 60000,
      cooldownMs: 300000,
      autoRecovery: false,
    });
    priceValidationService['lastPrices'].clear();
  });

  describe('Full Protection Stack', () => {
    test('should detect XAUUSD data in EURUSD at all layers', () => {
      // Layer 1: Symbol validation passes (both valid symbols)
      const eurusdResult = validateSymbol('EURUSD');
      const xauusdResult = validateSymbol('XAUUSD');
      expect(eurusdResult.isValid).toBe(true);
      expect(xauusdResult.isValid).toBe(true);

      const EURUSD = eurusdResult.symbol!;
      const XAUUSD = xauusdResult.symbol!;

      // Layer 2: Price validation fails (XAUUSD price in EURUSD context)
      const priceValidation = priceValidationService.validatePrice('EURUSD', 2600);
      expect(priceValidation.isValid).toBe(false);

      // Layer 2: Cross-contamination detected
      const mismatch = priceValidationService.detectPossibleSymbolMismatch('EURUSD', 2600);
      expect(mismatch).toBe('XAUUSD');

      // Layer 3: Circuit breaker records contamination
      circuitBreaker.recordContamination(XAUUSD, EURUSD, 'TestIntegration', { price: 2600 });
      expect(circuitBreaker.getEvents(EURUSD)).toHaveLength(1);

      // Layer 4: Immutable candle creation fails
      expect(() =>
        createImmutableCandle(EURUSD, Date.now() / 1000, 2600, 2610, 2590, 2605, 'database')
      ).toThrow();
    });

    test('should detect US30 data in EURUSD at all layers', () => {
      const EURUSD = createValidatedSymbol('EURUSD');
      const US30 = createValidatedSymbol('US30');

      // Price validation fails
      const validation = priceValidationService.validatePrice('EURUSD', 39500);
      expect(validation.isValid).toBe(false);

      // Cross-contamination detected
      const mismatch = priceValidationService.detectPossibleSymbolMismatch('EURUSD', 39500);
      expect(mismatch).toBe('US30');

      // Circuit breaker triggered
      circuitBreaker.recordContamination(US30, EURUSD, 'Test', { price: 39500 });
      expect(circuitBreaker.getEvents(EURUSD).length).toBeGreaterThan(0);

      // Candle creation fails
      expect(() =>
        createImmutableCandle(EURUSD, Date.now() / 1000, 39500, 39600, 39400, 39550, 'database')
      ).toThrow();
    });

    test('should allow valid EURUSD data through all layers', () => {
      const EURUSD = createValidatedSymbol('EURUSD');

      // Symbol validation passes
      expect(EURUSD).toBe('EURUSD');

      // Price validation passes
      const validation = priceValidationService.validatePrice('EURUSD', 1.1050);
      expect(validation.isValid).toBe(true);

      // No cross-contamination detected
      const mismatch = priceValidationService.detectPossibleSymbolMismatch('EURUSD', 1.1050);
      expect(mismatch).toBeNull();

      // Circuit breaker allows updates
      expect(circuitBreaker.isUpdateAllowed(EURUSD)).toBe(true);

      // Candle creation succeeds
      const candle = createImmutableCandle(
        EURUSD,
        Date.now() / 1000,
        1.1050,
        1.1060,
        1.1040,
        1.1055,
        'database'
      );
      expect(candle).toBeDefined();
      expect(candle.symbol).toBe(EURUSD);
    });
  });

  describe('Multi-Symbol Contamination Scenarios', () => {
    test('should handle mixed symbol candle arrays', () => {
      const EURUSD = createValidatedSymbol('EURUSD');
      const XAUUSD = createValidatedSymbol('XAUUSD');
      const now = Date.now() / 1000;

      const eurusdCandle = createImmutableCandle(
        EURUSD,
        now,
        1.1050,
        1.1060,
        1.1040,
        1.1055,
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

      // Validation should detect mismatch
      const validation = validateCandleArray([eurusdCandle, xauusdCandle], EURUSD);
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.includes('symbol mismatch'))).toBe(true);
    });

    test('should cascade through protection layers', () => {
      const EURUSD = createValidatedSymbol('EURUSD');
      const XAUUSD = createValidatedSymbol('XAUUSD');

      // Simulate contamination event 1
      priceValidationService.validatePrice('EURUSD', 2600);
      circuitBreaker.recordContamination(XAUUSD, EURUSD, 'Event1', { price: 2600 });

      // Simulate contamination event 2
      priceValidationService.validatePrice('EURUSD', 2610);
      circuitBreaker.recordContamination(XAUUSD, EURUSD, 'Event2', { price: 2610 });

      // Simulate contamination event 3 - circuit should open
      priceValidationService.validatePrice('EURUSD', 2605);
      circuitBreaker.recordContamination(XAUUSD, EURUSD, 'Event3', { price: 2605 });

      // Circuit breaker should be open
      expect(circuitBreaker.getState(EURUSD)).toBe('open');
      expect(circuitBreaker.isUpdateAllowed(EURUSD)).toBe(false);

      // All events tracked
      expect(circuitBreaker.getEvents(EURUSD)).toHaveLength(3);
    });
  });

  describe('Real-World Contamination Patterns', () => {
    test('should detect gradual contamination buildup', () => {
      const EURUSD = createValidatedSymbol('EURUSD');
      const XAUUSD = createValidatedSymbol('XAUUSD');

      let contaminations = 0;
      const callback = jest.fn(() => contaminations++);
      circuitBreaker.onContamination(callback);

      // Simulate gradual contamination
      const contaminatedPrices = [2600, 2610, 2605, 2615];

      contaminatedPrices.forEach(price => {
        const validation = priceValidationService.validatePrice('EURUSD', price);
        if (!validation.isValid) {
          const mismatch = priceValidationService.detectPossibleSymbolMismatch('EURUSD', price);
          if (mismatch === 'XAUUSD') {
            circuitBreaker.recordContamination(XAUUSD, EURUSD, 'Gradual', { price });
          }
        }
      });

      expect(contaminations).toBeGreaterThanOrEqual(3);
      expect(circuitBreaker.getState(EURUSD)).toBe('open');
    });

    test('should handle burst contamination', () => {
      const EURUSD = createValidatedSymbol('EURUSD');
      const XAUUSD = createValidatedSymbol('XAUUSD');

      // Burst of contamination events
      for (let i = 0; i < 10; i++) {
        circuitBreaker.recordContamination(XAUUSD, EURUSD, 'Burst', { iteration: i });
      }

      // Circuit should open immediately after threshold
      expect(circuitBreaker.getState(EURUSD)).toBe('open');
      expect(circuitBreaker.getEvents(EURUSD)).toHaveLength(10);
    });

    test('should isolate contamination to affected symbols', () => {
      const EURUSD = createValidatedSymbol('EURUSD');
      const GBPUSD = createValidatedSymbol('GBPUSD');
      const XAUUSD = createValidatedSymbol('XAUUSD');

      // Contaminate EURUSD only
      for (let i = 0; i < 3; i++) {
        circuitBreaker.recordContamination(XAUUSD, EURUSD, 'Test', {});
      }

      // EURUSD circuit open, others closed
      expect(circuitBreaker.getState(EURUSD)).toBe('open');
      expect(circuitBreaker.getState(GBPUSD)).toBe('closed');
      expect(circuitBreaker.isUpdateAllowed(EURUSD)).toBe(false);
      expect(circuitBreaker.isUpdateAllowed(GBPUSD)).toBe(true);
    });
  });

  describe('Recovery Scenarios', () => {
    test('should allow updates after manual recovery', () => {
      const EURUSD = createValidatedSymbol('EURUSD');
      const XAUUSD = createValidatedSymbol('XAUUSD');

      // Open circuit
      for (let i = 0; i < 3; i++) {
        circuitBreaker.recordContamination(XAUUSD, EURUSD, 'Test', {});
      }

      expect(circuitBreaker.isUpdateAllowed(EURUSD)).toBe(false);

      // Manual recovery
      circuitBreaker.closeCircuit(EURUSD);

      expect(circuitBreaker.isUpdateAllowed(EURUSD)).toBe(true);

      // Valid data should flow
      const validation = priceValidationService.validatePrice('EURUSD', 1.1050);
      expect(validation.isValid).toBe(true);

      const candle = createImmutableCandle(
        EURUSD,
        Date.now() / 1000,
        1.1050,
        1.1060,
        1.1040,
        1.1055,
        'database'
      );
      expect(candle).toBeDefined();
    });
  });
});
