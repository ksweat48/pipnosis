/**
 * OMEGA CONSENSUS ADVISORY - DIRECTIONAL STRENGTH MODEL
 *
 * CCIP-2026-02-15: MANDATORY DIRECTIONAL VOTING ENFORCEMENT
 *
 * All Omegas now MUST vote BUY or SELL with confidence 1-100%.
 * NO_TRADE is exclusively an Alpha-level decision.
 *
 * DIRECTIONAL STRENGTH MODEL:
 * Instead of counting NO_TRADE votes and checking quorums, we now measure
 * the net directional strength of the weighted omega consensus.
 *
 * Alpha declares NO_TRADE when:
 * - Net directional strength (buyScore - sellScore or vice versa) falls below
 *   the minimum threshold for the trade style
 * - Both directions are nearly equal (deadlock)
 *
 * STYLE-AWARE THRESHOLDS (derived from math):
 *   SCALP:          15 (fast trades, lower conviction needed)
 *   MICRO_INTRADAY: 20 (moderate conviction)
 *   INTRADAY:       25 (longer holds, higher conviction)
 *
 * CONSENSUS QUALITY: Still uses weighted confidence spread analysis
 * to distinguish "5 weak agrees" from "3 strong agrees."
 */

export type AlphaConsensusOverride = 'strict' | 'standard' | 'loose';

export const MIN_DIRECTIONAL_STRENGTH: Record<string, number> = {
  SCALP: 15,
  MICRO_INTRADAY: 20,
  INTRADAY: 25,
};

export const DEFAULT_MIN_DIRECTIONAL_STRENGTH = 20;

export interface DirectionalStrengthResult {
  buyScore: number;
  sellScore: number;
  netStrength: number;
  winningDirection: 'BUY' | 'SELL';
  meetsThreshold: boolean;
  threshold: number;
  style: string;
  reason: string;
}

export interface ConsensusQualityMetric {
  voteCount: number;
  averageConfidence: number;
  confidenceSpread: number;
  weightedQuality: number;
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

export function getConsensusRequirement(
  override: AlphaConsensusOverride = 'standard'
): number {
  return CONSENSUS_REQUIREMENTS[override];
}

export function getConfidenceAdjustment(
  override: AlphaConsensusOverride = 'standard'
): number {
  return CONSENSUS_CONFIDENCE_ADJUSTMENTS[override];
}

export function getConsensusPercentage(override: AlphaConsensusOverride = 'standard'): number {
  const count = getConsensusRequirement(override);
  return Math.round((count / 7) * 100);
}

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

export function calculateAdjustedConfidence(
  baseConfidence: number,
  override: AlphaConsensusOverride = 'standard'
): number {
  const adjustment = getConfidenceAdjustment(override);
  return Math.max(0, Math.min(100, baseConfidence + adjustment));
}

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
 * CCIP-2026-02-15: DIRECTIONAL STRENGTH EVALUATION
 *
 * Replaces the old NO_TRADE quorum gate. Since all Omegas now vote directionally,
 * we measure the net strength of the winning direction.
 *
 * If the net strength (winning - losing) is below the style threshold,
 * Alpha should declare NO_TRADE due to insufficient directional conviction.
 */
export function evaluateDirectionalStrength(
  buyScore: number,
  sellScore: number,
  style: string = 'MICRO_INTRADAY'
): DirectionalStrengthResult {
  const threshold = MIN_DIRECTIONAL_STRENGTH[style] ?? DEFAULT_MIN_DIRECTIONAL_STRENGTH;
  const netStrength = Math.abs(buyScore - sellScore);
  const winningDirection: 'BUY' | 'SELL' = buyScore >= sellScore ? 'BUY' : 'SELL';
  const meetsThreshold = netStrength >= threshold;

  const reason = meetsThreshold
    ? `Directional strength ${netStrength.toFixed(1)} meets ${style} threshold ${threshold} (${winningDirection})`
    : `Directional strength ${netStrength.toFixed(1)} below ${style} threshold ${threshold} - insufficient conviction`;

  return {
    buyScore,
    sellScore,
    netStrength,
    winningDirection,
    meetsThreshold,
    threshold,
    style,
    reason,
  };
}

/**
 * Calculate consensus quality metric
 * Distinguishes between:
 * - "5 Omegas agree weakly" (count=5, avg_conf=40) = moderate quality
 * - "3 Omegas agree strongly" (count=3, avg_conf=90) = moderate-strong quality
 * - "5 Omegas agree strongly" (count=5, avg_conf=85) = elite quality
 */
export function calculateConsensusQuality(
  votingOmegas: Array<{ direction: string; confidence?: number }>,
  agreementDirection: 'BUY' | 'SELL'
): ConsensusQualityMetric {
  const agreeingVotes = votingOmegas.filter(
    v => v.direction?.toUpperCase() === agreementDirection
  );

  const voteCount = agreeingVotes.length;

  const confidences = agreeingVotes.map(v => v.confidence || 50);

  const averageConfidence =
    confidences.length > 0
      ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
      : 0;

  const confidenceSpread =
    confidences.length > 1
      ? Math.sqrt(
          confidences.reduce((sum, c) => sum + Math.pow(c - averageConfidence, 2), 0) /
            confidences.length
        )
      : 0;

  const maxPossible = 700;
  const weightedQuality = (averageConfidence * voteCount) / maxPossible * 100;

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

export function getConsensusQualityAdjustment(quality: ConsensusQualityMetric['quality']): number {
  const adjustments = {
    ELITE: 8,
    STRONG: 4,
    MODERATE: 0,
    WEAK: -6
  };

  return adjustments[quality];
}
