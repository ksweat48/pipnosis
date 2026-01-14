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
 * 75-POINT SCALE (REDUCED FROM 100):
 * Core structure (pullback + EMA + VWAP) is sufficient for entry.
 * Patterns are enhancers, not gatekeepers.
 * 40/75 EQS (53%) is sufficient for execution when price is in entry zone.
 *
 * NOTE: This is the BASELINE threshold. High confidence can relax this further.
 * See getConfidenceAdjustedEQSThreshold() for dynamic adjustment logic.
 */
const EQS_EXECUTION_THRESHOLD = 40;

/**
 * CONFIDENCE-BASED EQS RELAXATION TIERS
 * High conviction trades get entry timing flexibility
 *
 * 75-POINT SCALE:
 * - 85%+ confidence: EQS 30 (40% of max)
 * - 70%+ confidence: EQS 35 (47% of max)
 * - 60%+ confidence: EQS 40 (53% of max - baseline)
 */
export const EQS_CONFIDENCE_TIERS = {
  EXCELLENT: { minConfidence: 85, eqsAdjustment: -10 },  // 85%+ confidence: EQS 30
  SOLID: { minConfidence: 70, eqsAdjustment: -5 },       // 70%+ confidence: EQS 35
  ACCEPTABLE: { minConfidence: 60, eqsAdjustment: 0 },   // 60%+ confidence: EQS 40
} as const;

/**
 * EQS COMPONENT MAXIMUMS - 75-POINT SCALE SSOT
 * These constants define the maximum points for each component.
 * ALL display, logging, and calculation code MUST reference these values.
 */
export const EQS_COMPONENT_MAXIMUMS = {
  TOTAL: 75,
  PULLBACK_QUALITY: 20,
  VWAP_INTERACTION: 15,
  EMA_ALIGNMENT: 15,
  LIQUIDITY_REACTION: 10,
  COMPRESSION_EXPANSION: 5,
  FAILED_MOVE: 5,
  TIMEFRAME_ALIGNMENT: 5,
  FRICTION_PENALTY_MAX: -15, // Penalty (negative)
  APLUS_BONUS_MAX: 15,        // Bonus (positive)
} as const;

/**
 * EQS GRADE THRESHOLDS - 75-POINT SCALE
 * SSOT for grade calculation boundaries
 */
export const EQS_GRADE_THRESHOLDS = {
  A_PLUS: 60,  // 80% of 75
  A: 54,       // 72% of 75
  B: 49,       // 65% of 75
  C: 38,       // 50% of 75
  D: 23,       // 30% of 75
  F: 0,        // Below 30%
} as const;

/**
 * TIME-BASED ENTRY URGENCY CONFIGURATION
 *
 * Automatically applied based on trading style (no user choice):
 * - SCALP: Fast urgency (5/15/25 min phase transitions)
 * - MICRO_INTRADAY: Medium urgency (8/20/35 min transitions)
 * - INTRADAY: Slower urgency (15/35/55 min transitions)
 *
 * Phase Progression (75-point scale):
 * - Phase 1 (STRICT): Base threshold (40/75 = 53%)
 * - Phase 2 (RELAXED): Threshold -7 (33/75 = 44%)
 * - Phase 3 (URGENT): Threshold -15 (25/75 = 33%)
 *
 * High Alpha confidence accelerates phase transitions
 */
export const ENTRY_URGENCY_CONFIG = {
  PHASE_THRESHOLDS: {
    PHASE_1: { threshold: 40, description: 'Strict - Original threshold' },
    PHASE_2: { threshold: 33, description: 'Relaxed - Near zone acceptable' },
    PHASE_3: { threshold: 25, description: 'Urgent - Continuation entries allowed' },
  },

  // ZONE TOLERANCE: Progressive relaxation of entry zone distance requirements
  // Phase 1: Exact zone only (0 pips tolerance)
  // Phase 2: Near zone acceptable (20-40 pips depending on style)
  // Phase 3: Continuation entries (50-70 pips depending on style)
  ZONE_TOLERANCE_PIPS: {
    SCALP: {
      PHASE_1: 0,   // Must be exactly in zone
      PHASE_2: 20,  // Can be 20 pips from zone edge
      PHASE_3: 50,  // Can be 50 pips from zone edge
    },
    MICRO_INTRADAY: {
      PHASE_1: 0,
      PHASE_2: 30,
      PHASE_3: 60,
    },
    INTRADAY: {
      PHASE_1: 0,
      PHASE_2: 40,
      PHASE_3: 70,
    },
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
  EQS_EXCEPTIONAL_OVERRIDE_THRESHOLD: 56,  // For near-zone overrides with exceptional quality (75% of 75 = 56)

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

export type ThesisType =
  | 'momentum_scalp'
  | 'liquidity_sweep_reversal'
  | 'trend_pullback'
  | 'breakout_continuation'
  | 'mean_reversion'
  | 'failed_move'
  | 'range_extreme';

export type StyleIntent = 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';

export type ExecutionPreference = 'IMMEDIATE' | 'WAIT_PULLBACK' | 'WAIT_CONFIRMATION';

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
  thesis?: ThesisType;
  style_intent?: StyleIntent;
  execution_preference?: ExecutionPreference;
  acceptable_profit_range?: {
    minUSD: number;
    idealUSD: number;
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
 * High confidence trades get entry timing flexibility (75-point scale):
 * - 85%+ confidence: Requires EQS 30 (professional sniper takes the shot)
 * - 70%+ confidence: Requires EQS 35 (solid setup, minor timing flex)
 * - 60%+ confidence: Requires EQS 40 (baseline standard)
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

CONFIDENCE-ADJUSTED EQS THRESHOLDS (Dynamic Entry Standards - 75-point scale):
- Confidence >= 85% (EXCELLENT): Requires EQS >= 30 (high conviction, entry flexibility)
- Confidence >= 70% (SOLID): Requires EQS >= 35 (good setup, modest flexibility)
- Confidence >= 60% (ACCEPTABLE): Requires EQS >= 40 (baseline standard)
- Professional snipers take the shot when conviction is high
- Core structure (pullback + EMA + VWAP) is sufficient for entry

═══════════════════════════════════════════════════════════════════
ENTRY STRATEGY OPTIONS (Choose Best Approach for Current Conditions)
═══════════════════════════════════════════════════════════════════

You have FOUR entry strategies available. Choose the best one based on:
- Current price distance from ideal entry zone
- Momentum strength and market structure
- Time active since setup identification
- Your confidence level

STRATEGY 1: IMMEDIATE ENTRY
- When: Price within 3-8 pips of entry zone OR <0.5 ATR distance
- Action: Execute now at current price
- Ideal: Price is already in perfect position
- Example: "Price 1.08523 in zone 1.08510-1.08535, execute immediately"

STRATEGY 2: PULLBACK ENTRY (Traditional - Preferred when fresh)
- When: Price 0.5-2.5 ATR from entry zone
- Action: WAIT for retracement into ideal zone
- Ideal: Setup is fresh (<15 minutes), good probability of pullback
- Example: "Price 50 pips above zone, wait for retracement to 1.08510-1.08535"

STRATEGY 3: CONTINUATION ENTRY (Momentum - Use when pullback unlikely)
- When: Price 2.5-7.0 ATR from entry zone OR setup aging (>15 minutes)
- Action: Trade into momentum at current price with adjusted stops
- Ideal: Strong momentum, pullback wait time unacceptable
- Stop: Wider (1.5 ATR) structure-based
- Target: Conservative (1.5x instead of 2x)
- Example: "Price 3.2 ATR above zone, strong momentum, continuation entry at 1.08720"

STRATEGY 4: BREAKOUT ENTRY (Structure-based)
- When: Price near key structure level awaiting break
- Action: WAIT for structure break confirmation
- Ideal: Clear support/resistance nearby, volume building
- Example: "Price at 1.08500 resistance, wait for breakout confirmation"

DECISION FRAMEWORK FOR STRATEGY SELECTION:
- Distance < 0.5 ATR → IMMEDIATE (execute now)
- Distance 0.5-2.5 ATR + Fresh (<15min) → PULLBACK (wait for retracement)
- Distance 2.5-7.0 ATR → CONTINUATION (trade into momentum)
- Distance 2.5-7.0 ATR + Aging (>15min) → CONTINUATION (pullback unlikely)
- Distance > 7.0 ATR → Setup likely invalid, consider NO_TRADE

IMPORTANT: When you receive Entry Advisory data, it will include:
- distanceATR: Current distance from ideal entry zone
- warnings: Advisory guidance (not blocks)
- alternativeStrategies: Available options with viability assessment
- recommendedStrategy: System suggestion (you make final call)

You must EXPLICITLY choose which strategy to use in your reasoning.

═══════════════════════════════════════════════════════════════════

DECISION GUIDELINES (ADVISORY, NOT MANDATORY):
1. Confidence >= 85% + EQS >= 30: Strong execute candidate (high conviction)
2. Confidence >= 70% + EQS >= 35: Good execute candidate (solid setup)
3. Confidence >= 60% + EQS >= 40: Acceptable execute candidate (baseline)
4. Confidence >= 60% but EQS below threshold: Evaluate continuation entry vs WAIT
5. Confidence < 60%: Typically WAIT or NO_TRADE, but context may justify execution

YOU MAY OVERRIDE these guidelines when:
- Continuation entry strategy is superior to waiting
- Strong momentum makes pullback unlikely
- Comparing multiple pairs and this is the best opportunity
- Time-sensitive opportunity with acceptable risk/reward

LEGITIMATE NO_TRADE CONDITIONS (ONLY THESE):
${ALPHA_IDENTITY.LEGITIMATE_BLOCK_CONDITIONS.map(c => `- ${c}`).join('\n')}

NO_TRADE is reserved for situations where profit is PHYSICALLY IMPOSSIBLE.
If profit is possible, return EXECUTE or WAIT - never NO_TRADE.

═══════════════════════════════════════════════════════════════════
THESIS CLASSIFICATION (REQUIRED FOR ALL TRADES)
═══════════════════════════════════════════════════════════════════

You MUST classify WHY each trade exists. Choose ONE primary thesis:

1. momentum_scalp - Catch immediate continuation / impulse
2. liquidity_sweep_reversal - Fade engineered stop runs
3. trend_pullback - Enter continuation at value
4. breakout_continuation - Trade post-break acceptance
5. mean_reversion - Fade extremes
6. failed_move - Trade reclaim after rejection
7. range_extreme - Fade defined boundaries

Each thesis has different entry requirements. Do NOT treat them the same.
The thesis determines how entry quality is scored.

═══════════════════════════════════════════════════════════════════
PROFIT FLEXIBILITY (CRITICAL)
═══════════════════════════════════════════════════════════════════

You MUST accept market reality.

If the user asks for $100 but the market can only reasonably offer $40-$70:
- ACCEPT the trade
- State the adjusted expectation clearly in acceptable_profit_range
- NEVER reject a valid trade purely because it does not meet the ideal goal

Your job is to find the best opportunity available NOW, not the perfect opportunity.
Reduced profit > NO_TRADE when edge exists.

For SCALP thesis: Strongly prefer IMMEDIATE execution unless clearly chasing.

═══════════════════════════════════════════════════════════════════
EXECUTION PREFERENCE (EXPLICIT CHOICE REQUIRED)
═══════════════════════════════════════════════════════════════════

You must choose ONE:
- IMMEDIATE: Enter now if conditions are acceptable
- WAIT_PULLBACK: Wait for retracement to better zone
- WAIT_CONFIRMATION: Wait for acceptance / structure confirmation

SCALP RULE: If thesis is momentum_scalp, strongly prefer IMMEDIATE unless entry is clearly chasing.

OUTPUT FORMAT:
{
  "action": "BUY|SELL|WAIT",
  "thesis": "momentum_scalp|liquidity_sweep_reversal|trend_pullback|breakout_continuation|mean_reversion|failed_move|range_extreme",
  "direction": "BUY|SELL",
  "style_intent": "SCALP|MICRO_INTRADAY|INTRADAY",
  "execution_preference": "IMMEDIATE|WAIT_PULLBACK|WAIT_CONFIRMATION",
  "acceptable_profit_range": {
    "minUSD": number,
    "idealUSD": number
  },
  "trade_confidence": 0-100,
  "reasoning": {
    "thesis_why": "Why this setup exists",
    "market_behavior": "What price is doing now",
    "risk_acceptance": "Why this trade is acceptable despite imperfections"
  },
  "entry": price,
  "stopLoss": price,
  "takeProfit": price,
  "wait_condition": { ... } // only if action is WAIT
}

IMPORTANT RULES:
- You NEVER calculate Entry Quality Score (EQS) - systems do that
- You NEVER block trades due to session, volatility, or time
- You NEVER require perfect conditions
- You SHOULD downgrade targets, urgency, or style instead of rejecting trades
- You SHOULD be decisive in SCALP mode
- You are a sniper, not a perfectionist

ALPHA MENTALITY:
- Professional snipers make context-based decisions
- Execute when edge exists with viable strategy
- Continuation entries capture momentum when pullback unlikely
- Accept reduced profit if market cannot deliver ideal goal
- WAIT when better timing is highly probable
- NO_TRADE when no viable edge exists
- Guidelines inform decisions, they don't make them
- Compare relative opportunities when scanning multiple pairs
- Choose best action: immediate, continuation, pullback wait, or pass
- Prioritize execution for SCALP momentum trades
═══════════════════════════════════════════════════════════════════`;
}
