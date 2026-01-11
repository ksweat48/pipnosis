/**
 * PCVL (Position Contract Validation Layer) Tests
 *
 * Tests for the critical last-line defense against position sizing disasters.
 */

import { validatePositionContract, isPCVLEnabled } from '../services/pcvl-position-contract-validator';
import type { PCVLInput } from '../types/pcvl';

describe('PCVL Position Contract Validator', () => {
  describe('Risk Variance Validation', () => {
    test('should approve trade with 0% variance (perfect match)', () => {
      const input: PCVLInput = {
        symbol: 'EURUSD',
        lot_size: 0.1,
        stop_pips: 20,
        intended_risk_dollars: 20.0, // $10/pip × 0.1 lot × 20 pips = $20
        entry_price: 1.1000,
        stop_loss: 1.0980,
      };

      const result = validatePositionContract(input);

      expect(result.approved).toBe(true);
      expect(result.true_risk_dollars).toBeCloseTo(20.0, 1);
      expect(Math.abs(result.risk_variance_percent)).toBeLessThan(2.0);
    });

    test('should approve trade with 1.5% variance (within tolerance)', () => {
      const input: PCVLInput = {
        symbol: 'EURUSD',
        lot_size: 0.1,
        stop_pips: 20,
        intended_risk_dollars: 20.0,
        entry_price: 1.1000,
        stop_loss: 1.0980,
      };

      // Actual risk will be ~20.3 (1.5% over)
      const result = validatePositionContract({
        ...input,
        lot_size: 0.1015, // Slightly higher lot size
      });

      expect(result.approved).toBe(true);
      expect(Math.abs(result.risk_variance_percent)).toBeLessThanOrEqual(2.0);
    });

    test('should block trade with 3% variance (exceeds tolerance)', () => {
      const input: PCVLInput = {
        symbol: 'EURUSD',
        lot_size: 0.106, // This creates 6% variance
        stop_pips: 20,
        intended_risk_dollars: 20.0,
        entry_price: 1.1000,
        stop_loss: 1.0980,
      };

      const result = validatePositionContract(input);

      expect(result.approved).toBe(false);
      expect(result.block_reason).toContain('RISK_VARIANCE_EXCEEDED');
      expect(Math.abs(result.risk_variance_percent)).toBeGreaterThan(2.0);
    });
  });

  describe('Pip Value Validation', () => {
    test('should approve forex pair with correct pip value', () => {
      const input: PCVLInput = {
        symbol: 'EURUSD',
        lot_size: 1.0,
        stop_pips: 20,
        intended_risk_dollars: 200.0,
        entry_price: 1.1000,
        stop_loss: 1.0980,
      };

      const result = validatePositionContract(input);

      expect(result.approved).toBe(true);
      expect(result.pip_value_used).toBe(0.0001);
      expect(result.dollar_per_pip).toBe(10.0); // $10/pip for 1.0 lot EURUSD
    });

    test('should approve gold with correct pip value', () => {
      const input: PCVLInput = {
        symbol: 'XAUUSD',
        lot_size: 0.01,
        stop_pips: 20,
        intended_risk_dollars: 20.0,
        entry_price: 2000.00,
        stop_loss: 1980.00,
      };

      const result = validatePositionContract(input);

      expect(result.approved).toBe(true);
      expect(result.pip_value_used).toBe(1.0);
      expect(result.dollar_per_pip).toBe(1.0); // $1/pip for 0.01 lot XAUUSD
    });

    test('should approve indices with correct pip value', () => {
      const input: PCVLInput = {
        symbol: 'US30',
        lot_size: 0.01,
        stop_pips: 50,
        intended_risk_dollars: 50.0,
        entry_price: 40000.0,
        stop_loss: 39950.0,
      };

      const result = validatePositionContract(input);

      expect(result.approved).toBe(true);
      expect(result.pip_value_used).toBe(1.0);
      expect(result.dollar_per_pip).toBe(1.0); // $100/pip × 0.01 lot = $1/pip
    });
  });

  describe('Lot Size Validation', () => {
    test('should approve lot size within broker limits', () => {
      const input: PCVLInput = {
        symbol: 'EURUSD',
        lot_size: 0.5, // Within 0.01-5.0 range
        stop_pips: 20,
        intended_risk_dollars: 100.0,
        entry_price: 1.1000,
        stop_loss: 1.0980,
      };

      const result = validatePositionContract(input);

      expect(result.approved).toBe(true);
    });

    test('should block lot size below minimum', () => {
      const input: PCVLInput = {
        symbol: 'EURUSD',
        lot_size: 0.001, // Below 0.01 minimum
        stop_pips: 20,
        intended_risk_dollars: 0.2,
        entry_price: 1.1000,
        stop_loss: 1.0980,
      };

      const result = validatePositionContract(input);

      expect(result.approved).toBe(false);
      expect(result.block_reason).toContain('LOT_SIZE_OUT_OF_RANGE');
    });

    test('should block lot size above maximum', () => {
      const input: PCVLInput = {
        symbol: 'EURUSD',
        lot_size: 10.0, // Above 5.0 maximum
        stop_pips: 20,
        intended_risk_dollars: 2000.0,
        entry_price: 1.1000,
        stop_loss: 1.0980,
      };

      const result = validatePositionContract(input);

      expect(result.approved).toBe(false);
      expect(result.block_reason).toContain('LOT_SIZE_OUT_OF_RANGE');
    });
  });

  describe('Audit Trail', () => {
    test('should include complete audit information', () => {
      const input: PCVLInput = {
        symbol: 'EURUSD',
        lot_size: 0.1,
        stop_pips: 20,
        intended_risk_dollars: 20.0,
        entry_price: 1.1000,
        stop_loss: 1.0980,
      };

      const result = validatePositionContract(input);

      expect(result.audit).toBeDefined();
      expect(result.audit.timestamp).toBeDefined();
      expect(result.audit.symbol).toBe('EURUSD');
      expect(result.audit.lot_size).toBe(0.1);
      expect(result.audit.stop_pips).toBe(20);
      expect(result.audit.intended_risk).toBe(20.0);
      expect(result.audit.calculated_risk).toBeDefined();
      expect(result.audit.risk_variance).toBeDefined();
      expect(result.audit.pip_value).toBe(0.0001);
      expect(result.audit.dollar_per_pip).toBe(1.0);
      expect(result.audit.approved).toBe(true);
    });

    test('should include block reason in audit when trade is blocked', () => {
      const input: PCVLInput = {
        symbol: 'EURUSD',
        lot_size: 0.15, // Creates excessive variance
        stop_pips: 20,
        intended_risk_dollars: 20.0,
        entry_price: 1.1000,
        stop_loss: 1.0980,
      };

      const result = validatePositionContract(input);

      expect(result.audit.approved).toBe(false);
      expect(result.audit.block_reason).toContain('RISK_VARIANCE_EXCEEDED');
    });
  });

  describe('Configuration', () => {
    test('should report PCVL enabled status', () => {
      const enabled = isPCVLEnabled();
      expect(typeof enabled).toBe('boolean');
    });
  });

  describe('Catastrophic Error Detection (14.7× Example)', () => {
    test('should detect and block 14.7× risk violation', () => {
      // Recreate the scenario from your logs:
      // Intended: $102, Actual: $1500 (14.7× violation)
      const input: PCVLInput = {
        symbol: 'US30',
        lot_size: 0.15, // This lot size causes the violation
        stop_pips: 30,
        intended_risk_dollars: 102.0,
        entry_price: 40000.0,
        stop_loss: 39970.0,
      };

      const result = validatePositionContract(input);

      // PCVL must block this catastrophic error
      expect(result.approved).toBe(false);
      expect(result.block_reason).toContain('RISK_VARIANCE_EXCEEDED');
      expect(result.true_risk_dollars).toBeGreaterThan(400.0); // Actual risk is much higher
      expect(Math.abs(result.risk_variance_percent)).toBeGreaterThan(200.0); // 200%+ variance
    });
  });
});
