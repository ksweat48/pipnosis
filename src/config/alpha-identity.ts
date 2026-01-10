/**
 * Alpha Identity Configuration - Single Source of Truth
 *
 * ═══════════════════════════════════════════════════════════════════
 * ALPHA PROFESSIONAL TRADING IDENTITY
 * ═══════════════════════════════════════════════════════════════════
 *
 * This file defines Alpha's behavioral rules, confidence thresholds,
 * and decision framework. ALL modules must reference this file for
 * Alpha-related configuration.
 *
 * ARCHITECTURE:
 * - Alpha is the FINAL AUTHORITY on trade decisions
 * - Advisory systems (Regime Oracle, Adversarial Detector) provide guidance only
 * - Only legitimate block conditions can prevent trade execution
 * - WAIT is preferred over NO_TRADE when edge exists
 *
 * SSOT COMPLIANCE:
 * - Confidence thresholds: THIS FILE
 * - EQS thresholds by style: THIS FILE (all reference EQS_EXECUTION_THRESHOLD)
 * - Legitimate block conditions: THIS FILE
 * - Advisory system designations: THIS FILE
 * ═══════════════════════════════════════════════════════════════════
 */

/**
 * UNIFIED EQS THRESHOLD - SINGLE SOURCE OF TRUTH
 * This constant is the ONLY place where the EQS execution threshold is defined.
 * All style-specific thresholds reference this value.
 *
 * To change the threshold for all styles, modify this constant ONLY.
 *
 * LOWERED FROM 80 TO 60:
 * With candle acceptance removed and price-in-zone emphasized,
 * 60 EQS is sufficient for execution when price is in entry zone.
 *
 * NOTE: This is the BASELINE threshold. High confidence can relax this further.
 * See getConfidenceAdjustedEQSThreshold() for dynamic adjustment logic.
 */
const EQS_EXECUTION_THRESHOLD = 60;

/**
 * CONFIDENCE-BASED EQS RELAXATION TIERS
 * High conviction trades get entry timing flexibility
 */
export const EQS_CONFIDENCE_TIERS = {
  EXCELLENT: { minConfidence: 85, eqsAdjustment: -10 },  // 85%+ confidence: EQS 50
  SOLID: { minConfidence: 70, eqsAdjustment: -5 },       // 70%+ confidence: EQS 55
  ACCEPTABLE: { minConfidence: 60, eqsAdjustment: 0 },   // 60%+ confidence: EQS 60
} as const;

/**
 * TIME-BASED ENTRY URGENCY CONFIGURATION
 *
 * Automatically applied based on trading style (no user choice):
 * - SCALP: Fast urgency (5/15/25 min phase transitions)
 * - MICRO_INTRADAY: Medium urgency (8/20/35 min transitions)
 * - INTRADAY: Slower urgency (15/35/55 min transitions)
 *
 * Phase Progression:
 * - Phase 1 (STRICT): Base threshold (60)
 * - Phase 2 (RELAXED): Threshold -10 (50)
 * - Phase 3 (URGENT): Threshold -20 (40)
 *
 * High Alpha confidence accelerates phase transitions
 */
export const ENTRY_URGENCY_CONFIG = {
  PHASE_THRESHOLDS: {
    PHASE_1: { threshold: 60, description: 'Strict - Original threshold' },
    PHASE_2: { threshold: 50, description: 'Relaxed - Near zone acceptable' },
    PHASE_3: { threshold: 40, description: 'Urgent - Continuation entries allowed' },
  },

  STYLE_TIME_THRESHOLDS: {
    SCALP: {
      PHASE_2_MINUTES: 5,   // Enter Phase 2 at 5 minutes
      PHASE_3_MINUTES: 15,  // Enter Phase 3 at 15 minutes
      MAX_WAIT_MINUTES: 25, // Expire intent at 25 minutes
    },
    MICRO_INTRADAY: {
      PHASE_2_MINUTES: 8,
      PHASE_3_MINUTES: 20,
      MAX_WAIT_MINUTES: 35,
    },
    INTRADAY: {
      PHASE_2_MINUTES: 15,
      PHASE_3_MINUTES: 35,
      MAX_WAIT_MINUTES: 55,
    },
  },

  // High confidence accelerates phase transitions
  CONFIDENCE_ACCELERATION: {
    EXCELLENT: 0.75,  // 85%+ confidence: 25% faster phase transitions
    SOLID: 0.85,      // 70%+ confidence: 15% faster
    ACCEPTABLE: 1.0,  // 60%+ confidence: Normal speed
  },
} as const;

export const ALPHA_IDENTITY = {
  MINIMUM_TRADE_CONFIDENCE: 60,

  CONFIDENCE_BANDS: {
    EXCELLENT: { min: 85, max: 100, description: 'Excellent setup - Strong confluence' },
    SOLID: { min: 70, max: 84, description: 'Solid setup - Good conditions' },
    ACCEPTABLE: { min: 60, max: 69, description: 'Acceptable setup - Modest edge' },
    INSUFFICIENT: { min: 0, max: 59, description: 'Insufficient edge - WAIT recommended' },
  },

  /**
   * UNIFIED EQS THRESHOLD (SSOT)
   * All trade styles use this threshold for execution.
   * This ensures consistent entry quality standards across all timeframes.
   */
  EQS_EXECUTION_THRESHOLD,
  EQS_EXCEPTIONAL_OVERRIDE_THRESHOLD: 75,  // For near-zone overrides with exceptional quality (lowered from 90)

  /**
   * STYLE_EQS_THRESHOLDS
   * All styles reference the unified EQS_EXECUTION_THRESHOLD constant.
   * This ensures consistent entry quality standards across all timeframes.
   *
   * SSOT: Changing EQS_EXECUTION_THRESHOLD above automatically updates all styles.
   *
   * Structure:
   * - EXECUTE_IMMEDIATELY: Threshold for immediate execution
   * - WAIT_PULLBACK: Range for waiting for better entry timing
   */
  STYLE_EQS_THRESHOLDS: {
    SCALP: {
      EXECUTE_IMMEDIATELY: EQS_EXECUTION_THRESHOLD,
      WAIT_PULLBACK: {
        min: EQS_EXECUTION_THRESHOLD - 10,
        max: EQS_EXECUTION_THRESHOLD - 1
      }
    },
    MICRO_INTRADAY: {
      EXECUTE_IMMEDIATELY: EQS_EXECUTION_THRESHOLD,
      WAIT_PULLBACK: {
        min: EQS_EXECUTION_THRESHOLD - 15,
        max: EQS_EXECUTION_THRESHOLD - 1
      }
    },
    INTRADAY: {
      EXECUTE_IMMEDIATELY: EQS_EXECUTION_THRESHOLD,
      WAIT_PULLBACK: {
        min: EQS_EXECUTION_THRESHOLD - 15,
        max: EQS_EXECUTION_THRESHOLD - 1
      }
    },
  } as const,

  LEGITIMATE_BLOCK_CONDITIONS: [
    'STALE_DATA',
    'WRONG_SIDE_SL',
    'IMPOSSIBLE_PROFIT',
    'BROKEN_FEED',
    'MARKET_CLOSED',
    'ZERO_DISTANCE_SL_TP',
  ] as const,

  ADVISORY_SYSTEMS: {
    REGIME_ORACLE: {
      name: 'Regime Oracle',
      type: 'ADVISORY' as const,
      maxConfidencePenalty: 15,
      canBlock: false,
    },
    ADVERSARIAL_DETECTOR: {
      name: 'Adversarial Detector',
      type: 'ADVISORY' as const,
      maxConfidencePenalty: 15,
      canBlock: false,
    },
    SESSION_CONSTRAINTS: {
      name: 'Session Constraints',
      type: 'ADVISORY' as const,
      maxConfidencePenalty: 10,
      canBlock: false,
    },
    OMEGA_CONSENSUS: {
      name: 'Omega Consensus',
      type: 'ADVISORY' as const,
      maxConfidencePenalty: 20,
      canBlock: false,
    },
  },

  MAX_ADVISORY_PENALTY: 30,
} as const;

export type LegitimateBlockCondition = typeof ALPHA_IDENTITY.LEGITIMATE_BLOCK_CONDITIONS[number];

export type StyleName = 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';

export type AlphaAction = 'BUY' | 'SELL' | 'WAIT' | 'NO_TRADE';

export type EntryMode = 'immediate' | 'wait_pullback' | 'wait_confirmation';

export interface AlphaOutputFormat {
  action: AlphaAction;
  trade_confidence: number;
  entry_quality_score: number;
  entry_mode: EntryMode;
  style: StyleName;
  reasoning: string;
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
  wait_condition?: {
    target_entry_zone_min: number;
    target_entry_zone_max: number;
    invalidation_price: number;
    wait_reasoning: string;
  };
}

export const EQS_WEIGHTED_FACTORS = {
  CANDLE_ACCEPTANCE: {
    name: 'Candle acceptance (body dominance, closes)',
    weight: 20,
    description: 'Body dominance ratio, closes in direction, consecutive closes',
  },
  PULLBACK_QUALITY: {
    name: 'Pullback quality / impulse structure',
    weight: 15,
    description: '38-50% retracement quality, impulse identification',
  },
  VWAP_INTERACTION: {
    name: 'VWAP interaction (kiss, reclaim, spread)',
    weight: 15,
    description: 'VWAP proximity, kiss patterns, spread from VWAP',
  },
  EMA_ALIGNMENT: {
    name: 'EMA alignment / slope / crossover',
    weight: 10,
    description: 'EMA20 alignment with direction, slope confirmation',
  },
  LIQUIDITY_REACTION: {
    name: 'Liquidity reaction (not detection)',
    weight: 15,
    description: 'Response to liquidity pools, sweep-reclaim patterns',
  },
  COMPRESSION_EXPANSION: {
    name: 'Compression to expansion',
    weight: 10,
    description: 'Tight range breakout patterns, compression detection',
  },
  FAILED_MOVE_CONFIRMATION: {
    name: 'Failed move confirmation',
    weight: 10,
    description: 'False breakout confirmation, exhaustion patterns',
  },
  TIMEFRAME_ALIGNMENT: {
    name: 'Timeframe alignment (M5 for entry)',
    weight: 5,
    description: 'M5 microstructure confirmation for entry timing',
  },
} as const;

export const EQS_TOTAL_WEIGHT = Object.values(EQS_WEIGHTED_FACTORS).reduce(
  (sum, factor) => sum + factor.weight,
  0
);

/**
 * Get confidence-adjusted EQS threshold - SSOT for dynamic EQS requirements
 *
 * High confidence trades get entry timing flexibility:
 * - 85%+ confidence: Requires EQS 50 (professional sniper takes the shot)
 * - 70%+ confidence: Requires EQS 55 (solid setup, minor timing flex)
 * - 60%+ confidence: Requires EQS 60 (baseline standard)
 *
 * Philosophy: When Alpha is highly confident in the trade idea,
 * don't let minor entry timing issues block execution.
 */
export function getConfidenceAdjustedEQSThreshold(tradeConfidence: number): number {
  if (tradeConfidence >= EQS_CONFIDENCE_TIERS.EXCELLENT.minConfidence) {
    return ALPHA_IDENTITY.EQS_EXECUTION_THRESHOLD + EQS_CONFIDENCE_TIERS.EXCELLENT.eqsAdjustment;
  }
  if (tradeConfidence >= EQS_CONFIDENCE_TIERS.SOLID.minConfidence) {
    return ALPHA_IDENTITY.EQS_EXECUTION_THRESHOLD + EQS_CONFIDENCE_TIERS.SOLID.eqsAdjustment;
  }
  return ALPHA_IDENTITY.EQS_EXECUTION_THRESHOLD;
}

export function shouldExecute(
  tradeConfidence: number,
  entryQualityScore: number,
  style?: StyleName
): boolean {
  if (tradeConfidence < ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE) {
    return false;
  }

  const requiredEQS = getConfidenceAdjustedEQSThreshold(tradeConfidence);
  return entryQualityScore >= requiredEQS;
}

export function getEntryMode(
  tradeConfidence: number,
  entryQualityScore: number,
  style?: StyleName
): EntryMode {
  if (tradeConfidence < ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE) {
    return 'wait_confirmation';
  }

  const requiredEQS = getConfidenceAdjustedEQSThreshold(tradeConfidence);
  if (entryQualityScore >= requiredEQS) {
    return 'immediate';
  }

  return 'wait_confirmation';
}

export function isLegitimateBlockCondition(condition: string): boolean {
  return ALPHA_IDENTITY.LEGITIMATE_BLOCK_CONDITIONS.includes(
    condition as LegitimateBlockCondition
  );
}

export function calculateAdvisoryPenalty(
  advisoryPenalties: { source: string; penalty: number }[]
): number {
  const totalPenalty = advisoryPenalties.reduce((sum, a) => sum + a.penalty, 0);
  return Math.min(totalPenalty, ALPHA_IDENTITY.MAX_ADVISORY_PENALTY);
}

export function getAlphaSystemPrompt(): string {
  return `You are Alpha, a professional trading sniper with FINAL AUTHORITY over all trade decisions.

═══════════════════════════════════════════════════════════════════
CORE IDENTITY: PROFESSIONAL TRADING SNIPER
═══════════════════════════════════════════════════════════════════

DECISION AUTHORITY:
- You are the FINAL decision maker. No advisory system can block your trades.
- Regime Oracle, Adversarial Detector, Session Constraints = ADVISORY ONLY
- Maximum confidence penalty from ALL advisories combined: ${ALPHA_IDENTITY.MAX_ADVISORY_PENALTY}%
- You MAY proceed despite all warnings if you have statistical justification

MINIMUM CONFIDENCE THRESHOLD: ${ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE}%
- Below ${ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE}%: Return WAIT (not NO_TRADE unless edge is gone)
- ${ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE}-${ALPHA_IDENTITY.CONFIDENCE_BANDS.ACCEPTABLE.max}%: ${ALPHA_IDENTITY.CONFIDENCE_BANDS.ACCEPTABLE.description}
- ${ALPHA_IDENTITY.CONFIDENCE_BANDS.SOLID.min}-${ALPHA_IDENTITY.CONFIDENCE_BANDS.SOLID.max}%: ${ALPHA_IDENTITY.CONFIDENCE_BANDS.SOLID.description}
- ${ALPHA_IDENTITY.CONFIDENCE_BANDS.EXCELLENT.min}-100%: ${ALPHA_IDENTITY.CONFIDENCE_BANDS.EXCELLENT.description}

CONFIDENCE-ADJUSTED EQS THRESHOLDS (Dynamic Entry Standards):
- Confidence >= 85% (EXCELLENT): Requires EQS >= 50 (high conviction, entry flexibility)
- Confidence >= 70% (SOLID): Requires EQS >= 55 (good setup, modest flexibility)
- Confidence >= 60% (ACCEPTABLE): Requires EQS >= 60 (baseline standard)
- Professional snipers take the shot when conviction is high

DECISION FRAMEWORK:
1. Confidence >= 85% + EQS >= 50: EXECUTE (high conviction trade)
2. Confidence >= 70% + EQS >= 55: EXECUTE (solid setup)
3. Confidence >= 60% + EQS >= 60: EXECUTE (acceptable setup)
4. Confidence >= 60% but EQS below threshold: WAIT for better entry
5. Confidence < 60%: WAIT (insufficient edge)

LEGITIMATE NO_TRADE CONDITIONS (ONLY THESE):
${ALPHA_IDENTITY.LEGITIMATE_BLOCK_CONDITIONS.map(c => `- ${c}`).join('\n')}

NO_TRADE is reserved for situations where profit is PHYSICALLY IMPOSSIBLE.
If profit is possible, return EXECUTE or WAIT - never NO_TRADE.

OUTPUT FORMAT:
{
  "action": "BUY|SELL|WAIT",
  "trade_confidence": 0-100,
  "entry_quality_score": 0-100,
  "entry_mode": "immediate|wait_pullback|wait_confirmation",
  "style": "SCALP|MICRO_INTRADAY|INTRADAY",
  "reasoning": "Brief professional reasoning",
  "entry": price,
  "stopLoss": price,
  "takeProfit": price,
  "wait_condition": { ... } // only if action is WAIT
}

ALPHA MENTALITY:
- Precision beats hesitation
- Partial profit beats no profit
- WAIT with clear conditions beats NO_TRADE
- Advisory warnings inform, never block
- Professional snipers execute when edge exists
═══════════════════════════════════════════════════════════════════`;
}
