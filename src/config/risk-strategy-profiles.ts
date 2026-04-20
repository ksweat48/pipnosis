/**
 * RISK STRATEGY PROFILES
 *
 * ARCHITECTURE PRINCIPLE: Risk and Style are COMPLETELY INDEPENDENT dimensions
 *
 * RISK MODE controls MONEY EXPOSURE (Position Sizing):
 * - LOW: 0.3-0.8% risk per trade (Conservative capital protection)
 * - MEDIUM: 0.5-1.5% risk per trade (Balanced capital allocation)
 * - HIGH: 1-3% risk per trade (Aggressive capital deployment)
 *
 * TRADE STYLE controls TIME PREFERENCE (Duration, NOT Risk):
 * - SCALP: 20min - 2hrs (fast entries/exits)
 * - MICRO_INTRADAY: 1hr - 6hrs (short day trades)
 * - INTRADAY: 2hrs - 10hrs (full day trades)
 *
 * CRITICAL SEPARATION:
 * - Risk mode NEVER determines style
 * - Style NEVER determines risk amount
 * - Alpha determines style dynamically based on:
 *   1. Market conditions (volatility, session, structure)
 *   2. Setup characteristics (TP distance, time-to-fill)
 *   3. User preference (if specified)
 *   4. User preference (style is IMMUTABLE once chosen - no auto-upgrade)
 *
 * VALID COMBINATIONS (ALL SUPPORTED):
 * - "Low risk + SCALP" = Small position, fast exit
 * - "High risk + INTRADAY" = Large position, patient hold
 * - "Medium risk + MICRO_INTRADAY" = Balanced position and duration
 *
 * Risk profiles define ONLY:
 * - Position sizing parameters
 * - Stop loss width preferences (ATR multiples)
 * - Confidence thresholds
 * - Loss tolerance limits
 *
 * Alpha independently determines style using time-to-fill calculator
 * and style progression system (SCALP → MICRO → INTRADAY).
 */

import { getAssetClassRiskProfile } from './asset-class-risk-profiles';
import { getSymbolConfig } from './symbol-registry';

export interface RiskStrategyProfile {
  riskMode: 'low' | 'medium' | 'high';
  displayName: string;
  description: string;

  // Position Sizing
  riskPercentRange: { min: number; max: number }; // Actual $ risk as % of account
  baseRiskPercent: number; // Default risk percentage

  // Strategy Characteristics
  // NOTE: Trading style (scalp/micro intraday/intraday) is determined independently by Alpha
  // based on market conditions, not coupled to risk level
  entryUrgency: 'immediate' | 'confirmed' | 'patient';

  // Timeframe Preferences
  primaryTimeframes: string[]; // M5, M15, H1, H4, D1
  secondaryTimeframes: string[];
  analysisDepth: 'quick' | 'moderate' | 'deep';

  // Stop Loss Configuration
  stopLossMultiplier: { min: number; max: number }; // Multiple of ATR
  typicalStopPips: { min: number; max: number }; // Typical range for forex

  // Take Profit Strategy
  riskRewardRange: { min: number; max: number };
  targetSpeed: 'fast' | 'moderate' | 'patient';

  // Trade Duration
  expectedDuration: {
    min: number; // minutes
    max: number; // minutes
  };
  durationWarningThreshold: number; // minutes - warn if trade exceeds this

  // Omega Council Weights
  omegaWeights: {
    trend: number;
    scalper: number;
    confirmation: number;
    reversal: number;
    volatility: number;
    risk: number;
  };

  // Entry Quality Preferences
  entryTypePreference: {
    breakout: number; // 0-1 preference weight
    momentum: number;
    pullback: number;
    reversal: number;
    consolidation: number;
  };

  // Goal Achievement Strategy
  goalApproach: 'single-trade-optimized' | 'multi-trade-balanced' | 'patient-accumulation';
  pipsPerDollarTarget: number; // How many pips to target per dollar of goal
}

/**
 * AGGRESSIVE / HIGH RISK MODE
 * For traders wanting high capital exposure with active management
 *
 * Example: $50 goal on $10k account
 * - Risk: $150-200 (1.5-2%)
 * - Position: 0.75-1.25 lots
 * - Stop: 12-18 pips (tight)
 * - Strategy: Fast entries on M5-M15
 * - Style: Determined independently by Alpha based on market conditions
 */
export const AGGRESSIVE_PROFILE: RiskStrategyProfile = {
  riskMode: 'high',
  displayName: 'Aggressive',
  description: 'High capital exposure per trade (1-3% risk)',

  riskPercentRange: { min: 1.0, max: 3.0 },
  baseRiskPercent: 1.8,

  entryUrgency: 'immediate',

  primaryTimeframes: ['M5', 'M15'],
  secondaryTimeframes: ['H1'],
  analysisDepth: 'quick',

  stopLossMultiplier: { min: 0.5, max: 1.0 },
  // CCIP 2026-03-03: min adjusted from 10 to 8 to match SCALP_ENVELOPE.slPips.min = 8 (style-execution-envelopes.ts).
  // The style envelope is the geometric authority. This advisory range must not contradict it.
  typicalStopPips: { min: 8, max: 20 },

  riskRewardRange: { min: 1.5, max: 2.5 },
  targetSpeed: 'fast',

  expectedDuration: {
    min: 20,   // 20 minutes minimum
    max: 120   // 2 hours maximum (Scalp)
  },
  durationWarningThreshold: 150, // 2.5 hours

  omegaWeights: {
    trend: 0.30,
    scalper: 0.40,      // Dominant for aggressive
    confirmation: 0.10,
    reversal: 0.10,
    volatility: 0.10,
    risk: 0.00          // Advisory only
  },

  entryTypePreference: {
    breakout: 0.9,
    momentum: 0.9,
    pullback: 0.3,
    reversal: 0.2,
    consolidation: 0.4
  },

  goalApproach: 'single-trade-optimized',
  pipsPerDollarTarget: 0.3 // Higher lot size, fewer pips needed
};

/**
 * MODERATE / MEDIUM RISK MODE
 * Balanced approach between capital exposure and risk management
 *
 * Example: $50 goal on $10k account
 * - Risk: $80-120 (0.8-1.2%)
 * - Position: 0.35-0.50 lots
 * - Stop: 20-28 pips
 * - Strategy: Confirmed setups on M15-H1
 * - Style: Determined independently by Alpha based on market conditions
 */
export const MODERATE_PROFILE: RiskStrategyProfile = {
  riskMode: 'medium',
  displayName: 'Moderate',
  description: 'Balanced capital exposure per trade (0.5-1.5% risk)',

  riskPercentRange: { min: 0.5, max: 1.5 },
  baseRiskPercent: 1.0,

  entryUrgency: 'confirmed',

  primaryTimeframes: ['M15', 'H1'],
  secondaryTimeframes: ['M5', 'H4'],
  analysisDepth: 'moderate',

  stopLossMultiplier: { min: 1.0, max: 1.5 },
  // CCIP 2026-03-03: min adjusted from 20 to 15, max from 35 to 50 to match
  // MICRO_INTRADAY_ENVELOPE.slPips = {min:15, max:50} (style-execution-envelopes.ts).
  typicalStopPips: { min: 15, max: 50 },

  riskRewardRange: { min: 1.8, max: 3.0 },
  targetSpeed: 'moderate',

  expectedDuration: {
    min: 60,   // 1 hour minimum
    max: 360   // 6 hours maximum (Micro Intraday)
  },
  durationWarningThreshold: 420, // 7 hours

  omegaWeights: {
    trend: 0.30,
    scalper: 0.20,
    confirmation: 0.30,  // Balanced with trend
    reversal: 0.10,
    volatility: 0.10,
    risk: 0.00           // Advisory only
  },

  entryTypePreference: {
    breakout: 0.7,
    momentum: 0.7,
    pullback: 0.8,
    reversal: 0.5,
    consolidation: 0.6
  },

  goalApproach: 'multi-trade-balanced',
  pipsPerDollarTarget: 0.6 // Balanced lot size and pip target
};

/**
 * CONSERVATIVE / LOW RISK MODE
 * Patient approach with deep confirmations and wider stops
 *
 * Example: $50 goal on $10k account
 * - Risk: $40-60 (0.4-0.6%)
 * - Position: 0.15-0.25 lots
 * - Stop: 25-35 pips (wider)
 * - Strategy: Patient setups on H1-H4
 * - Style: Determined independently by Alpha based on market conditions
 */
export const CONSERVATIVE_PROFILE: RiskStrategyProfile = {
  riskMode: 'low',
  displayName: 'Conservative',
  description: 'Low capital exposure per trade (0.3-0.8% risk)',

  riskPercentRange: { min: 0.3, max: 0.8 },
  baseRiskPercent: 0.5,

  entryUrgency: 'patient',

  primaryTimeframes: ['H1', 'H4'],
  secondaryTimeframes: ['D1'],
  analysisDepth: 'deep',

  stopLossMultiplier: { min: 1.5, max: 2.5 },
  // CCIP 2026-03-03: max adjusted from 50 to 60 to match INTRADAY_ENVELOPE.slPips.max = 60 (style-execution-envelopes.ts).
  typicalStopPips: { min: 30, max: 60 },

  riskRewardRange: { min: 2.0, max: 4.0 },
  targetSpeed: 'patient',

  expectedDuration: {
    min: 120,  // 2 hours minimum
    max: 600   // 10 hours maximum (Full Intraday)
  },
  durationWarningThreshold: 660, // 11 hours

  omegaWeights: {
    trend: 0.30,
    scalper: 0.10,
    confirmation: 0.40,  // Dominant - requires strong confirmation
    reversal: 0.10,
    volatility: 0.10,
    risk: 0.00           // Advisory only
  },

  entryTypePreference: {
    breakout: 0.4,
    momentum: 0.5,
    pullback: 0.9,
    reversal: 0.8,
    consolidation: 0.7
  },

  goalApproach: 'patient-accumulation',
  pipsPerDollarTarget: 1.2 // Smaller lot size, more pips needed
};

/**
 * Get risk strategy profile by risk mode
 */
export function getRiskStrategyProfile(riskMode: 'low' | 'medium' | 'high'): RiskStrategyProfile {
  switch (riskMode) {
    case 'high':
      return AGGRESSIVE_PROFILE;
    case 'medium':
      return MODERATE_PROFILE;
    case 'low':
      return CONSERVATIVE_PROFILE;
    default:
      return MODERATE_PROFILE;
  }
}

/**
 * Get Omega weights for a risk mode
 */
export function getOmegaWeights(riskMode: 'low' | 'medium' | 'high'): Record<string, number> {
  const profile = getRiskStrategyProfile(riskMode);
  return profile.omegaWeights;
}

/**
 * Get expected trade duration range (in minutes)
 */
export function getExpectedDuration(riskMode: 'low' | 'medium' | 'high'): { min: number; max: number; warningThreshold: number } {
  const profile = getRiskStrategyProfile(riskMode);
  return {
    min: profile.expectedDuration.min,
    max: profile.expectedDuration.max,
    warningThreshold: profile.durationWarningThreshold
  };
}

/**
 * STYLE-DIFFERENTIATED ATR TIMEFRAME MAP (CCIP 2026-03)
 *
 * The SL calculator uses ATR to determine stop width. ATR must come from the
 * SAME timeframe the trade is managed on — not always H1.
 *
 * SCALP trades managed on M5 → use M5 ATR (short, tight — matches M5 structure)
 * MICRO_INTRADAY trades managed on M15 → use M15 ATR (medium — matches M15 structure)
 * INTRADAY trades managed on H1 → use H1 ATR (wide — matches H1 structure)
 *
 * The corresponding ATR multiplier ranges are calibrated for each timeframe's
 * typical pip range so that SL distances remain structurally appropriate.
 */
export const STYLE_ATR_TIMEFRAME_MAP: Record<'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY', {
  preferredTimeframe: string;
  atrField: 'atr20' | 'atr' | 'atr100';
  multiplierRange: { min: number; max: number };
}> = {
  SCALP: {
    preferredTimeframe: 'M5',
    atrField: 'atr20',
    multiplierRange: { min: 0.5, max: 1.0 },
  },
  MICRO_INTRADAY: {
    preferredTimeframe: 'M15',
    atrField: 'atr',
    multiplierRange: { min: 0.8, max: 1.3 },
  },
  INTRADAY: {
    preferredTimeframe: 'H1',
    atrField: 'atr100',
    multiplierRange: { min: 1.0, max: 1.5 },
  },
};

/**
 * Get stop loss width range in ATR multiples.
 * When tradeStyle is provided, returns style-calibrated multipliers instead of risk-mode defaults.
 * This ensures SL width is appropriate for the ATR timeframe of the active style.
 */
export function getStopLossMultiplierRange(
  riskMode: 'low' | 'medium' | 'high',
  tradeStyle?: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY'
): { min: number; max: number } {
  if (tradeStyle && STYLE_ATR_TIMEFRAME_MAP[tradeStyle]) {
    return STYLE_ATR_TIMEFRAME_MAP[tradeStyle].multiplierRange;
  }
  const profile = getRiskStrategyProfile(riskMode);
  return profile.stopLossMultiplier;
}

/**
 * Style-differentiated minimum pip floors (CCIP-2026-0420A).
 *
 * The risk-mode profiles define pip ranges calibrated primarily for SCALP/MICRO_INTRADAY.
 * An INTRADAY trade needs materially wider stops to survive H1-scale volatility.
 * JPY pairs (USDJPY, GBPJPY, EURJPY) require even wider floors due to their larger
 * pip size and typical intraday swing distances.
 *
 * These floors are applied as a hard minimum in getTypicalStopPipsRange() when tradeStyle
 * is provided. They prevent an 8-pip INTRADAY stop on USDJPY — a scalp-level stop that
 * normal H1 volatility (10-15 pips typical noise) will clip before the trade can develop.
 */
const STYLE_MIN_PIP_FLOORS: Record<'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY', {
  forex: number;
  jpyPair: number;
  metals: number;
  index: number;
}> = {
  SCALP:          { forex: 5,  jpyPair: 6,  metals: 10, index: 8  },
  MICRO_INTRADAY: { forex: 10, jpyPair: 12, metals: 20, index: 15 },
  INTRADAY:       { forex: 15, jpyPair: 18, metals: 30, index: 25 },
};

/**
 * Get typical stop loss pip range for any symbol (asset-class and style aware).
 * @param riskMode - Risk mode (low, medium, high)
 * @param symbol - Optional symbol to get asset-class-specific ranges
 * @param tradeStyle - Optional trade style to enforce style-differentiated minimum pip floors
 */
export function getTypicalStopPipsRange(
  riskMode: 'low' | 'medium' | 'high',
  symbol?: string,
  tradeStyle?: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY'
): { min: number; max: number } {
  const profile = getRiskStrategyProfile(riskMode);

  let base: { min: number; max: number };

  if (!symbol) {
    base = profile.typicalStopPips;
  } else {
    const assetProfile = getAssetClassRiskProfile(symbol);

    if (assetProfile.typicalStopRange.unit === 'atr') {
      const config = getSymbolConfig(symbol);
      if (config) {
        const avgATR = config.typicalSessionMovePoints * 0.5;
        base = {
          min: Math.round(avgATR * assetProfile.typicalStopRange.min),
          max: Math.round(avgATR * assetProfile.typicalStopRange.max)
        };
      } else {
        base = profile.typicalStopPips;
      }
    } else if (assetProfile.typicalStopRange.unit === 'points' || assetProfile.typicalStopRange.unit === 'pips') {
      base = {
        min: assetProfile.typicalStopRange.min,
        max: assetProfile.typicalStopRange.max
      };
    } else {
      base = profile.typicalStopPips;
    }
  }

  // CCIP-2026-0420A: Apply style-differentiated minimum pip floor.
  // An INTRADAY stop must survive H1-scale noise. A SCALP stop floor is far too tight
  // for an INTRADAY trade — this was the root cause of the 8-pip USDJPY INTRADAY SL clip.
  if (tradeStyle && STYLE_MIN_PIP_FLOORS[tradeStyle]) {
    const floors = STYLE_MIN_PIP_FLOORS[tradeStyle];
    const sym = (symbol ?? '').toUpperCase();
    const isJPY = sym.includes('JPY');
    const isMetal = sym.includes('XAU') || sym.includes('XAG') || sym.includes('GOLD');
    const isIdx = ['US30', 'NAS100', 'SPX500', 'UK100', 'DE30', 'JP225'].some(i => sym.includes(i));
    const styleFloor = isJPY ? floors.jpyPair : isMetal ? floors.metals : isIdx ? floors.index : floors.forex;
    if (base.min < styleFloor) {
      base = { min: styleFloor, max: Math.max(base.max, styleFloor + 10) };
    }
  }

  return base;
}

/**
 * Get risk-reward ratio range for trade planning
 */
export function getRiskRewardRange(riskMode: 'low' | 'medium' | 'high'): { min: number; max: number } {
  const profile = getRiskStrategyProfile(riskMode);
  return profile.riskRewardRange;
}

/**
 * Get primary timeframes for analysis
 */
export function getPrimaryTimeframes(riskMode: 'low' | 'medium' | 'high'): string[] {
  const profile = getRiskStrategyProfile(riskMode);
  return profile.primaryTimeframes;
}

/**
 * Format risk profile for Alpha/Omega LLM context
 */
export function formatRiskProfileForLLM(riskMode: 'low' | 'medium' | 'high'): string {
  const profile = getRiskStrategyProfile(riskMode);

  return `
🎯 ACTIVE RISK PROFILE: ${profile.displayName.toUpperCase()} MODE
Capital Exposure: ${profile.riskPercentRange.min}-${profile.riskPercentRange.max}% per trade
Entry Urgency: ${profile.entryUrgency} | Target Speed: ${profile.targetSpeed}
Timeframes: ${profile.primaryTimeframes.join(', ')} primary | ${profile.secondaryTimeframes.join(', ')} secondary
Stop Width: ${profile.typicalStopPips.min}-${profile.typicalStopPips.max} pips (${profile.stopLossMultiplier.min}-${profile.stopLossMultiplier.max}x ATR)
R:R Target: ${profile.riskRewardRange.min}-${profile.riskRewardRange.max}:1
Duration: ${Math.floor(profile.expectedDuration.min / 60)}h-${Math.floor(profile.expectedDuration.max / 60)}h expected
Entry Preference: ${Object.entries(profile.entryTypePreference)
  .filter(([_, weight]) => weight >= 0.7)
  .map(([type]) => type)
  .join(', ')} setups preferred

NOTE: Trading style (scalp/micro intraday/intraday) is determined independently by Alpha based on market conditions.
`.trim();
}

/**
 * Validate if a trade matches its risk profile
 */
export interface TradeProfileMatch {
  matches: boolean;
  warnings: string[];
  score: number; // 0-100
}

export function validateTradeMatchesProfile(
  riskMode: 'low' | 'medium' | 'high',
  actualRiskPercent: number,
  stopPips: number,
  riskRewardRatio: number,
  durationMinutes: number
): TradeProfileMatch {
  const profile = getRiskStrategyProfile(riskMode);
  const warnings: string[] = [];
  let score = 100;

  // Check risk percent
  if (actualRiskPercent < profile.riskPercentRange.min) {
    warnings.push(`Risk too low: ${actualRiskPercent.toFixed(2)}% < ${profile.riskPercentRange.min}% (${profile.displayName} profile)`);
    score -= 30;
  }
  if (actualRiskPercent > profile.riskPercentRange.max) {
    warnings.push(`Risk too high: ${actualRiskPercent.toFixed(2)}% > ${profile.riskPercentRange.max}% (${profile.displayName} profile)`);
    score -= 20;
  }

  // Check stop width
  if (stopPips < profile.typicalStopPips.min) {
    warnings.push(`Stop too tight: ${stopPips} pips < ${profile.typicalStopPips.min} pips (${profile.displayName} profile)`);
    score -= 15;
  }
  if (stopPips > profile.typicalStopPips.max) {
    warnings.push(`Stop too wide: ${stopPips} pips > ${profile.typicalStopPips.max} pips (${profile.displayName} profile)`);
    score -= 15;
  }

  // Check R:R ratio
  if (riskRewardRatio < profile.riskRewardRange.min) {
    warnings.push(`R:R too low: ${riskRewardRatio.toFixed(1)}:1 < ${profile.riskRewardRange.min}:1 (${profile.displayName} profile)`);
    score -= 15;
  }

  // Check duration
  if (durationMinutes > profile.durationWarningThreshold) {
    warnings.push(`Duration exceeds expected: ${Math.floor(durationMinutes / 60)}h > ${Math.floor(profile.durationWarningThreshold / 60)}h (${profile.displayName} profile)`);
    score -= 10;
  }

  return {
    matches: warnings.length === 0,
    warnings,
    score: Math.max(0, score)
  };
}
