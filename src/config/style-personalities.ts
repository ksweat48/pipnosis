/**
 * Style Personalities Configuration
 *
 * ═══════════════════════════════════════════════════════════════════
 * TRADING STYLE BEHAVIORAL PROFILES
 * ═══════════════════════════════════════════════════════════════════
 *
 * Each style has distinct personality traits that affect:
 * - Entry timing preferences
 * - EQS threshold interpretation
 * - Duration expectations
 * - Duration expectations (style is IMMUTABLE, no upgrades)
 *
 * SSOT COMPLIANCE:
 * - Style personalities: THIS FILE
 * - EQS thresholds: src/config/alpha-identity.ts
 * - Style names: src/config/trade-styles.ts
 * ═══════════════════════════════════════════════════════════════════
 */

import type { StyleDisplayName } from './trade-styles';
import { ALPHA_IDENTITY } from './alpha-identity';

export interface StylePersonality {
  displayName: StyleDisplayName;
  mindset: string;
  description: string;
  durationBand: {
    minHours: number;
    maxHours: number;
    targetHours: number;
  };
  entryBias: {
    preferredEntryType: 'immediate' | 'pullback' | 'confirmation';
    aggressionLevel: 'high' | 'medium' | 'low';
    waitTolerance: 'low' | 'medium' | 'high';
  };
  eqsInterpretation: {
    executeThreshold: number;
    waitPullbackMin: number;
    waitPullbackMax: number;
    description: string;
  };
  rewards: {
    withinBandBonus: number;
    belowBandBonus: number;
    exceedsBandPenalty: number;
  };
  referenceRanges?: {
    primaryTimeframe: 'M5' | 'M15' | 'H1' | 'H4';
    atrTimeframe: 'M5' | 'M15' | 'H1' | 'H4';
    typicalTPPips: { low: number; mid: number; high: number };
    typicalSLPips: { low: number; mid: number; high: number };
    sessionAdjustment: boolean;
  };
  eqsAdjustments?: {
    tpWithinRange: number;
    tpExceedsTypical: number;
    slWithinRange: number;
    slExceedsTypical: number;
    slTooTight: number;
  };
}

export const STYLE_PERSONALITIES: Record<StyleDisplayName, StylePersonality> = {
  SCALP: {
    displayName: 'SCALP',
    mindset: 'Precision sniper - speed and minimal heat',
    description: 'Fast trades targeting quick profits with tight risk management',
    durationBand: {
      minHours: 0.33,
      maxHours: 2.0,
      targetHours: 1.0,
    },
    entryBias: {
      preferredEntryType: 'immediate',
      aggressionLevel: 'high',
      waitTolerance: 'low',
    },
    eqsInterpretation: {
      executeThreshold: ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.SCALP.EXECUTE_IMMEDIATELY,
      waitPullbackMin: ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.SCALP.WAIT_PULLBACK.min,
      waitPullbackMax: ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.SCALP.WAIT_PULLBACK.max,
      description: 'Strong acceptance required, immediate execution preferred',
    },
    rewards: {
      withinBandBonus: 5,
      belowBandBonus: 10,
      exceedsBandPenalty: 0,
    },
    referenceRanges: {
      primaryTimeframe: 'M5',
      atrTimeframe: 'M5',
      typicalTPPips: { low: 20, mid: 35, high: 50 },
      typicalSLPips: { low: 10, mid: 14, high: 18 },
      sessionAdjustment: true,
    },
    eqsAdjustments: {
      tpWithinRange: 3,
      tpExceedsTypical: -5,
      slWithinRange: 2,
      slExceedsTypical: -3,
      slTooTight: -4,
    },
  },

  MICRO_INTRADAY: {
    displayName: 'MICRO_INTRADAY',
    mindset: 'Tactical structure trader - balance of speed and patience',
    description: 'Medium-term trades exploiting structural moves with measured risk',
    durationBand: {
      minHours: 1.0,
      maxHours: 6.0,
      targetHours: 3.0,
    },
    entryBias: {
      preferredEntryType: 'pullback',
      aggressionLevel: 'medium',
      waitTolerance: 'medium',
    },
    eqsInterpretation: {
      executeThreshold: ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.MICRO_INTRADAY.EXECUTE_IMMEDIATELY,
      waitPullbackMin: ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.MICRO_INTRADAY.WAIT_PULLBACK.min,
      waitPullbackMax: ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.MICRO_INTRADAY.WAIT_PULLBACK.max,
      description: 'Pullback quality weighted higher, liquidity reaction important',
    },
    rewards: {
      withinBandBonus: 5,
      belowBandBonus: 8,
      exceedsBandPenalty: 0,
    },
    referenceRanges: {
      primaryTimeframe: 'M15',
      atrTimeframe: 'M15',
      typicalTPPips: { low: 50, mid: 80, high: 120 },
      typicalSLPips: { low: 20, mid: 28, high: 35 },
      sessionAdjustment: true,
    },
    eqsAdjustments: {
      tpWithinRange: 3,
      tpExceedsTypical: -4,
      slWithinRange: 2,
      slExceedsTypical: -3,
      slTooTight: -3,
    },
  },

  INTRADAY: {
    displayName: 'INTRADAY',
    mindset: 'Campaign trader - patience and position building',
    description: 'Longer intraday trades capturing larger moves with strategic positioning',
    durationBand: {
      minHours: 2.0,
      maxHours: 10.0,
      targetHours: 5.0,
    },
    entryBias: {
      preferredEntryType: 'confirmation',
      aggressionLevel: 'low',
      waitTolerance: 'high',
    },
    eqsInterpretation: {
      executeThreshold: ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.INTRADAY.EXECUTE_IMMEDIATELY,
      waitPullbackMin: ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.INTRADAY.WAIT_PULLBACK.min,
      waitPullbackMax: ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.INTRADAY.WAIT_PULLBACK.max,
      description: 'Structure/location over speed, wider pullbacks acceptable',
    },
    rewards: {
      withinBandBonus: 5,
      belowBandBonus: 5,
      exceedsBandPenalty: -5,
    },
    referenceRanges: {
      primaryTimeframe: 'H1',
      atrTimeframe: 'H1',
      typicalTPPips: { low: 100, mid: 150, high: 200 },
      typicalSLPips: { low: 35, mid: 48, high: 60 },
      sessionAdjustment: false,
    },
    eqsAdjustments: {
      tpWithinRange: 2,
      tpExceedsTypical: -3,
      slWithinRange: 2,
      slExceedsTypical: -2,
      slTooTight: -2,
    },
  },
} as const;

export function getStylePersonality(style: StyleDisplayName): StylePersonality {
  return STYLE_PERSONALITIES[style];
}

export function exceedsStyleDurationBand(
  currentStyle: StyleDisplayName,
  expectedDurationHours: number
): { exceeds: boolean; reason: string } {
  const personality = STYLE_PERSONALITIES[currentStyle];
  const { durationBand } = personality;

  if (expectedDurationHours > durationBand.maxHours) {
    return {
      exceeds: true,
      reason: `Duration ${expectedDurationHours.toFixed(1)}h exceeds ${currentStyle} band (${durationBand.maxHours}h). Style is IMMUTABLE - return NO_TRADE.`,
    };
  }

  return {
    exceeds: false,
    reason: `Duration ${expectedDurationHours.toFixed(1)}h within ${currentStyle} band`,
  };
}

export function calculateStyleReward(
  style: StyleDisplayName,
  actualDurationHours: number
): { reward: number; reason: string } {
  const personality = STYLE_PERSONALITIES[style];
  const { durationBand, rewards } = personality;

  if (actualDurationHours < durationBand.minHours) {
    return {
      reward: rewards.belowBandBonus,
      reason: `Resolved in ${actualDurationHours.toFixed(1)}h (below ${durationBand.minHours}h min) - bonus applied`,
    };
  }

  if (actualDurationHours <= durationBand.maxHours) {
    return {
      reward: rewards.withinBandBonus,
      reason: `Resolved in ${actualDurationHours.toFixed(1)}h (within ${durationBand.minHours}-${durationBand.maxHours}h band) - bonus applied`,
    };
  }

  return {
    reward: rewards.exceedsBandPenalty,
    reason: `Resolved in ${actualDurationHours.toFixed(1)}h (exceeds ${durationBand.maxHours}h max) - penalty applied`,
  };
}

export function getRecommendedEntryMode(
  style: StyleDisplayName,
  eqs: number
): 'immediate' | 'wait_pullback' | 'wait_confirmation' {
  const personality = STYLE_PERSONALITIES[style];
  const { eqsInterpretation } = personality;

  if (eqs >= eqsInterpretation.executeThreshold) {
    return 'immediate';
  }

  if (eqs >= eqsInterpretation.waitPullbackMin) {
    return 'wait_pullback';
  }

  return 'wait_confirmation';
}

export function getStylePromptContext(style: StyleDisplayName): string {
  const personality = STYLE_PERSONALITIES[style];

  return `STYLE: ${style}
Mindset: ${personality.mindset}
Duration Target: ${personality.durationBand.targetHours}h (${personality.durationBand.minHours}-${personality.durationBand.maxHours}h band)
Entry Bias: ${personality.entryBias.preferredEntryType} (aggression: ${personality.entryBias.aggressionLevel})
EQS Execute: >= ${personality.eqsInterpretation.executeThreshold}
EQS Wait Pullback: ${personality.eqsInterpretation.waitPullbackMin}-${personality.eqsInterpretation.waitPullbackMax}
Duration Enforcement: If setup exceeds ${personality.durationBand.maxHours}h, return NO_TRADE (do NOT upgrade style)`;
}
