import {
  ALPHA_IDENTITY,
  shouldExecute,
  getEntryMode,
  isLegitimateBlockCondition,
  calculateAdvisoryPenalty,
} from '../config/alpha-identity';

describe('Alpha Identity Configuration', () => {
  describe('ALPHA_IDENTITY constants', () => {
    it('should have minimum trade confidence of 60', () => {
      expect(ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE).toBe(60);
    });

    it('should have correct confidence bands', () => {
      expect(ALPHA_IDENTITY.CONFIDENCE_BANDS.EXCELLENT.min).toBe(85);
      expect(ALPHA_IDENTITY.CONFIDENCE_BANDS.SOLID.min).toBe(70);
      expect(ALPHA_IDENTITY.CONFIDENCE_BANDS.ACCEPTABLE.min).toBe(60);
      expect(ALPHA_IDENTITY.CONFIDENCE_BANDS.INSUFFICIENT.max).toBe(59);
    });

    it('should have max advisory penalty of 30', () => {
      expect(ALPHA_IDENTITY.MAX_ADVISORY_PENALTY).toBe(30);
    });

    it('should define all advisory systems as non-blocking', () => {
      expect(ALPHA_IDENTITY.ADVISORY_SYSTEMS.REGIME_ORACLE.canBlock).toBe(false);
      expect(ALPHA_IDENTITY.ADVISORY_SYSTEMS.ADVERSARIAL_DETECTOR.canBlock).toBe(false);
      expect(ALPHA_IDENTITY.ADVISORY_SYSTEMS.SESSION_CONSTRAINTS.canBlock).toBe(false);
      expect(ALPHA_IDENTITY.ADVISORY_SYSTEMS.OMEGA_CONSENSUS.canBlock).toBe(false);
    });
  });

  describe('shouldExecute', () => {
    it('should return false when confidence below minimum', () => {
      expect(shouldExecute(59)).toBe(false);
      expect(shouldExecute(0)).toBe(false);
    });

    it('should return true when confidence meets threshold', () => {
      expect(shouldExecute(60)).toBe(true);
      expect(shouldExecute(75)).toBe(true);
      expect(shouldExecute(100)).toBe(true);
    });
  });

  describe('getEntryMode', () => {
    it('should return wait_pullback when confidence below minimum', () => {
      expect(getEntryMode(55)).toBe('wait_pullback');
      expect(getEntryMode(59)).toBe('wait_pullback');
    });

    it('should return execute_now when confidence meets threshold', () => {
      expect(getEntryMode(60)).toBe('execute_now');
      expect(getEntryMode(85)).toBe('execute_now');
      expect(getEntryMode(100)).toBe('execute_now');
    });
  });

  describe('isLegitimateBlockCondition', () => {
    it('should return true for valid block conditions', () => {
      expect(isLegitimateBlockCondition('DATA_STALE')).toBe(true);
      expect(isLegitimateBlockCondition('INVALID_STOP_LOSS')).toBe(true);
      expect(isLegitimateBlockCondition('BROKEN_FEED')).toBe(true);
      expect(isLegitimateBlockCondition('MARKET_CLOSED')).toBe(true);
      expect(isLegitimateBlockCondition('ZERO_DISTANCE_SL_TP')).toBe(true);
    });

    it('should return false for invalid block conditions', () => {
      expect(isLegitimateBlockCondition('LOW_CONFIDENCE')).toBe(false);
      expect(isLegitimateBlockCondition('REGIME_AVOID')).toBe(false);
      expect(isLegitimateBlockCondition('SESSION_CONSTRAINT')).toBe(false);
    });
  });

  describe('calculateAdvisoryPenalty', () => {
    it('should return 0 for empty penalties', () => {
      expect(calculateAdvisoryPenalty([])).toBe(0);
    });

    it('should sum penalties correctly', () => {
      const penalties = [
        { source: 'Regime', penalty: 10 },
        { source: 'Adversarial', penalty: 5 },
      ];
      expect(calculateAdvisoryPenalty(penalties)).toBe(15);
    });

    it('should cap total penalty at MAX_ADVISORY_PENALTY', () => {
      const penalties = [
        { source: 'Regime', penalty: 20 },
        { source: 'Adversarial', penalty: 20 },
      ];
      expect(calculateAdvisoryPenalty(penalties)).toBe(30);
    });
  });
});
