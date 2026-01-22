import {
  ALPHA_IDENTITY,
  shouldExecute,
  getEntryMode,
  getConfidenceAdjustedEQSThreshold,
  getEQSConfidenceModifier,
  isLegitimateBlockCondition,
  calculateAdvisoryPenalty,
  EQS_WEIGHTED_FACTORS,
  EQS_TOTAL_WEIGHT,
  EQS_CONFIDENCE_TIERS,
  EQS_CONFIDENCE_MODIFIERS,
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

    it('should have unified EQS baseline threshold of 40', () => {
      expect(ALPHA_IDENTITY.EQS_EXECUTION_THRESHOLD).toBe(40);
      expect(ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.SCALP.EXECUTE_IMMEDIATELY).toBe(40);
      expect(ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.MICRO_INTRADAY.EXECUTE_IMMEDIATELY).toBe(40);
      expect(ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.INTRADAY.EXECUTE_IMMEDIATELY).toBe(40);
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

  describe('getConfidenceAdjustedEQSThreshold (DEPRECATED)', () => {
    it('should return 40 for baseline confidence (60-69%)', () => {
      expect(getConfidenceAdjustedEQSThreshold(60)).toBe(40);
      expect(getConfidenceAdjustedEQSThreshold(65)).toBe(40);
      expect(getConfidenceAdjustedEQSThreshold(69)).toBe(40);
    });

    it('should return 35 for solid confidence (70-84%)', () => {
      expect(getConfidenceAdjustedEQSThreshold(70)).toBe(35);
      expect(getConfidenceAdjustedEQSThreshold(75)).toBe(35);
      expect(getConfidenceAdjustedEQSThreshold(84)).toBe(35);
    });

    it('should return 30 for excellent confidence (85%+)', () => {
      expect(getConfidenceAdjustedEQSThreshold(85)).toBe(30);
      expect(getConfidenceAdjustedEQSThreshold(90)).toBe(30);
      expect(getConfidenceAdjustedEQSThreshold(100)).toBe(30);
    });
  });

  describe('getEQSConfidenceModifier', () => {
    it('should apply rewards for good timing (EQS 50+)', () => {
      expect(getEQSConfidenceModifier(75)).toBe(5);
      expect(getEQSConfidenceModifier(72)).toBe(4);
      expect(getEQSConfidenceModifier(67)).toBe(3);
      expect(getEQSConfidenceModifier(62)).toBe(2);
      expect(getEQSConfidenceModifier(57)).toBe(1);
      expect(getEQSConfidenceModifier(52)).toBe(0);
    });

    it('should apply steep penalties for poor timing (EQS <50)', () => {
      expect(getEQSConfidenceModifier(47)).toBe(-2);
      expect(getEQSConfidenceModifier(42)).toBe(-5);
      expect(getEQSConfidenceModifier(37)).toBe(-10);
      expect(getEQSConfidenceModifier(32)).toBe(-15);
      expect(getEQSConfidenceModifier(27)).toBe(-20);
      expect(getEQSConfidenceModifier(22)).toBe(-25);
      expect(getEQSConfidenceModifier(15)).toBe(-30);
    });
  });

  describe('shouldExecute', () => {
    it('should return false when adjusted confidence below minimum', () => {
      // 59% confidence + 0 EQS modifier = 59% (below 60%)
      expect(shouldExecute(59, 50)).toBe(false);

      // 65% confidence - 10 EQS penalty = 55% (below 60%)
      expect(shouldExecute(65, 35)).toBe(false);
    });

    it('should apply EQS modifiers to confidence before checking threshold', () => {
      // High conviction with poor timing:
      // 85% + EQS 35 → 85% - 10% = 75% → EXECUTE
      expect(shouldExecute(85, 35)).toBe(true);

      // 85% + EQS 25 → 85% - 20% = 65% → EXECUTE
      expect(shouldExecute(85, 25)).toBe(true);

      // 85% + EQS 20 → 85% - 25% = 60% → EXECUTE (barely)
      expect(shouldExecute(85, 20)).toBe(true);

      // 85% + EQS 15 → 85% - 30% = 55% → WAIT
      expect(shouldExecute(85, 15)).toBe(false);
    });

    it('should penalize medium conviction trades more severely', () => {
      // Medium conviction with poor timing:
      // 70% + EQS 35 → 70% - 10% = 60% → EXECUTE (barely)
      expect(shouldExecute(70, 35)).toBe(true);

      // 70% + EQS 30 → 70% - 15% = 55% → WAIT
      expect(shouldExecute(70, 30)).toBe(false);

      // 65% + EQS 40 → 65% - 5% = 60% → EXECUTE (barely)
      expect(shouldExecute(65, 40)).toBe(true);

      // 65% + EQS 35 → 65% - 10% = 55% → WAIT
      expect(shouldExecute(65, 35)).toBe(false);
    });

    it('should reward good timing with higher confidence', () => {
      // Baseline confidence with excellent timing:
      // 60% + EQS 75 → 60% + 5% = 65% → EXECUTE
      expect(shouldExecute(60, 75)).toBe(true);

      // 60% + EQS 70 → 60% + 4% = 64% → EXECUTE
      expect(shouldExecute(60, 70)).toBe(true);

      // 60% + EQS 50 → 60% + 0% = 60% → EXECUTE
      expect(shouldExecute(60, 50)).toBe(true);
    });
  });

  describe('getEntryMode', () => {
    it('should return wait_confirmation when adjusted confidence below minimum', () => {
      // 55% + EQS 50 → 55% + 0% = 55% (below 60%)
      expect(getEntryMode(55, 50)).toBe('wait_confirmation');

      // 65% + EQS 35 → 65% - 10% = 55% (below 60%)
      expect(getEntryMode(65, 35)).toBe('wait_confirmation');
    });

    it('should return immediate when adjusted confidence meets threshold', () => {
      // High conviction with poor timing still executes:
      // 85% + EQS 35 → 85% - 10% = 75% → IMMEDIATE
      expect(getEntryMode(85, 35)).toBe('immediate');

      // 70% + EQS 35 → 70% - 10% = 60% → IMMEDIATE (barely)
      expect(getEntryMode(70, 35)).toBe('immediate');

      // 60% + EQS 50 → 60% + 0% = 60% → IMMEDIATE
      expect(getEntryMode(60, 50)).toBe('immediate');
    });

    it('should return wait_confirmation when adjusted confidence fails', () => {
      // 70% + EQS 30 → 70% - 15% = 55% → WAIT
      expect(getEntryMode(70, 30)).toBe('wait_confirmation');

      // 65% + EQS 35 → 65% - 10% = 55% → WAIT
      expect(getEntryMode(65, 35)).toBe('wait_confirmation');

      // 60% + EQS 45 → 60% - 2% = 58% → WAIT
      expect(getEntryMode(60, 45)).toBe('wait_confirmation');
    });

    it('should benefit from good timing', () => {
      // 60% + EQS 75 → 60% + 5% = 65% → IMMEDIATE
      expect(getEntryMode(60, 75)).toBe('immediate');

      // 55% + EQS 70 → 55% + 4% = 59% → WAIT (still below 60%)
      expect(getEntryMode(55, 70)).toBe('wait_confirmation');

      // 56% + EQS 70 → 56% + 4% = 60% → IMMEDIATE (exactly at threshold)
      expect(getEntryMode(56, 70)).toBe('immediate');
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
