/**
 * SSOT: OmegaVote Type Definition
 *
 * Single source of truth for all Omega voting types.
 * All Omega brains must import from this file.
 *
 * CCIP-2026-02-15: MANDATORY DIRECTIONAL VOTING
 * Omegas are ADVISORS that MUST always provide a directional lean (BUY or SELL)
 * with a confidence level from 1-100:
 *   - 1% = effectively guessing, near-zero conviction
 *   - 50% = moderate conviction
 *   - 100% = maximum conviction
 *
 * ONLY Alpha (the decision maker) can declare NO_TRADE.
 * Omegas provide directional intelligence; Alpha synthesizes and decides.
 *
 * Low-confidence directional votes (e.g., BUY at 5%) are naturally discounted
 * by the weight resolver's confidence amplification tiers.
 */

export interface OmegaVote {
  vote: 'BUY' | 'SELL';
  confidence: number;
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
