/**
 * SSOT: OmegaVote Type Definition
 *
 * Single source of truth for all Omega intelligence types.
 * All Omega brains must import from this file.
 *
 * CCIP-2026-02-16: INTELLIGENCE PROVIDERS (NOT VOTERS)
 * CCIP-2026-02-24: DEPRECATED VOTE/CONFIDENCE FIELDS REMOVED
 *
 * Omegas provide structured market intelligence reports.
 * They DO NOT vote on direction -- Alpha synthesizes raw data and decides.
 *
 * Each omega returns:
 *   - reasoning: structured text summary of their domain analysis
 *   - evidence: raw metrics and calculations
 *   - keyFactors: machine-readable array of detected signals
 *
 * Alpha reads the market briefing (built from omega intelligence)
 * and makes the sole directional decision.
 */

export interface OmegaVote {
  reasoning: string;
  evidence?: string;
  keyFactors?: string[];
}

export interface OmegaVoteWithEvidence extends OmegaVote {
  evidence: string;
}

export type OmegaBrainName =
  | 'trend'
  | 'scalper'
  | 'confirmation'
  | 'reversal'
  | 'volatility'
  | 'orderflow'
  | 'sentiment'
  | 'regime'
  | 'hallucination'
  | 'meta_reasoning'
  | 'adversarial_detector'
  | 'confluence';
