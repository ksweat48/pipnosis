/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🧪 CIRCUIT BREAKER TESTS - Automatic Shutdown Protection
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { ChartCircuitBreaker } from '@/services/chart-circuit-breaker';
import { createValidatedSymbol } from '@/types/symbol';

describe('Circuit Breaker - Automatic Shutdown Protection', () => {
  let circuitBreaker: ChartCircuitBreaker;
  const EURUSD = createValidatedSymbol('EURUSD');
  const XAUUSD = createValidatedSymbol('XAUUSD');

  beforeEach(() => {
    circuitBreaker = new ChartCircuitBreaker({
      threshold: 3,
      windowMs: 60000,
      cooldownMs: 300000,
      autoRecovery: false,
    });
  });

  describe('Initial State', () => {
    test('should start with closed circuit', () => {
      expect(circuitBreaker.getState()).toBe('closed');
      expect(circuitBreaker.isUpdateAllowed(EURUSD)).toBe(true);
    });

    test('should have empty events', () => {
      expect(circuitBreaker.getEvents()).toHaveLength(0);
      expect(circuitBreaker.getEvents(EURUSD)).toHaveLength(0);
    });
  });

  describe('Contamination Recording', () => {
    test('should record contamination event', () => {
      circuitBreaker.recordContamination(
        XAUUSD,
        EURUSD,
        'TestService',
        { price: 2600 }
      );

      const events = circuitBreaker.getEvents(EURUSD);
      expect(events).toHaveLength(1);
      expect(events[0].symbol).toBe(XAUUSD);
      expect(events[0].expectedSymbol).toBe(EURUSD);
      expect(events[0].source).toBe('TestService');
    });

    test('should track multiple events', () => {
      circuitBreaker.recordContamination(XAUUSD, EURUSD, 'Test1', {});
      circuitBreaker.recordContamination(XAUUSD, EURUSD, 'Test2', {});

      expect(circuitBreaker.getEvents(EURUSD)).toHaveLength(2);
    });

    test('should track events per symbol independently', () => {
      circuitBreaker.recordContamination(XAUUSD, EURUSD, 'Test', {});
      circuitBreaker.recordContamination(EURUSD, XAUUSD, 'Test', {});

      expect(circuitBreaker.getEvents(EURUSD)).toHaveLength(1);
      expect(circuitBreaker.getEvents(XAUUSD)).toHaveLength(1);
    });
  });

  describe('Circuit Opening', () => {
    test('should open circuit after threshold events', () => {
      // Record 3 events (threshold)
      for (let i = 0; i < 3; i++) {
        circuitBreaker.recordContamination(XAUUSD, EURUSD, 'Test', {});
      }

      expect(circuitBreaker.getState(EURUSD)).toBe('open');
      expect(circuitBreaker.isUpdateAllowed(EURUSD)).toBe(false);
    });

    test('should not open circuit below threshold', () => {
      // Record 2 events (below threshold of 3)
      for (let i = 0; i < 2; i++) {
        circuitBreaker.recordContamination(XAUUSD, EURUSD, 'Test', {});
      }

      expect(circuitBreaker.getState(EURUSD)).toBe('closed');
      expect(circuitBreaker.isUpdateAllowed(EURUSD)).toBe(true);
    });

    test('should isolate circuit breakers per symbol', () => {
      // Open circuit for EURUSD
      for (let i = 0; i < 3; i++) {
        circuitBreaker.recordContamination(XAUUSD, EURUSD, 'Test', {});
      }

      // XAUUSD should still be closed
      expect(circuitBreaker.getState(EURUSD)).toBe('open');
      expect(circuitBreaker.getState(XAUUSD)).toBe('closed');
      expect(circuitBreaker.isUpdateAllowed(EURUSD)).toBe(false);
      expect(circuitBreaker.isUpdateAllowed(XAUUSD)).toBe(true);
    });
  });

  describe('Circuit Closing', () => {
    test('should close circuit manually', () => {
      // Open circuit
      for (let i = 0; i < 3; i++) {
        circuitBreaker.recordContamination(XAUUSD, EURUSD, 'Test', {});
      }

      expect(circuitBreaker.getState(EURUSD)).toBe('open');

      // Close manually
      circuitBreaker.closeCircuit(EURUSD);

      expect(circuitBreaker.getState(EURUSD)).toBe('closed');
      expect(circuitBreaker.isUpdateAllowed(EURUSD)).toBe(true);
      expect(circuitBreaker.getEvents(EURUSD)).toHaveLength(0);
    });

    test('should close all circuits', () => {
      // Open multiple circuits
      for (let i = 0; i < 3; i++) {
        circuitBreaker.recordContamination(XAUUSD, EURUSD, 'Test', {});
        circuitBreaker.recordContamination(EURUSD, XAUUSD, 'Test', {});
      }

      expect(circuitBreaker.getState(EURUSD)).toBe('open');
      expect(circuitBreaker.getState(XAUUSD)).toBe('open');

      // Close all
      circuitBreaker.closeCircuit();

      expect(circuitBreaker.getState(EURUSD)).toBe('closed');
      expect(circuitBreaker.getState(XAUUSD)).toBe('closed');
      expect(circuitBreaker.getEvents()).toHaveLength(0);
    });
  });

  describe('Alert Callbacks', () => {
    test('should trigger callbacks on contamination', () => {
      const callback = jest.fn();
      circuitBreaker.onContamination(callback);

      circuitBreaker.recordContamination(XAUUSD, EURUSD, 'Test', { price: 2600 });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: XAUUSD,
          expectedSymbol: EURUSD,
          source: 'Test',
        })
      );
    });

    test('should support multiple callbacks', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      circuitBreaker.onContamination(callback1);
      circuitBreaker.onContamination(callback2);

      circuitBreaker.recordContamination(XAUUSD, EURUSD, 'Test', {});

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    test('should allow unsubscribing from callbacks', () => {
      const callback = jest.fn();
      const unsubscribe = circuitBreaker.onContamination(callback);

      circuitBreaker.recordContamination(XAUUSD, EURUSD, 'Test1', {});
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      circuitBreaker.recordContamination(XAUUSD, EURUSD, 'Test2', {});
      expect(callback).toHaveBeenCalledTimes(1); // Still 1, not called again
    });
  });

  describe('Status Reporting', () => {
    test('should report current status', () => {
      const status = circuitBreaker.getStatus();

      expect(status).toHaveProperty('state');
      expect(status).toHaveProperty('events');
      expect(status).toHaveProperty('symbolStates');
      expect(status).toHaveProperty('uptime');
      expect(status).toHaveProperty('recoveryAttempts');
    });

    test('should reflect circuit states in status', () => {
      // Open circuit for EURUSD
      for (let i = 0; i < 3; i++) {
        circuitBreaker.recordContamination(XAUUSD, EURUSD, 'Test', {});
      }

      const status = circuitBreaker.getStatus();
      expect(status.symbolStates[EURUSD]).toBe('open');
    });
  });

  describe('Reset Functionality', () => {
    test('should reset all state', () => {
      // Create contamination
      for (let i = 0; i < 3; i++) {
        circuitBreaker.recordContamination(XAUUSD, EURUSD, 'Test', {});
      }

      expect(circuitBreaker.getState(EURUSD)).toBe('open');

      // Reset
      circuitBreaker.reset();

      expect(circuitBreaker.getState()).toBe('closed');
      expect(circuitBreaker.getEvents()).toHaveLength(0);
      expect(circuitBreaker.isUpdateAllowed(EURUSD)).toBe(true);
    });
  });

  describe('Time Window', () => {
    test('should only count recent events within window', () => {
      const breaker = new ChartCircuitBreaker({
        threshold: 3,
        windowMs: 5000, // 5 second window
        cooldownMs: 10000,
        autoRecovery: false,
      });

      // Record event
      breaker.recordContamination(XAUUSD, EURUSD, 'Test', {});

      // Wait 6 seconds (outside window)
      jest.advanceTimersByTime(6000);

      // Record 2 more events (should only count these 2, not the old one)
      breaker.recordContamination(XAUUSD, EURUSD, 'Test', {});
      breaker.recordContamination(XAUUSD, EURUSD, 'Test', {});

      // Should still be closed (only 2 events in window)
      expect(breaker.getState(EURUSD)).toBe('closed');
    });
  });
});
