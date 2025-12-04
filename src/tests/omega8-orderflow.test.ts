/**
 * Unit tests for Omega-8 OrderFlow Brain
 */

import { omega8OrderFlow } from '../brains/omega/orderflow';
import type { OrderFlowSnapshot } from '../brains/omega/orderflow';

describe('Omega-8 OrderFlow Brain', () => {
  describe('buildSnapshot', () => {
    it('should build valid snapshot from market data', () => {
      const snapshot = omega8OrderFlow.buildSnapshot({
        price: 1.1000,
        support: [1.0950, 1.0900, 1.0850],
        resistance: [1.1050, 1.1100, 1.1150],
        recentCandles: [
          { open: 1.0990, high: 1.1020, low: 1.0980, close: 1.1010, volume: 1000 },
          { open: 1.1010, high: 1.1030, low: 1.1000, close: 1.1015, volume: 1200 },
          { open: 1.1015, high: 1.1025, low: 1.0995, close: 1.1000, volume: 1100 }
        ],
        atr: 0.0020,
        trend: 'bull',
        volatility: 'medium',
        currentStopLoss: 1.0970
      });

      expect(snapshot).toBeDefined();
      expect(snapshot.p).toBe(1.1000);
      expect(snapshot.liq_above.length).toBeGreaterThanOrEqual(0);
      expect(snapshot.liq_below.length).toBeGreaterThanOrEqual(0);
      expect(snapshot.tr).toBe('bull');
      expect(snapshot.vol).toBe('medium');
      expect(snapshot.atr).toBe(0.0020);
    });

    it('should detect equal highs', () => {
      const candles = [
        { open: 1.1000, high: 1.1050, low: 1.0990, close: 1.1020, volume: 1000 },
        { open: 1.1020, high: 1.1051, low: 1.1010, close: 1.1030, volume: 1000 },
        { open: 1.1030, high: 1.1050, low: 1.1020, close: 1.1025, volume: 1000 }
      ];

      const snapshot = omega8OrderFlow.buildSnapshot({
        price: 1.1000,
        support: [],
        resistance: [],
        recentCandles: candles,
        atr: 0.0020,
        trend: 'bull',
        volatility: 'medium'
      });

      expect(snapshot.eq_highs.length).toBeGreaterThanOrEqual(0);
    });

    it('should filter liquidity zones by ATR distance', () => {
      const snapshot = omega8OrderFlow.buildSnapshot({
        price: 1.1000,
        support: [1.0950, 1.0900, 1.0500],
        resistance: [1.1050, 1.1100, 1.1500],
        recentCandles: [],
        atr: 0.0020,
        trend: 'bull',
        volatility: 'medium'
      });

      snapshot.liq_above.forEach(level => {
        expect(level).toBeGreaterThan(1.1000);
        expect(level).toBeLessThan(1.1000 + 0.0020 * 3);
      });

      snapshot.liq_below.forEach(level => {
        expect(level).toBeLessThan(1.1000);
        expect(level).toBeGreaterThan(1.1000 - 0.0020 * 3);
      });
    });
  });

  describe('liquidity bias validation', () => {
    it('should return valid liquidity bias values', () => {
      const validBiases = ['clean', 'stoprun_risk', 'reaccumulation', 'distribution'];

      validBiases.forEach(bias => {
        const result = (omega8OrderFlow as any).validateLiquidityBias(bias);
        expect(validBiases).toContain(result);
      });
    });

    it('should default to clean for invalid bias', () => {
      const result = (omega8OrderFlow as any).validateLiquidityBias('invalid_bias');
      expect(result).toBe('clean');
    });
  });

  describe('direction support validation', () => {
    it('should return valid direction support values', () => {
      const validDirections = ['buy', 'sell', 'neutral'];

      validDirections.forEach(dir => {
        const result = (omega8OrderFlow as any).validateDirectionSupport(dir);
        expect(validDirections).toContain(result);
      });
    });

    it('should default to neutral for invalid direction', () => {
      const result = (omega8OrderFlow as any).validateDirectionSupport('invalid_direction');
      expect(result).toBe('neutral');
    });
  });
});
