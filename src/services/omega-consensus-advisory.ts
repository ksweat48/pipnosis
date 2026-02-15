/**
 * OMEGA CONSENSUS SYSTEM WITH NO_TRADE QUORUM ENFORCEMENT
 *
 * Fixed baseline consensus with Alpha override capability:
 * - STANDARD: 4/7 Omegas (57% consensus) - Baseline, no confidence adjustment
 * - STRICT: 5/7 Omegas (71% consensus) - Alpha chooses higher quality, +5 confidence
 * - LOOSE: 3/7 Omegas (43% consensus) - Alpha accepts more risk, -5 confidence
 *
 * Alpha can override consensus based on market conditions and conviction.
 *
 * CCIP-2026-02-15: NO_TRADE QUORUM ENFORCEMENT
 * - When >= 60% of voting Omegas return NO_TRADE, consensus is forced to NO_TRADE
 * - Minimum 3 Omega votes required for any directional consensus
 * - If fewer than 3 Omegas vote, consensus defaults to NO_TRADE (insufficient data)
 * - NO_TRADE votes are treated as dissenting signals, not abstentions
 *
 * TIER 4 FIX: Added consensus quality metric
 * - Distinguishes "5 weak agrees" from "3 strong agrees"
 * - Uses weighted confidence spread, not just vote count
 * - Quality = (avg confidence × vote count) / max possible
 */

export type AlphaConsensusOverride = 'strict' | 'standard' | 'loose';

export const NO_TRADE_QUORUM_THRESHOLD = 0.60;
export const MINIMUM_DIRECTIONAL_VOTES = 3;

export interface NoTradeQuorumResult {
  quorumTriggered: boolean;
  noTradeCount: number;
  totalVotes: number;
  noTradePercent: number;
  reason: string;
}

export interface MinimumVoteResult {
  sufficient: boolean;
  totalVotes: number;
  minimumRequired: number;
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

/**
 * CCIP-2026-02-15: NO_TRADE QUORUM CHECK
 *
 * When >= 60% of voting Omegas return NO_TRADE, the consensus MUST be NO_TRADE.
 * NO_TRADE votes are dissenting signals -- they mean "do not trade" not "I abstain."
 *
 * This prevents a single high-confidence directional Omega from overriding
 * the majority council's judgment that market conditions are unfavorable.
 *
 * Example that triggered this fix:
 *   4/6 Omegas voted NO_TRADE (67%), 2 voted BUY
 *   Old behavior: BUY at 70% confidence (Scalper's 90% dominated weighted calc)
 *   New behavior: NO_TRADE (quorum enforced, 67% >= 60% threshold)
 */
export function checkNoTradeQuorum(
  votes: Array<{ vote: string; confidence: number } | null>
): NoTradeQuorumResult {
  const validVotes = votes.filter((v): v is { vote: string; confidence: number } => v !== null);
  const totalVotes = validVotes.length;

  if (totalVotes === 0) {
    return {
      quorumTriggered: true,
      noTradeCount: 0,
      totalVotes: 0,
      noTradePercent: 0,
      reason: 'No Omega votes received - defaulting to NO_TRADE'
    };
  }

  const noTradeCount = validVotes.filter(v => v.vote === 'NO_TRADE').length;
  const noTradePercent = noTradeCount / totalVotes;

  const quorumTriggered = noTradePercent >= NO_TRADE_QUORUM_THRESHOLD;

  return {
    quorumTriggered,
    noTradeCount,
    totalVotes,
    noTradePercent,
    reason: quorumTriggered
      ? `NO_TRADE quorum reached: ${noTradeCount}/${totalVotes} Omegas (${(noTradePercent * 100).toFixed(0)}%) voted NO_TRADE (threshold: ${(NO_TRADE_QUORUM_THRESHOLD * 100).toFixed(0)}%)`
      : `NO_TRADE quorum not reached: ${noTradeCount}/${totalVotes} Omegas (${(noTradePercent * 100).toFixed(0)}%) voted NO_TRADE (threshold: ${(NO_TRADE_QUORUM_THRESHOLD * 100).toFixed(0)}%)`
  };
}

/**
 * CCIP-2026-02-15: MINIMUM DIRECTIONAL VOTE CHECK
 *
 * At least 3 Omegas must vote in the same direction (BUY or SELL)
 * for a directional consensus to be valid. This prevents thin consensus
 * where 1-2 Omegas drive a trade decision.
 *
 * If fewer than MINIMUM_DIRECTIONAL_VOTES agree on a direction,
 * the consensus defaults to NO_TRADE regardless of individual confidence.
 */
export function checkMinimumDirectionalVotes(
  votes: Array<{ vote: string; confidence: number } | null>
): MinimumVoteResult {
  const validVotes = votes.filter((v): v is { vote: string; confidence: number } => v !== null);
  const totalVotes = validVotes.length;

  if (totalVotes < MINIMUM_DIRECTIONAL_VOTES) {
    return {
      sufficient: false,
      totalVotes,
      minimumRequired: MINIMUM_DIRECTIONAL_VOTES,
      reason: `Insufficient Omega votes: ${totalVotes} received, minimum ${MINIMUM_DIRECTIONAL_VOTES} required for any directional consensus`
    };
  }

  const buyCount = validVotes.filter(v => v.vote === 'BUY').length;
  const sellCount = validVotes.filter(v => v.vote === 'SELL').length;
  const maxDirectional = Math.max(buyCount, sellCount);

  if (maxDirectional < MINIMUM_DIRECTIONAL_VOTES) {
    return {
      sufficient: false,
      totalVotes,
      minimumRequired: MINIMUM_DIRECTIONAL_VOTES,
      reason: `No direction has ${MINIMUM_DIRECTIONAL_VOTES}+ votes: BUY=${buyCount}, SELL=${sellCount}. Directional consensus cannot be formed.`
    };
  }

  return {
    sufficient: true,
    totalVotes,
    minimumRequired: MINIMUM_DIRECTIONAL_VOTES,
    reason: `Sufficient directional votes: ${maxDirectional >= buyCount ? 'BUY' : 'SELL'}=${maxDirectional}/${totalVotes} (minimum ${MINIMUM_DIRECTIONAL_VOTES} met)`
  };
}

/**
 * CCIP-2026-02-15: COMBINED CONSENSUS GATE
 *
 * Runs both the NO_TRADE quorum check and minimum directional vote check.
 * Returns whether a directional trade should proceed and the combined reasoning.
 *
 * Order of checks:
 * 1. Minimum vote count (need at least 3 Omegas voting)
 * 2. NO_TRADE quorum (if >= 60% say NO_TRADE, block the trade)
 * 3. Minimum directional agreement (need at least 3 in same direction)
 */
export function evaluateConsensusGate(
  votes: Array<{ vote: string; confidence: number } | null>
): {
  allowDirectionalTrade: boolean;
  noTradeQuorum: NoTradeQuorumResult;
  minimumVotes: MinimumVoteResult;
  blockReason: string | null;
} {
  const noTradeQuorum = checkNoTradeQuorum(votes);
  const minimumVotes = checkMinimumDirectionalVotes(votes);

  if (!minimumVotes.sufficient) {
    return {
      allowDirectionalTrade: false,
      noTradeQuorum,
      minimumVotes,
      blockReason: minimumVotes.reason
    };
  }

  if (noTradeQuorum.quorumTriggered) {
    return {
      allowDirectionalTrade: false,
      noTradeQuorum,
      minimumVotes,
      blockReason: noTradeQuorum.reason
    };
  }

  return {
    allowDirectionalTrade: true,
    noTradeQuorum,
    minimumVotes,
    blockReason: null
  };
}
