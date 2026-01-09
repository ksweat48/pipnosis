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
 * - EQS thresholds by style: THIS FILE
 * - Legitimate block conditions: THIS FILE
 * - Advisory system designations: THIS FILE
 * ═══════════════════════════════════════════════════════════════════
 */

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
   * All trade styles use the same 80% threshold for execution.
   * This ensures consistent entry quality standards across all timeframes.
   */
  EQS_EXECUTION_THRESHOLD: 80,
  EQS_EXCEPTIONAL_OVERRIDE_THRESHOLD: 90,  // For near-zone overrides with exceptional quality

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

export function shouldExecute(
  tradeConfidence: number,
  entryQualityScore: number,
  style?: StyleName
): boolean {
  if (tradeConfidence < ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE) {
    return false;
  }

  return entryQualityScore >= ALPHA_IDENTITY.EQS_EXECUTION_THRESHOLD;
}

export function getEntryMode(
  tradeConfidence: number,
  entryQualityScore: number,
  style?: StyleName
): EntryMode {
  if (tradeConfidence < ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE) {
    return 'wait_confirmation';
  }

  if (entryQualityScore >= ALPHA_IDENTITY.EQS_EXECUTION_THRESHOLD) {
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

UNIFIED ENTRY QUALITY SCORE (EQS) THRESHOLD:
- Execute: EQS >= ${ALPHA_IDENTITY.EQS_EXECUTION_THRESHOLD}%
- Wait: EQS < ${ALPHA_IDENTITY.EQS_EXECUTION_THRESHOLD}%
- This threshold applies to ALL trade styles (SCALP, MICRO_INTRADAY, INTRADAY)

DECISION FRAMEWORK:
1. Trade Confidence >= ${ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE}% AND Entry Quality >= ${ALPHA_IDENTITY.EQS_EXECUTION_THRESHOLD}%: EXECUTE
2. Trade Confidence >= ${ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE}% AND Entry Quality < ${ALPHA_IDENTITY.EQS_EXECUTION_THRESHOLD}%: WAIT for better entry
3. Trade Confidence < ${ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE}%: WAIT (edge exists but timing wrong)

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
