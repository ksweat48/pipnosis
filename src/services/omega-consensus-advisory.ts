/**
 * SIMPLIFIED OMEGA CONSENSUS SYSTEM
 *
 * Fixed baseline consensus with Alpha override capability:
 * - STANDARD: 4/7 Omegas (57% consensus) - Baseline, no confidence adjustment
 * - STRICT: 5/7 Omegas (71% consensus) - Alpha chooses higher quality, +5 confidence
 * - LOOSE: 3/7 Omegas (43% consensus) - Alpha accepts more risk, -5 confidence
 *
 * Alpha can override consensus based on market conditions and conviction.
 *
 * TIER 4 FIX: Added consensus quality metric
 * - Distinguishes "5 weak agrees" from "3 strong agrees"
 * - Uses weighted confidence spread, not just vote count
 * - Quality = (avg confidence × vote count) / max possible
 */

export type AlphaConsensusOverride = 'strict' | 'standard' | 'loose';

export interface ConsensusQualityMetric {
  voteCount: number;
  averageConfidence: number;
  confidenceSpread: number; // Standard deviation of confidence values
  weightedQuality: number; // 0-100 score combining count and confidence
  quality: 'WEAK' | 'MODERATE' | 'STRONG' | 'ELITE';
  interpretation: string;
}

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

/**
 * Calculate consensus quality metric
 * TIER 4 FIX: Weighted confidence assessment
 *
 * Distinguishes between:
 * - "5 Omegas agree weakly" (count=5, avg_conf=40) = moderate quality
 * - "3 Omegas agree strongly" (count=3, avg_conf=90) = moderate-strong quality
 * - "5 Omegas agree strongly" (count=5, avg_conf=85) = elite quality
 *
 * Formula: weightedQuality = (avgConfidence × voteCount) / maxPossible
 * Where maxPossible = 100 × 7 = 700 (perfect consensus)
 */
export function calculateConsensusQuality(
  votingOmegas: Array<{ direction: string; confidence?: number }>,
  agreementDirection: 'BUY' | 'SELL'
): ConsensusQualityMetric {
  // Filter Omegas that agree with the consensus direction
  const agreeingVotes = votingOmegas.filter(
    v => v.direction?.toUpperCase() === agreementDirection
  );

  const voteCount = agreeingVotes.length;

  // Extract confidence values (default to 50 if not provided)
  const confidences = agreeingVotes.map(v => v.confidence || 50);

  // Calculate average confidence
  const averageConfidence =
    confidences.length > 0
      ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
      : 0;

  // Calculate confidence spread (standard deviation)
  const confidenceSpread =
    confidences.length > 1
      ? Math.sqrt(
          confidences.reduce((sum, c) => sum + Math.pow(c - averageConfidence, 2), 0) /
            confidences.length
        )
      : 0;

  // Calculate weighted quality score (0-100)
  // Formula: (avgConf × count) / (100 × 7) × 100
  const maxPossible = 700; // 7 Omegas × 100% confidence each
  const weightedQuality = (averageConfidence * voteCount) / maxPossible * 100;

  // Classify quality
  let quality: ConsensusQualityMetric['quality'];
  let interpretation: string;

  if (weightedQuality >= 70) {
    quality = 'ELITE';
    interpretation = `${voteCount} Omegas strongly agree (${averageConfidence.toFixed(0)}% avg confidence). Elite consensus.`;
  } else if (weightedQuality >= 50) {
    quality = 'STRONG';
    interpretation = `${voteCount} Omegas agree with strong conviction (${averageConfidence.toFixed(0)}% avg confidence). High quality consensus.`;
  } else if (weightedQuality >= 35) {
    quality = 'MODERATE';
    interpretation = `${voteCount} Omegas agree with moderate conviction (${averageConfidence.toFixed(0)}% avg confidence). Acceptable consensus.`;
  } else {
    quality = 'WEAK';
    interpretation = `${voteCount} Omegas agree weakly (${averageConfidence.toFixed(0)}% avg confidence). Low consensus quality.`;
  }

  return {
    voteCount,
    averageConfidence,
    confidenceSpread,
    weightedQuality,
    quality,
    interpretation
  };
}

/**
 * Get consensus quality adjustment to base confidence
 * TIER 4 FIX: Apply quality-based modifiers
 *
 * Elite consensus: +8 confidence
 * Strong consensus: +4 confidence
 * Moderate consensus: 0 confidence (neutral)
 * Weak consensus: -6 confidence (penalty)
 */
export function getConsensusQualityAdjustment(quality: ConsensusQualityMetric['quality']): number {
  const adjustments = {
    ELITE: 8,
    STRONG: 4,
    MODERATE: 0,
    WEAK: -6
  };

  return adjustments[quality];
}
