/**
 * CENTRALIZED RISK CONFIGURATION
 *
 * These risk percentages are used across:
 * - AI Goal Parser (user-facing messages)
 * - Goal Scanner (actual trade execution)
 * - Goal Session Manager (session configuration)
 *
 * DO NOT modify these values without updating documentation
 */

export const RISK_PERCENTAGES = {
  low: 3,      // Conservative: 3% per trade
  medium: 5,   // Moderate: 5% per trade
  high: 10,    // Aggressive: 10% per trade
} as const;

export type RiskMode = keyof typeof RISK_PERCENTAGES;

/**
 * Get the risk percentage for a given risk mode
 */
export function getRiskPercentage(riskMode: RiskMode | string): number {
  const mode = riskMode as RiskMode;
  return RISK_PERCENTAGES[mode] || RISK_PERCENTAGES.medium;
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
 * - LOW: 75% - Very selective, only high-confidence setups
 * - MEDIUM: 65% - Balanced approach, solid setups
 * - HIGH: 50% - Aggressive, captures more opportunities
 *
 * These thresholds ensure risk mode consistency across the platform.
 */
export const CONFIDENCE_THRESHOLDS = {
  low: 75,
  medium: 65,
  high: 50,
} as const;

/**
 * Get the minimum confidence threshold for a given risk mode
 */
export function getMinConfidenceThreshold(riskMode: RiskMode | string): number {
  const mode = riskMode as RiskMode;
  return CONFIDENCE_THRESHOLDS[mode] || CONFIDENCE_THRESHOLDS.medium;
}
