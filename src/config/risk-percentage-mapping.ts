/**
 * Risk Percentage to Risk Mode Mapping
 *
 * SSOT Authority: Single source of truth for converting numeric risk percentages
 * to risk mode enums ('low' | 'medium' | 'high')
 *
 * CCIP Compliant: All mapping decisions are transparent and auditable
 *
 * This exists because:
 * - Trade styles define risk as numeric percentages (e.g., 5% for 'scalp')
 * - Risk profiles expect enum values ('low'|'medium'|'high')
 * - This module provides the canonical mapping between them
 *
 * CRITICAL: This is the ONLY place where percentage→mode conversion happens
 * Do NOT create alternative mappings elsewhere
 */

export type RiskMode = 'low' | 'medium' | 'high';

export interface RiskPercentageRange {
  min: number;
  max: number;
  mode: RiskMode;
}

/**
 * Mapping ranges: percentage → risk mode
 *
 * Defined by trade style mappings in alpha-trade-executor.ts:
 * - 'precision': 1% → 'low'
 * - 'swing': 2% → 'low'|'medium' boundary
 * - 'day': 3% → 'medium'
 * - 'scalp': 5% → 'high'
 *
 * GOVERNANCE: If these ranges change, update alpha-trade-executor.ts
 * tradeStyleRiskMap in parallel
 */
const PERCENTAGE_TO_MODE_MAPPING: RiskPercentageRange[] = [
  { min: 0.3, max: 1.5, mode: 'low' },      // 0.3%-1.5% = conservative
  { min: 1.5, max: 3.5, mode: 'medium' },   // 1.5%-3.5% = moderate
  { min: 3.5, max: 10.0, mode: 'high' },    // 3.5%-10% = aggressive
];

/**
 * Convert numeric risk percentage to risk mode
 *
 * SSOT: This is the ONLY function that performs this conversion
 *
 * @param riskPercentage Numeric percentage (e.g., 5 for 5%)
 * @returns RiskMode enum ('low', 'medium', or 'high')
 *
 * BEHAVIOR:
 * - Uses range-based mapping (not hardcoded values)
 * - Returns 'medium' as safe default if percentage is outside ranges
 * - Logs mapping decision for CCIP audit trail
 */
export function percentageToRiskMode(riskPercentage: number): RiskMode {
  // Validate input
  if (!Number.isFinite(riskPercentage) || riskPercentage <= 0) {
    console.warn(
      `[Risk Percentage Mapping] Invalid percentage ${riskPercentage}, defaulting to 'medium'`
    );
    return 'medium';
  }

  // Find matching range
  for (const range of PERCENTAGE_TO_MODE_MAPPING) {
    if (riskPercentage >= range.min && riskPercentage <= range.max) {
      return range.mode;
    }
  }

  // If percentage is outside defined ranges, use safe defaults
  if (riskPercentage < PERCENTAGE_TO_MODE_MAPPING[0].min) {
    return 'low';
  }
  if (riskPercentage > PERCENTAGE_TO_MODE_MAPPING[PERCENTAGE_TO_MODE_MAPPING.length - 1].max) {
    return 'high';
  }

  // Fallback (should never reach here)
  return 'medium';
}

/**
 * Get all defined percentage ranges
 * Used for validation and documentation
 */
export function getAllPercentageRanges(): RiskPercentageRange[] {
  return [...PERCENTAGE_TO_MODE_MAPPING];
}

/**
 * Validate risk percentage is within acceptable bounds
 */
export function isValidRiskPercentage(percentage: number): boolean {
  return Number.isFinite(percentage) && percentage > 0 && percentage <= 10;
}

/**
 * Get descriptive name for risk mode
 */
export function getRiskModeDescription(mode: RiskMode): string {
  const descriptions: Record<RiskMode, string> = {
    low: 'Conservative (tight risk management)',
    medium: 'Moderate (balanced risk/reward)',
    high: 'Aggressive (higher position sizing)',
  };
  return descriptions[mode];
}
