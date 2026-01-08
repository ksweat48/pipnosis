import {
  ALPHA_IDENTITY,
  shouldExecute,
  shouldWaitPullback,
  getEntryMode,
  isLegitimateBlockCondition,
  calculateAdvisoryPenalty,
  EQS_WEIGHTED_FACTORS,
  EQS_TOTAL_WEIGHT,
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

    it('should have correct SCALP EQS thresholds', () => {
      expect(ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.SCALP.EXECUTE_IMMEDIATELY).toBe(85);
      expect(ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.SCALP.WAIT_PULLBACK.min).toBe(70);
      expect(ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.SCALP.WAIT_PULLBACK.max).toBe(84);
    });

    it('should have correct MICRO_INTRADAY EQS thresholds', () => {
      expect(ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.MICRO_INTRADAY.EXECUTE_IMMEDIATELY).toBe(80);
      expect(ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.MICRO_INTRADAY.WAIT_PULLBACK.min).toBe(65);
    });

    it('should have correct INTRADAY EQS thresholds', () => {
      expect(ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.INTRADAY.EXECUTE_IMMEDIATELY).toBe(80);
      expect(ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.INTRADAY.WAIT_PULLBACK.min).toBe(65);
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

  describe('EQS_WEIGHTED_FACTORS', () => {
    it('should have 8 factors', () => {
      const factors = Object.keys(EQS_WEIGHTED_FACTORS);
      expect(factors.length).toBe(8);
    });

    it('should have correct spec weights', () => {
      expect(EQS_WEIGHTED_FACTORS.CANDLE_ACCEPTANCE.weight).toBe(20);
      expect(EQS_WEIGHTED_FACTORS.PULLBACK_QUALITY.weight).toBe(15);
      expect(EQS_WEIGHTED_FACTORS.VWAP_INTERACTION.weight).toBe(15);
      expect(EQS_WEIGHTED_FACTORS.EMA_ALIGNMENT.weight).toBe(10);
      expect(EQS_WEIGHTED_FACTORS.LIQUIDITY_REACTION.weight).toBe(15);
      expect(EQS_WEIGHTED_FACTORS.COMPRESSION_EXPANSION.weight).toBe(10);
      expect(EQS_WEIGHTED_FACTORS.FAILED_MOVE_CONFIRMATION.weight).toBe(10);
      expect(EQS_WEIGHTED_FACTORS.TIMEFRAME_ALIGNMENT.weight).toBe(5);
    });

    it('should have weights that sum to 100', () => {
      expect(EQS_TOTAL_WEIGHT).toBe(100);
    });
  });

  describe('shouldExecute', () => {
    it('should return false when confidence below minimum', () => {
      expect(shouldExecute(59, 90, 'SCALP')).toBe(false);
      expect(shouldExecute(50, 90, 'MICRO_INTRADAY')).toBe(false);
    });

    it('should return true for SCALP when confidence>=60 and EQS>=85', () => {
      expect(shouldExecute(60, 85, 'SCALP')).toBe(true);
      expect(shouldExecute(75, 90, 'SCALP')).toBe(true);
    });

    it('should return false for SCALP when EQS<85', () => {
      expect(shouldExecute(70, 84, 'SCALP')).toBe(false);
      expect(shouldExecute(80, 70, 'SCALP')).toBe(false);
    });

    it('should return true for MICRO_INTRADAY when confidence>=60 and EQS>=80', () => {
      expect(shouldExecute(60, 80, 'MICRO_INTRADAY')).toBe(true);
      expect(shouldExecute(75, 85, 'MICRO_INTRADAY')).toBe(true);
    });

    it('should return true for INTRADAY when confidence>=60 and EQS>=80', () => {
      expect(shouldExecute(60, 80, 'INTRADAY')).toBe(true);
      expect(shouldExecute(85, 95, 'INTRADAY')).toBe(true);
    });
  });

  describe('shouldWaitPullback', () => {
    it('should return true when confidence below minimum', () => {
      expect(shouldWaitPullback(55, 90, 'SCALP')).toBe(true);
    });

    it('should return true for SCALP when EQS 70-84', () => {
      expect(shouldWaitPullback(70, 70, 'SCALP')).toBe(true);
      expect(shouldWaitPullback(70, 80, 'SCALP')).toBe(true);
    });

    it('should return false for SCALP when EQS>=85', () => {
      expect(shouldWaitPullback(70, 85, 'SCALP')).toBe(false);
    });

    it('should return true for MICRO_INTRADAY when EQS 65-79', () => {
      expect(shouldWaitPullback(70, 65, 'MICRO_INTRADAY')).toBe(true);
      expect(shouldWaitPullback(70, 75, 'MICRO_INTRADAY')).toBe(true);
    });
  });

  describe('getEntryMode', () => {
    it('should return wait_confirmation when confidence below minimum', () => {
      expect(getEntryMode(55, 90, 'SCALP')).toBe('wait_confirmation');
    });

    it('should return immediate for high EQS above threshold', () => {
      expect(getEntryMode(70, 85, 'SCALP')).toBe('immediate');
      expect(getEntryMode(70, 80, 'MICRO_INTRADAY')).toBe('immediate');
      expect(getEntryMode(70, 80, 'INTRADAY')).toBe('immediate');
    });

    it('should return wait_pullback for EQS in pullback range', () => {
      expect(getEntryMode(70, 75, 'SCALP')).toBe('wait_pullback');
      expect(getEntryMode(70, 70, 'MICRO_INTRADAY')).toBe('wait_pullback');
    });

    it('should return wait_confirmation for low EQS', () => {
      expect(getEntryMode(70, 60, 'SCALP')).toBe('wait_confirmation');
      expect(getEntryMode(70, 50, 'MICRO_INTRADAY')).toBe('wait_confirmation');
    });
  });

  describe('isLegitimateBlockCondition', () => {
    it('should return true for valid block conditions', () => {
      expect(isLegitimateBlockCondition('STALE_DATA')).toBe(true);
      expect(isLegitimateBlockCondition('WRONG_SIDE_SL')).toBe(true);
      expect(isLegitimateBlockCondition('IMPOSSIBLE_PROFIT')).toBe(true);
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
