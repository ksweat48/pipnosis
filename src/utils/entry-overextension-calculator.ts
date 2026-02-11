/**
 * Entry Overextension Calculator - Shared Utility for UI and Validation
 *
 * RESPONSIBILITY:
 * Provides reusable calculation logic for entry quality assessment based on overextension.
 * Used by both Entry Monitor (UI) and Entry Overextension Validator (backend).
 *
 * SSOT PRINCIPLE:
 * - Single calculation method for optimal zone
 * - Single calculation method for overextension percentage
 * - Style-specific thresholds defined once
 * - Ensures UI and validation use identical logic
 *
 * USAGE:
 * - Entry Monitor: Real-time advisory for manual trading
 * - Trade Executor: Hard invalidation before execution
 * - Learning Systems: Retrospective entry quality analysis
 */

import { getCurrencyPipInfo } from './currencyHelpers';

/**
 * Style-specific overextension thresholds
 * Scalp requires strictest precision, Intraday allows more tolerance
 */
export const STYLE_OVEREXTENSION_THRESHOLDS = {
  SCALP: 15,           // Scalp: Maximum 15% overextension (strictest)
  MICRO_INTRADAY: 30,  // Micro: Maximum 30% overextension
  INTRADAY: 50,        // Day/Intraday: Maximum 50% overextension
  DAY: 50,             // Day: Maximum 50% overextension (same as intraday)
  SWING: 50,           // Swing: Maximum 50% overextension (most tolerant)
  PRECISION: 15        // Precision: Maximum 15% overextension (strict like scalp)
} as const;

export type TradeStyle = keyof typeof STYLE_OVEREXTENSION_THRESHOLDS;

/**
 * Entry quality state based on overextension
 */
export type EntryQualityState =
  | 'PERFECT_ENTRY'         // 0-2% overextension
  | 'WITHIN_OPTIMAL_ZONE'   // 3% to threshold
  | 'OPPORTUNITY_PASSED';   // Beyond threshold

/**
 * Optimal zone calculation result
 */
export interface OptimalZone {
  min: number;
  max: number;
  center: number;
  width: number;
  calculationMethod: 'atr' | 'percentage';
}

/**
 * Overextension calculation result
 */
export interface OverextensionResult {
  // Quality State
  qualityState: EntryQualityState;
  isValid: boolean;

  // Metrics
  currentPrice: number;
  alphaEntry: number;
  optimalZone: OptimalZone;

  // Overextension Details
  overextensionDistance: number; // Raw distance in price units
  overextensionPercentage: number; // Percentage of zone width
  overextensionType: 'within_zone' | 'bought_high' | 'sold_low';

  // Thresholds
  maxAllowedPercentage: number;
  headroomPercentage: number; // Remaining room before hitting threshold

  // Advisory
  severity: 'none' | 'minor' | 'moderate' | 'severe' | 'extreme';
  advisoryMessage: string;

  // Style Context
  style: TradeStyle;
  direction: 'long' | 'short';
}

/**
 * Calculate optimal entry zone based on ATR or percentage fallback
 *
 * PRINCIPLE: Optimal zone is where Alpha should enter for best execution.
 * Zone is ±0.3 ATR from decision entry price (ATR-based), or
 * ±0.15% for forex / ±0.25% for indices (percentage-based fallback)
 */
export function calculateOptimalZone(
  entryPrice: number,
  symbol: string,
  atrValue?: number
): OptimalZone {
  let zoneMin: number;
  let zoneMax: number;
  let calculationMethod: 'atr' | 'percentage';

  if (atrValue && atrValue > 0) {
    // ATR-based zone (preferred method)
    const atrBuffer = atrValue * 0.3;
    zoneMin = entryPrice - atrBuffer;
    zoneMax = entryPrice + atrBuffer;
    calculationMethod = 'atr';
  } else {
    // Percentage-based fallback
    const isFx = symbol.includes('USD') || symbol.includes('EUR') ||
                 symbol.includes('GBP') || symbol.includes('JPY') ||
                 symbol.includes('AUD') || symbol.includes('NZD') ||
                 symbol.includes('CAD') || symbol.includes('CHF');

    const percentBuffer = isFx ? 0.0015 : 0.0025; // 0.15% forex, 0.25% other
    zoneMin = entryPrice * (1 - percentBuffer);
    zoneMax = entryPrice * (1 + percentBuffer);
    calculationMethod = 'percentage';
  }

  const center = (zoneMin + zoneMax) / 2;
  const width = zoneMax - zoneMin;

  return {
    min: zoneMin,
    max: zoneMax,
    center,
    width,
    calculationMethod
  };
}

/**
 * Normalize style string to TradeStyle type
 */
export function normalizeStyle(styleInput: string | undefined | null): TradeStyle {
  if (!styleInput) return 'INTRADAY'; // Default fallback

  const normalized = styleInput.toUpperCase().trim();

  // Direct matches
  if (normalized === 'SCALP' || normalized === 'SCALPER') return 'SCALP';
  if (normalized === 'MICRO' || normalized === 'MICRO_INTRADAY') return 'MICRO_INTRADAY';
  if (normalized === 'INTRADAY') return 'INTRADAY';
  if (normalized === 'DAY') return 'DAY';
  if (normalized === 'SWING') return 'SWING';
  if (normalized === 'PRECISION') return 'PRECISION';

  // Fallback patterns
  if (normalized.includes('SCALP')) return 'SCALP';
  if (normalized.includes('MICRO')) return 'MICRO_INTRADAY';
  if (normalized.includes('DAY')) return 'DAY';
  if (normalized.includes('SWING')) return 'SWING';

  // Default to intraday if unknown
  return 'INTRADAY';
}

/**
 * Calculate overextension and determine entry quality
 *
 * CORE LOGIC:
 * - Calculates how far current price is from optimal zone
 * - Expresses overextension as percentage of zone width
 * - Compares to style-specific threshold
 * - Returns quality state and detailed metrics
 */
export function calculateOverextension(
  currentPrice: number,
  alphaEntry: number,
  symbol: string,
  direction: 'long' | 'short',
  style: string | TradeStyle,
  atrValue?: number
): OverextensionResult {
  // Normalize style
  const normalizedStyle = normalizeStyle(style);

  // Calculate optimal zone
  const optimalZone = calculateOptimalZone(alphaEntry, symbol, atrValue);

  // Get style-specific threshold
  const maxAllowedPercentage = STYLE_OVEREXTENSION_THRESHOLDS[normalizedStyle];

  // Calculate overextension
  let overextensionDistance = 0;
  let overextensionType: 'within_zone' | 'bought_high' | 'sold_low' = 'within_zone';

  if (direction === 'long') {
    // For longs: overextension is buying above optimal zone
    if (currentPrice > optimalZone.max) {
      overextensionDistance = currentPrice - optimalZone.max;
      overextensionType = 'bought_high';
    } else if (currentPrice < optimalZone.min) {
      // Price below zone is BETTER for longs (negative overextension)
      overextensionDistance = 0;
      overextensionType = 'within_zone';
    }
  } else {
    // For shorts: overextension is selling below optimal zone
    if (currentPrice < optimalZone.min) {
      overextensionDistance = optimalZone.min - currentPrice;
      overextensionType = 'sold_low';
    } else if (currentPrice > optimalZone.max) {
      // Price above zone is BETTER for shorts (negative overextension)
      overextensionDistance = 0;
      overextensionType = 'within_zone';
    }
  }

  // Calculate overextension as percentage of zone width
  const overextensionPercentage = optimalZone.width > 0
    ? (overextensionDistance / optimalZone.width) * 100
    : 0;

  // Calculate headroom (remaining percentage before hitting threshold)
  const headroomPercentage = Math.max(0, maxAllowedPercentage - overextensionPercentage);

  // Determine validity (hard invalidation)
  const isValid = overextensionPercentage <= maxAllowedPercentage;

  // Determine severity
  let severity: OverextensionResult['severity'] = 'none';
  if (overextensionPercentage === 0) {
    severity = 'none';
  } else if (overextensionPercentage <= 25) {
    severity = 'minor';
  } else if (overextensionPercentage <= 50) {
    severity = 'moderate';
  } else if (overextensionPercentage <= 100) {
    severity = 'severe';
  } else {
    severity = 'extreme';
  }

  // Determine quality state for UI
  let qualityState: EntryQualityState;
  if (overextensionPercentage <= 2) {
    qualityState = 'PERFECT_ENTRY';
  } else if (isValid) {
    qualityState = 'WITHIN_OPTIMAL_ZONE';
  } else {
    qualityState = 'OPPORTUNITY_PASSED';
  }

  // Generate advisory message
  const advisoryMessage = generateAdvisoryMessage(
    qualityState,
    overextensionType,
    overextensionPercentage,
    maxAllowedPercentage,
    headroomPercentage,
    direction,
    normalizedStyle
  );

  return {
    qualityState,
    isValid,
    currentPrice,
    alphaEntry,
    optimalZone,
    overextensionDistance,
    overextensionPercentage,
    overextensionType,
    maxAllowedPercentage,
    headroomPercentage,
    severity,
    advisoryMessage,
    style: normalizedStyle,
    direction
  };
}

/**
 * Generate human-readable advisory message based on quality state
 */
function generateAdvisoryMessage(
  qualityState: EntryQualityState,
  overextensionType: string,
  overextensionPct: number,
  maxAllowedPct: number,
  headroomPct: number,
  direction: 'long' | 'short',
  style: TradeStyle
): string {
  switch (qualityState) {
    case 'PERFECT_ENTRY':
      return `Perfect entry! Alpha entered at ${overextensionPct.toFixed(1)}% overextension (within optimal zone). Excellent precision.`;

    case 'WITHIN_OPTIMAL_ZONE':
      if (overextensionType === 'within_zone') {
        return `Good entry - price is within optimal zone. Can wait for pullback to improve entry quality.`;
      } else {
        const action = direction === 'long' ? 'pullback' : 'rally';
        return `Entry is ${overextensionPct.toFixed(1)}% overextended. Can wait for ${action} toward optimal zone. ${headroomPct.toFixed(0)}% threshold headroom remaining.`;
      }

    case 'OPPORTUNITY_PASSED':
      const actionVerb = direction === 'long' ? 'buying high' : 'selling low';
      return `Entry opportunity passed. Price is ${overextensionPct.toFixed(1)}% overextended (exceeds ${maxAllowedPct}% ${style} threshold). ${actionVerb.toUpperCase()} - wait for new setup.`;

    default:
      return 'Analyzing entry quality...';
  }
}

/**
 * Format overextension percentage for display
 */
export function formatOverextensionPct(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

/**
 * Get color class for overextension state
 */
export function getOverextensionColorClass(qualityState: EntryQualityState): string {
  switch (qualityState) {
    case 'PERFECT_ENTRY':
      return 'text-emerald-400';
    case 'WITHIN_OPTIMAL_ZONE':
      return 'text-amber-400';
    case 'OPPORTUNITY_PASSED':
      return 'text-red-400';
  }
}
