import {
  ALPHA_IDENTITY,
  shouldExecute,
  getEntryMode,
  getConfidenceAdjustedEQSThreshold,
  isLegitimateBlockCondition,
  calculateAdvisoryPenalty,
  EQS_WEIGHTED_FACTORS,
  EQS_TOTAL_WEIGHT,
  EQS_CONFIDENCE_TIERS,
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

    it('should have unified EQS baseline threshold of 60', () => {
      expect(ALPHA_IDENTITY.EQS_EXECUTION_THRESHOLD).toBe(60);
      expect(ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.SCALP.EXECUTE_IMMEDIATELY).toBe(60);
      expect(ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.MICRO_INTRADAY.EXECUTE_IMMEDIATELY).toBe(60);
      expect(ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.INTRADAY.EXECUTE_IMMEDIATELY).toBe(60);
    });

    it('should have confidence-based relaxation tiers', () => {
      expect(EQS_CONFIDENCE_TIERS.EXCELLENT.minConfidence).toBe(85);
      expect(EQS_CONFIDENCE_TIERS.EXCELLENT.eqsAdjustment).toBe(-10);
      expect(EQS_CONFIDENCE_TIERS.SOLID.minConfidence).toBe(70);
      expect(EQS_CONFIDENCE_TIERS.SOLID.eqsAdjustment).toBe(-5);
      expect(EQS_CONFIDENCE_TIERS.ACCEPTABLE.minConfidence).toBe(60);
      expect(EQS_CONFIDENCE_TIERS.ACCEPTABLE.eqsAdjustment).toBe(0);
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

  describe('getConfidenceAdjustedEQSThreshold', () => {
    it('should return 60 for baseline confidence (60-69%)', () => {
      expect(getConfidenceAdjustedEQSThreshold(60)).toBe(60);
      expect(getConfidenceAdjustedEQSThreshold(65)).toBe(60);
      expect(getConfidenceAdjustedEQSThreshold(69)).toBe(60);
    });

    it('should return 55 for solid confidence (70-84%)', () => {
      expect(getConfidenceAdjustedEQSThreshold(70)).toBe(55);
      expect(getConfidenceAdjustedEQSThreshold(75)).toBe(55);
      expect(getConfidenceAdjustedEQSThreshold(84)).toBe(55);
    });

    it('should return 50 for excellent confidence (85%+)', () => {
      expect(getConfidenceAdjustedEQSThreshold(85)).toBe(50);
      expect(getConfidenceAdjustedEQSThreshold(90)).toBe(50);
      expect(getConfidenceAdjustedEQSThreshold(100)).toBe(50);
    });
  });

  describe('shouldExecute', () => {
    it('should return false when confidence below minimum', () => {
      expect(shouldExecute(59, 90, 'SCALP')).toBe(false);
      expect(shouldExecute(50, 90, 'MICRO_INTRADAY')).toBe(false);
    });

    it('should use confidence-adjusted EQS thresholds', () => {
      // Confidence 60%: requires EQS 60
      expect(shouldExecute(60, 60, 'SCALP')).toBe(true);
      expect(shouldExecute(60, 59, 'SCALP')).toBe(false);

      // Confidence 70%: requires EQS 55
      expect(shouldExecute(70, 55, 'MICRO_INTRADAY')).toBe(true);
      expect(shouldExecute(70, 54, 'MICRO_INTRADAY')).toBe(false);

      // Confidence 85%: requires EQS 50
      expect(shouldExecute(85, 50, 'INTRADAY')).toBe(true);
      expect(shouldExecute(85, 49, 'INTRADAY')).toBe(false);
    });

    it('should allow high confidence trades with lower EQS', () => {
      // High conviction (85%) executes with EQS 50
      expect(shouldExecute(85, 50)).toBe(true);
      expect(shouldExecute(90, 52)).toBe(true);

      // Medium conviction (70%) executes with EQS 55
      expect(shouldExecute(70, 55)).toBe(true);
      expect(shouldExecute(75, 57)).toBe(true);

      // Baseline conviction (60%) requires full EQS 60
      expect(shouldExecute(60, 60)).toBe(true);
      expect(shouldExecute(65, 62)).toBe(true);
    });
  });

  describe('getEntryMode', () => {
    it('should return wait_confirmation when confidence below minimum', () => {
      expect(getEntryMode(55, 90, 'SCALP')).toBe('wait_confirmation');
    });

    it('should return immediate when EQS meets confidence-adjusted threshold', () => {
      // Confidence 60%: needs EQS 60+
      expect(getEntryMode(60, 60)).toBe('immediate');
      expect(getEntryMode(60, 70)).toBe('immediate');

      // Confidence 70%: needs EQS 55+
      expect(getEntryMode(70, 55)).toBe('immediate');
      expect(getEntryMode(70, 65)).toBe('immediate');

      // Confidence 85%: needs EQS 50+
      expect(getEntryMode(85, 50)).toBe('immediate');
      expect(getEntryMode(85, 60)).toBe('immediate');
    });

    it('should return wait_confirmation when EQS below confidence-adjusted threshold', () => {
      // Confidence 60%: EQS below 60
      expect(getEntryMode(60, 59)).toBe('wait_confirmation');

      // Confidence 70%: EQS below 55
      expect(getEntryMode(70, 54)).toBe('wait_confirmation');

      // Confidence 85%: EQS below 50
      expect(getEntryMode(85, 49)).toBe('wait_confirmation');
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
