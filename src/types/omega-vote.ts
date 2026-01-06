/**
 * SSOT: OmegaVote Type Definition
 *
 * Single source of truth for all Omega voting types.
 * All Omega brains must import from this file.
 */

export interface OmegaVote {
  vote: 'BUY' | 'SELL' | 'NO_TRADE';
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
