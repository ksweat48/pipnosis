/**
 * OMEGA CONSENSUS ADVISORY
 *
 * CCIP-2026-02-24: DEPRECATED — OMEGA VOTE-COUNT MODEL REMOVED
 *
 * This file previously held the Directional Strength Model which aggregated
 * BUY/SELL votes and confidence scores from Omega specialists 1-5.
 *
 * Following the CCIP-2026-02-24 architectural refactor:
 * - Omega specialists 1-5 (Trend, Scalper, Confirmation, Reversal, Volatility)
 *   no longer vote on direction.
 * - Alpha receives raw market data via the MarketBriefing and reasons independently.
 * - Only Omega-8 (Orderflow) runs genuine computations not present in raw data.
 *
 * All vote-counting logic (buyScore, sellScore, netStrength, consensus quorums,
 * MIN_DIRECTIONAL_STRENGTH thresholds) has been removed.
 *
 * The AlphaConsensusOverride type is retained as it is still referenced in
 * coordinator-alpha.ts for prompt-level configuration, independent of vote counts.
 */

export type AlphaConsensusOverride = 'strict' | 'standard' | 'loose';

export const CONSENSUS_CONFIDENCE_ADJUSTMENTS = {
  strict: 5,
  standard: 0,
  loose: -5,
} as const;

export function getConfidenceAdjustment(
  override: AlphaConsensusOverride = 'standard'
): number {
  return CONSENSUS_CONFIDENCE_ADJUSTMENTS[override];
}

export function calculateAdjustedConfidence(
  baseConfidence: number,
  override: AlphaConsensusOverride = 'standard'
): number {
  const adjustment = getConfidenceAdjustment(override);
  return Math.max(0, Math.min(100, baseConfidence + adjustment));
}
