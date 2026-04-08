/**
 * Style Personalities Configuration
 *
 * ═══════════════════════════════════════════════════════════════════
 * TRADING STYLE BEHAVIORAL PROFILES
 * ═══════════════════════════════════════════════════════════════════
 *
 * Each style has distinct personality traits that affect:
 * - Entry timing preferences
 * - Duration expectations (style is IMMUTABLE, no upgrades)
 *
 * SSOT COMPLIANCE:
 * - Style personalities: THIS FILE
 * - Style names: src/config/trade-styles.ts
 * ═══════════════════════════════════════════════════════════════════
 */

import type { StyleDisplayName } from './trade-styles';

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
  rewards: {
    withinBandBonus: number;
    belowBandBonus: number;
    exceedsBandPenalty: number;
  };
  referenceRanges?: {
    primaryTimeframe: 'M1' | 'M5' | 'M15' | 'H1' | 'H4';
    atrTimeframe: 'M5' | 'M15' | 'H1' | 'H4';
    typicalTPPips: { low: number; mid: number; high: number };
    typicalSLPips: { low: number; mid: number; high: number };
    sessionAdjustment: boolean;
  };
}

export const STYLE_PERSONALITIES: Record<StyleDisplayName, StylePersonality> = {
  SCALP: {
    displayName: 'SCALP',
    mindset: 'Precision execution — fresh structure, defined trigger, minimal heat',
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
    rewards: {
      withinBandBonus: 5,
      belowBandBonus: 10,
      exceedsBandPenalty: 0,
    },
    referenceRanges: {
      primaryTimeframe: 'M1',
      atrTimeframe: 'M5',
      typicalTPPips: { low: 10, mid: 18, high: 25 },
      typicalSLPips: { low: 10, mid: 14, high: 18 },
      sessionAdjustment: true,
    },
  },

  MICRO_INTRADAY: {
    displayName: 'MICRO_INTRADAY',
    mindset: 'Structural trade — M15-confirmed direction, M5 entry timing, measured patience',
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
    rewards: {
      withinBandBonus: 5,
      belowBandBonus: 8,
      exceedsBandPenalty: 0,
    },
    referenceRanges: {
      primaryTimeframe: 'M5',
      atrTimeframe: 'M5',
      typicalTPPips: { low: 50, mid: 80, high: 120 },
      typicalSLPips: { low: 20, mid: 28, high: 35 },
      sessionAdjustment: true,
    },
  },

  INTRADAY: {
    displayName: 'INTRADAY',
    mindset: 'Campaign positioning — H1-validated bias, M15 structural entry, full-conviction execution across every session',
    description: 'Longer intraday trades capturing larger structural moves with decisive positioning',
    durationBand: {
      minHours: 2.0,
      maxHours: 10.0,
      targetHours: 5.0,
    },
    entryBias: {
      preferredEntryType: 'confirmation',
      aggressionLevel: 'medium',
      waitTolerance: 'medium',
    },
    rewards: {
      withinBandBonus: 5,
      belowBandBonus: 5,
      exceedsBandPenalty: 0,
    },
    referenceRanges: {
      primaryTimeframe: 'M15',
      atrTimeframe: 'M15',
      typicalTPPips: { low: 100, mid: 150, high: 200 },
      typicalSLPips: { low: 35, mid: 48, high: 60 },
      sessionAdjustment: false,
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
      reason: `Estimated duration ${expectedDurationHours.toFixed(1)}h exceeds ${currentStyle} band (${durationBand.maxHours}h). Style is IMMUTABLE — do NOT upgrade style. Select a closer in-band structural target. If no valid in-band structural target exists, output NO_TRADE.`,
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

export function getStylePromptContext(style: StyleDisplayName): string {
  const personality = STYLE_PERSONALITIES[style];

  return `STYLE: ${style}
Mindset: ${personality.mindset}
Duration Target: ${personality.durationBand.targetHours}h (${personality.durationBand.minHours}-${personality.durationBand.maxHours}h band)
Entry Bias: ${personality.entryBias.preferredEntryType} (aggression: ${personality.entryBias.aggressionLevel})
Style Immutability: NEVER upgrade or change trade style. If the initial TP estimate implies a hold beyond ${personality.durationBand.maxHours}h, first look for a closer in-band structural target. Only output NO_TRADE if no structurally valid in-band target exists at all.`;
}
