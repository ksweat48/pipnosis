/**
 * Comprehensive P&L Calculation Tests
 *
 * Tests to prevent the $93,551 US30 bug and similar calculation errors.
 * Validates P&L calculations across all symbol types.
 */

import { calculatePipDistance, calculateDollarPerPip, getCurrencyPipInfo } from '../utils/currencyHelpers';
import { pnlValidator } from '../services/pnl-validator';

describe('P&L Calculation - US30 Bug Prevention', () => {
  describe('US30 (Index) P&L Calculations', () => {
    it('should correctly calculate US30 SELL trade P&L (the bug case)', () => {
      const symbol = 'US30';
      const direction = 'sell';
      const entryPrice = 47858.19628;
      const exitPrice = 47851.00000;
      const positionSize = 0.13; // lots

      // Calculate using correct formula
      const pipDistance = calculatePipDistance(symbol, entryPrice, exitPrice);
      const dollarPerPip = calculateDollarPerPip(symbol, positionSize);
      const pnl = direction === 'buy'
        ? pipDistance * dollarPerPip
        : -pipDistance * dollarPerPip;

      // Expected: 7.19628 points profit * (0.13 lots * $100/point) = 7.19628 * $13 = $93.55
      expect(pnl).toBeCloseTo(93.55, 1);

      // Should NOT be $93,551 (the bug value)
      expect(Math.abs(pnl)).toBeLessThan(1000);
    });

    it('should correctly calculate US30 BUY trade P&L', () => {
      const symbol = 'US30';
      const direction = 'buy';
      const entryPrice = 47800;
      const exitPrice = 47850;
      const positionSize = 0.10; // lots

      const pipDistance = calculatePipDistance(symbol, entryPrice, exitPrice);
      const dollarPerPip = calculateDollarPerPip(symbol, positionSize);
      const pnl = direction === 'buy'
        ? pipDistance * dollarPerPip
        : -pipDistance * dollarPerPip;

      // Expected: 50 points profit * (0.10 lots * $100/point) = 50 * $10 = $500
      expect(pnl).toBeCloseTo(500, 0);
    });

    it('should handle US30 with 1.0 lot position', () => {
      const symbol = 'US30';
      const direction = 'buy';
      const entryPrice = 48000;
      const exitPrice = 48010;
      const positionSize = 1.0; // 1 full lot

      const pipDistance = calculatePipDistance(symbol, entryPrice, exitPrice);
      const dollarPerPip = calculateDollarPerPip(symbol, positionSize);
      const pnl = direction === 'buy'
        ? pipDistance * dollarPerPip
        : -pipDistance * dollarPerPip;

      // Expected: 10 points * (1.0 lot * $100/point) = 10 * $100 = $1,000
      expect(pnl).toBeCloseTo(1000, 0);
    });
  });

  describe('EURUSD (Forex) P&L Calculations', () => {
    it('should correctly calculate EURUSD BUY trade P&L', () => {
      const symbol = 'EURUSD';
      const direction = 'buy';
      const entryPrice = 1.08500;
      const exitPrice = 1.08600;
      const positionSize = 0.10; // lots

      const pipDistance = calculatePipDistance(symbol, entryPrice, exitPrice);
      const dollarPerPip = calculateDollarPerPip(symbol, positionSize);
      const pnl = direction === 'buy'
        ? pipDistance * dollarPerPip
        : -pipDistance * dollarPerPip;

      // Expected: 10 pips profit * (0.10 lots * $10/pip) = 10 * $1 = $10
      expect(pnl).toBeCloseTo(10, 0);
    });

    it('should correctly calculate EURUSD SELL trade P&L', () => {
      const symbol = 'EURUSD';
      const direction = 'sell';
      const entryPrice = 1.08600;
      const exitPrice = 1.08500;
      const positionSize = 0.10; // lots

      const pipDistance = calculatePipDistance(symbol, entryPrice, exitPrice);
      const dollarPerPip = calculateDollarPerPip(symbol, positionSize);
      const pnl = direction === 'buy'
        ? pipDistance * dollarPerPip
        : -pipDistance * dollarPerPip;

      // Expected: -10 pips * (0.10 lots * $10/pip) = 10 * $1 = $10 profit for sell
      expect(pnl).toBeCloseTo(10, 0);
    });
  });

  describe('XAUUSD (Gold) P&L Calculations', () => {
    it('should correctly calculate XAUUSD BUY trade P&L', () => {
      const symbol = 'XAUUSD';
      const direction = 'buy';
      const entryPrice = 2050.00;
      const exitPrice = 2051.00;
      const positionSize = 0.10; // lots

      const pipDistance = calculatePipDistance(symbol, entryPrice, exitPrice);
      const dollarPerPip = calculateDollarPerPip(symbol, positionSize);
      const pnl = direction === 'buy'
        ? pipDistance * dollarPerPip
        : -pipDistance * dollarPerPip;

      // Expected: 1.00 pip (100 points) profit * (0.10 lots * $100/pip) = 100 * $10 = $1,000
      expect(pnl).toBeCloseTo(1000, 0);
    });
  });

  describe('USDJPY (JPY Pair) P&L Calculations', () => {
    it('should correctly calculate USDJPY BUY trade P&L', () => {
      const symbol = 'USDJPY';
      const direction = 'buy';
      const entryPrice = 150.00;
      const exitPrice = 150.10;
      const positionSize = 0.10; // lots

      const pipDistance = calculatePipDistance(symbol, entryPrice, exitPrice);
      const dollarPerPip = calculateDollarPerPip(symbol, positionSize);
      const pnl = direction === 'buy'
        ? pipDistance * dollarPerPip
        : -pipDistance * dollarPerPip;

      // Expected: 10 pips profit * (0.10 lots * $10/pip) = 10 * $1 = $10
      expect(pnl).toBeCloseTo(10, 0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very small lot sizes', () => {
      const symbol = 'US30';
      const direction = 'buy';
      const entryPrice = 48000;
      const exitPrice = 48010;
      const positionSize = 0.01; // minimum lot

      const pipDistance = calculatePipDistance(symbol, entryPrice, exitPrice);
      const dollarPerPip = calculateDollarPerPip(symbol, positionSize);
      const pnl = direction === 'buy'
        ? pipDistance * dollarPerPip
        : -pipDistance * dollarPerPip;

      // Expected: 10 points * (0.01 lot * $100/point) = 10 * $1 = $10
      expect(pnl).toBeCloseTo(10, 0);
    });

    it('should handle loss trades correctly', () => {
      const symbol = 'US30';
      const direction = 'buy';
      const entryPrice = 48000;
      const exitPrice = 47990;
      const positionSize = 0.10;

      const pipDistance = calculatePipDistance(symbol, entryPrice, exitPrice);
      const dollarPerPip = calculateDollarPerPip(symbol, positionSize);
      const pnl = direction === 'buy'
        ? pipDistance * dollarPerPip
        : -pipDistance * dollarPerPip;

      // Expected: -10 points * (0.10 lot * $100/point) = -10 * $10 = -$100
      expect(pnl).toBeCloseTo(-100, 0);
    });

    it('should return zero P&L for breakeven trades', () => {
      const symbol = 'US30';
      const direction = 'buy';
      const entryPrice = 48000;
      const exitPrice = 48000;
      const positionSize = 0.10;

      const pipDistance = calculatePipDistance(symbol, entryPrice, exitPrice);
      const dollarPerPip = calculateDollarPerPip(symbol, positionSize);
      const pnl = direction === 'buy'
        ? pipDistance * dollarPerPip
        : -pipDistance * dollarPerPip;

      expect(pnl).toBe(0);
    });
  });
});

describe('P&L Validator Service', () => {
  describe('validatePnL', () => {
    it('should flag P&L that exceeds 50% of account balance', () => {
      const result = pnlValidator.validatePnL(
        'US30',
        48000,
        48010,
        0.10,
        'buy',
        100 // $100 account balance
      );

      // P&L would be $100, which is 100% of balance
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should pass validation for reasonable P&L', () => {
      const result = pnlValidator.validatePnL(
        'US30',
        48000,
        48010,
        0.10,
        'buy',
        100000 // $100k account balance
      );

      // P&L would be $100, which is 0.1% of balance
      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should flag position sizes that appear to be in UNITS instead of LOTS', () => {
      const result = pnlValidator.validatePnL(
        'US30',
        48000,
        48010,
        13000, // This should be 0.13 lots, not 13,000!
        'buy',
        100000
      );

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(expect.stringContaining('suspiciously large'));
    });

    it('should flag zero prices', () => {
      const result = pnlValidator.validatePnL(
        'US30',
        0, // invalid
        48010,
        0.10,
        'buy',
        100000
      );

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(expect.stringContaining('zero'));
    });
  });

  describe('recalculatePnL', () => {
    it('should detect and correct the US30 bug', () => {
      const corruptedTrade = {
        symbol: 'US30',
        entry_price: 47858.19628,
        exit_price: 47851.00000,
        position_size: 0.13,
        direction: 'sell' as const,
        profit_loss: 93551.68 // The bug value
      };

      const result = pnlValidator.recalculatePnL(corruptedTrade);

      expect(result.wasCorrupted).toBe(true);
      expect(result.correctedPnL).toBeCloseTo(93.55, 1);
      expect(result.originalPnL).toBeCloseTo(93551.68, 2);
    });

    it('should not flag correctly calculated P&L as corrupted', () => {
      const correctTrade = {
        symbol: 'US30',
        entry_price: 48000,
        exit_price: 48010,
        position_size: 0.10,
        direction: 'buy' as const,
        profit_loss: 100 // Correct value
      };

      const result = pnlValidator.recalculatePnL(correctTrade);

      expect(result.wasCorrupted).toBe(false);
      expect(result.correctedPnL).toBeCloseTo(100, 0);
    });
  });

  describe('checkCircuitBreaker', () => {
    it('should halt trading if single P&L exceeds 50% of balance', () => {
      const result = pnlValidator.checkCircuitBreaker(
        [93551.68], // Corrupted P&L
        100000 // $100k balance
      );

      expect(result.shouldHalt).toBe(true);
      expect(result.reason).toContain('50%');
    });

    it('should not halt for reasonable P&Ls', () => {
      const result = pnlValidator.checkCircuitBreaker(
        [100, 150, -50, 200], // Normal P&Ls
        100000
      );

      expect(result.shouldHalt).toBe(false);
    });
  });
});

describe('Currency Helper Functions', () => {
  describe('getCurrencyPipInfo', () => {
    it('should return correct pip value for US30', () => {
      const info = getCurrencyPipInfo('US30');
      expect(info.pipValue).toBe(1.0);
      expect(info.symbolType).toBe('index');
    });

    it('should return correct pip value for EURUSD', () => {
      const info = getCurrencyPipInfo('EURUSD');
      expect(info.pipValue).toBe(0.0001);
      expect(info.symbolType).toBe('forex');
    });

    it('should return correct pip value for XAUUSD', () => {
      const info = getCurrencyPipInfo('XAUUSD');
      expect(info.pipValue).toBe(0.01);
      expect(info.symbolType).toBe('gold');
    });

    it('should return correct pip value for USDJPY', () => {
      const info = getCurrencyPipInfo('USDJPY');
      expect(info.pipValue).toBe(0.01);
      expect(info.symbolType).toBe('forex');
    });
  });

  describe('calculateDollarPerPip', () => {
    it('should calculate correct dollar per pip for US30', () => {
      expect(calculateDollarPerPip('US30', 0.01)).toBe(1);
      expect(calculateDollarPerPip('US30', 0.10)).toBe(10);
      expect(calculateDollarPerPip('US30', 1.0)).toBe(100);
    });

    it('should calculate correct dollar per pip for EURUSD', () => {
      expect(calculateDollarPerPip('EURUSD', 0.01)).toBe(0.1);
      expect(calculateDollarPerPip('EURUSD', 0.10)).toBe(1);
      expect(calculateDollarPerPip('EURUSD', 1.0)).toBe(10);
    });

    it('should calculate correct dollar per pip for XAUUSD', () => {
      expect(calculateDollarPerPip('XAUUSD', 0.01)).toBe(1);
      expect(calculateDollarPerPip('XAUUSD', 0.10)).toBe(10);
      expect(calculateDollarPerPip('XAUUSD', 1.0)).toBe(100);
    });
  });
});
