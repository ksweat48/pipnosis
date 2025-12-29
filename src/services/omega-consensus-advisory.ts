import { RiskMode } from '../config/risk-levels';

/**
 * OMEGA CONSENSUS ADVISORY SYSTEM
 *
 * Provides recommended minimum Omega consensus counts based on risk mode.
 * These are advisory only - Alpha has final authority on trade execution.
 *
 * Advisory Recommendations:
 * - LOW RISK: 5/7 Omegas (71% consensus) - Very selective
 * - MEDIUM RISK: 4/7 Omegas (57% consensus) - Balanced
 * - HIGH RISK: 3/7 Omegas (43% consensus) - Aggressive
 */

export const OMEGA_CONSENSUS_ADVISORY = {
  low: 5,
  medium: 4,
  high: 3,
} as const;

/**
 * Get the recommended minimum Omega consensus count for a risk mode
 */
export function getRecommendedConsensusCount(riskMode: RiskMode | string): number {
  const mode = riskMode as RiskMode;
  return OMEGA_CONSENSUS_ADVISORY[mode] || OMEGA_CONSENSUS_ADVISORY.medium;
}

/**
 * Get the consensus percentage for a risk mode (for display purposes)
 */
export function getConsensusPercentage(riskMode: RiskMode | string): number {
  const count = getRecommendedConsensusCount(riskMode);
  return Math.round((count / 7) * 100);
}

/**
 * Get a human-readable description of the consensus requirement
 */
export function getConsensusDescription(riskMode: RiskMode | string): string {
  const count = getRecommendedConsensusCount(riskMode);
  const percentage = getConsensusPercentage(riskMode);

  const descriptions: Record<string, string> = {
    '5': `Very selective (${percentage}% Omega agreement)`,
    '4': `Balanced approach (${percentage}% Omega agreement)`,
    '3': `Aggressive (${percentage}% Omega agreement)`,
  };

  return descriptions[count.toString()] || descriptions['4'];
}

/**
 * Calculate consensus strength modifier for Alpha's analysis
 *
 * Returns a multiplier that enhances or reduces confidence based on
 * how far the actual consensus exceeds the minimum recommendation.
 *
 * Examples:
 * - 7/7 consensus always gets maximum boost (+0.10)
 * - 6/7 consensus gets strong boost (+0.05)
 * - Exactly at minimum gets no modifier (0.00)
 * - Below minimum gets negative modifier (should be filtered already)
 */
export function calculateConsensusStrengthModifier(
  actualConsensus: number,
  riskMode: RiskMode | string
): number {
  const recommendedMin = getRecommendedConsensusCount(riskMode);

  if (actualConsensus === 7) {
    return 0.10;
  }

  if (actualConsensus === 6) {
    return 0.05;
  }

  if (actualConsensus >= recommendedMin) {
    return 0.02;
  }

  const deficit = recommendedMin - actualConsensus;
  return deficit * -0.03;
}

/**
 * Check if an opportunity meets the consensus advisory for a risk mode
 */
export function meetsConsensusAdvisory(
  actualConsensus: number,
  riskMode: RiskMode | string
): boolean {
  const recommendedMin = getRecommendedConsensusCount(riskMode);
  return actualConsensus >= recommendedMin;
}
