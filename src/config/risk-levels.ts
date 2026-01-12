/**
 * SIMPLIFIED RISK CONFIGURATION (SSOT)
 *
 * Single STANDARD risk policy: 1-10% per trade, 20% max total exposure.
 * Risk is now user-controlled via dollar amounts and trade styles.
 *
 * Legacy functions maintained for backward compatibility.
 */

import { getStandardRiskPolicy, type RiskMode as PolicyRiskMode } from './risk-mode-policy';
import { ALPHA_IDENTITY } from './alpha-identity';

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
 * SINGLE CONFIDENCE THRESHOLD (SSOT from alpha-identity.ts)
 *
 * All trades now use the same baseline confidence requirement: 60%
 * Alpha can adjust consensus requirements (3/7, 4/7, 5/7) for quality control.
 *
 * ARCHITECTURE: This value is sourced from ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE
 * to maintain Single Source of Truth.
 */
export const STANDARD_CONFIDENCE_THRESHOLD = ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE;

export const CONFIDENCE_THRESHOLDS = {
  low: STANDARD_CONFIDENCE_THRESHOLD,
  medium: STANDARD_CONFIDENCE_THRESHOLD,
  high: STANDARD_CONFIDENCE_THRESHOLD,
} as const;

/**
 * Get the minimum confidence threshold (returns Alpha's SSOT: 60%)
 */
export function getMinConfidenceThreshold(riskMode?: RiskMode | string): number {
  return ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE;
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
