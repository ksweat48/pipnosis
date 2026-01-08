/**
 * SIMPLIFIED RISK CONFIGURATION (SSOT)
 *
 * Single STANDARD risk policy: 1-3% per trade, 10% max total exposure.
 * Risk is now user-controlled via dollar amounts and trade styles.
 *
 * Legacy functions maintained for backward compatibility.
 */

import { getStandardRiskPolicy, type RiskMode as PolicyRiskMode } from './risk-mode-policy';

export const STANDARD_RISK = 2;

export const RISK_PERCENTAGES = {
  low: 2,
  medium: 2,
  high: 2,
} as const;

export type RiskMode = keyof typeof RISK_PERCENTAGES;

/**
 * Get the risk percentage (now returns standard 2% for all modes)
 */
export function getRiskPercentage(riskMode?: RiskMode | string): number {
  const policy = getStandardRiskPolicy();
  return policy.defaultPercent;
}

/**
 * Get a human-readable description (legacy function for compatibility)
 */
export function getRiskModeDescription(riskMode?: RiskMode | string): string {
  return 'standard';
}

/**
 * SINGLE CONFIDENCE THRESHOLD
 *
 * All trades now use the same baseline confidence requirement.
 * Alpha can adjust consensus requirements (3/7, 4/7, 5/7) for quality control.
 */
export const STANDARD_CONFIDENCE_THRESHOLD = 65;

export const CONFIDENCE_THRESHOLDS = {
  low: STANDARD_CONFIDENCE_THRESHOLD,
  medium: STANDARD_CONFIDENCE_THRESHOLD,
  high: STANDARD_CONFIDENCE_THRESHOLD,
} as const;

/**
 * Get the minimum confidence threshold (returns standard threshold)
 */
export function getMinConfidenceThreshold(riskMode?: RiskMode | string): number {
  return STANDARD_CONFIDENCE_THRESHOLD;
}

/**
 * SINGLE POSITION SIZE MULTIPLIER
 *
 * All position sizing is now determined by user-selected dollar amounts.
 * No mode-based multipliers needed.
 */
export const STANDARD_POSITION_MULTIPLIER = 1.0;

export const POSITION_SIZE_MULTIPLIERS = {
  low: STANDARD_POSITION_MULTIPLIER,
  medium: STANDARD_POSITION_MULTIPLIER,
  high: STANDARD_POSITION_MULTIPLIER,
} as const;

/**
 * Get the position size multiplier (returns standard 1.0x)
 */
export function getPositionSizeMultiplier(riskMode?: RiskMode | string): number {
  return STANDARD_POSITION_MULTIPLIER;
}
