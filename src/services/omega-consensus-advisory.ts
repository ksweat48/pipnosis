/**
 * SIMPLIFIED OMEGA CONSENSUS SYSTEM
 *
 * Fixed baseline consensus with Alpha override capability:
 * - STANDARD: 4/7 Omegas (57% consensus) - Baseline, no confidence adjustment
 * - STRICT: 5/7 Omegas (71% consensus) - Alpha chooses higher quality, +5 confidence
 * - LOOSE: 3/7 Omegas (43% consensus) - Alpha accepts more risk, -5 confidence
 *
 * Alpha can override consensus based on market conditions and conviction.
 */

export type AlphaConsensusOverride = 'strict' | 'standard' | 'loose';

export const CONSENSUS_REQUIREMENTS = {
  strict: 5,
  standard: 4,
  loose: 3,
} as const;

export const CONSENSUS_CONFIDENCE_ADJUSTMENTS = {
  strict: 5,
  standard: 0,
  loose: -5,
} as const;

/**
 * Get the consensus requirement based on Alpha's override choice
 */
export function getConsensusRequirement(
  override: AlphaConsensusOverride = 'standard'
): number {
  return CONSENSUS_REQUIREMENTS[override];
}

/**
 * Get the confidence adjustment for the consensus override
 */
export function getConfidenceAdjustment(
  override: AlphaConsensusOverride = 'standard'
): number {
  return CONSENSUS_CONFIDENCE_ADJUSTMENTS[override];
}

/**
 * Get the consensus percentage for display purposes
 */
export function getConsensusPercentage(override: AlphaConsensusOverride = 'standard'): number {
  const count = getConsensusRequirement(override);
  return Math.round((count / 7) * 100);
}

/**
 * Get a human-readable description of the consensus mode
 */
export function getConsensusDescription(override: AlphaConsensusOverride = 'standard'): string {
  const count = getConsensusRequirement(override);
  const percentage = getConsensusPercentage(override);
  const adjustment = getConfidenceAdjustment(override);

  const descriptions: Record<AlphaConsensusOverride, string> = {
    strict: `Strict quality (${count}/7 = ${percentage}%, +${adjustment} confidence)`,
    standard: `Standard (${count}/7 = ${percentage}%, no adjustment)`,
    loose: `Aggressive (${count}/7 = ${percentage}%, ${adjustment} confidence)`,
  };

  return descriptions[override];
}

/**
 * Calculate final confidence with consensus adjustment applied
 */
export function calculateAdjustedConfidence(
  baseConfidence: number,
  override: AlphaConsensusOverride = 'standard'
): number {
  const adjustment = getConfidenceAdjustment(override);
  return Math.max(0, Math.min(100, baseConfidence + adjustment));
}

/**
 * Check if an opportunity meets the consensus requirement
 */
export function meetsConsensusRequirement(
  actualConsensus: number,
  override: AlphaConsensusOverride = 'standard'
): boolean {
  const required = getConsensusRequirement(override);
  return actualConsensus >= required;
}

export function getRecommendedConsensusCount(riskMode?: string): number {
  return CONSENSUS_REQUIREMENTS.standard;
}

export function calculateConsensusStrengthModifier(
  actualConsensus: number,
  riskMode?: string
): number {
  if (actualConsensus === 7) return 0.1;
  if (actualConsensus === 6) return 0.05;
  if (actualConsensus >= 4) return 0.02;
  return -0.03 * (4 - actualConsensus);
}

export function meetsConsensusAdvisory(actualConsensus: number, riskMode?: string): boolean {
  return actualConsensus >= CONSENSUS_REQUIREMENTS.standard;
}
