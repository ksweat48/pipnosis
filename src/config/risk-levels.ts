/**
 * CENTRALIZED RISK CONFIGURATION
 *
 * IMPORTANT: This file now uses the policy-driven risk system from risk-mode-policy.ts
 * Risk modes define policy envelopes (min-max ranges), not just single values.
 *
 * These risk percentages are used across:
 * - AI Goal Parser (user-facing messages)
 * - Goal Scanner (actual trade execution)
 * - Goal Session Manager (session configuration)
 */

import { getRiskPolicyForMode, type RiskMode as PolicyRiskMode } from './risk-mode-policy';

export const RISK_PERCENTAGES = {
  low: 2,      // Conservative: 2% per trade (policy allows 1-3%)
  medium: 3,   // Moderate: 3% per trade (policy allows 2-5%)
  high: 5,     // Aggressive: 5% per trade (policy allows 3-10%)
} as const;

export type RiskMode = keyof typeof RISK_PERCENTAGES;

/**
 * Get the risk percentage for a given risk mode
 * Uses the policy system's default values
 */
export function getRiskPercentage(riskMode: RiskMode | string): number {
  const normalizedMode = (riskMode?.toLowerCase() || 'medium') as 'low' | 'medium' | 'high';

  const policyMode = normalizedMode.toUpperCase() as PolicyRiskMode;
  const policy = getRiskPolicyForMode(policyMode);

  return policy.defaultPercent;
}

/**
 * Get a human-readable description of the risk mode
 */
export function getRiskModeDescription(riskMode: RiskMode | string): string {
  const descriptions: Record<RiskMode, string> = {
    low: 'conservative',
    medium: 'moderate',
    high: 'aggressive'
  };

  const mode = riskMode as RiskMode;
  return descriptions[mode] || descriptions.medium;
}

/**
 * CONFIDENCE THRESHOLDS BY RISK MODE
 *
 * Aligns minimum confidence requirements with risk tolerance:
 * - LOW: 70% - Very selective, only high-confidence setups
 * - MEDIUM: 65% - Balanced approach, solid setups
 * - HIGH: 60% - Aggressive, captures more opportunities
 *
 * These thresholds ensure risk mode consistency across the platform.
 */
export const CONFIDENCE_THRESHOLDS = {
  low: 70,
  medium: 65,
  high: 60,
} as const;

/**
 * Get the minimum confidence threshold for a given risk mode
 */
export function getMinConfidenceThreshold(riskMode: RiskMode | string): number {
  const mode = riskMode as RiskMode;
  return CONFIDENCE_THRESHOLDS[mode] || CONFIDENCE_THRESHOLDS.medium;
}

/**
 * POSITION SIZE MULTIPLIERS BY RISK MODE
 *
 * Adjusts position size based on risk tolerance:
 * - LOW: 1.2x - Larger positions (fewer, higher quality trades)
 * - MEDIUM: 1.0x - Standard position sizing
 * - HIGH: 0.8x - Smaller positions (more trades, lower confidence)
 *
 * Logic: High risk takes MORE trades (lower threshold) but SMALLER positions
 *        Low risk takes FEWER trades (higher threshold) but LARGER positions
 *
 * These multipliers are applied after the base risk calculation.
 */
export const POSITION_SIZE_MULTIPLIERS = {
  low: 1.2,
  medium: 1.0,
  high: 0.8,
} as const;

/**
 * Get the position size multiplier for a given risk mode
 */
export function getPositionSizeMultiplier(riskMode: RiskMode | string): number {
  const mode = riskMode as RiskMode;
  return POSITION_SIZE_MULTIPLIERS[mode] || POSITION_SIZE_MULTIPLIERS.medium;
}
