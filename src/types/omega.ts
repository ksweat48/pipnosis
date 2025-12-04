/**
 * Type definitions for Omega specialist modules
 */

export interface OmegaVote {
  vote: 'BUY' | 'SELL' | 'NO_TRADE';
  confidence: number;
  reasoning: string;
}

export type Omega8LiquidityBias = 'clean' | 'stoprun_risk' | 'reaccumulation' | 'distribution';

export interface Omega8Vote extends OmegaVote {
  liquidity_bias: Omega8LiquidityBias;
  direction_support: 'buy' | 'sell' | 'neutral';
}

export interface Omega9Corrections {
  sl: number | null;
  tp: number | null;
  risk_pct: number | null;
}

export interface Omega9ValidationResult {
  pass: boolean;
  flags: string[];
  confidence_adjustment: number;
  corrections: Omega9Corrections;
  reasoning: string;
}

export interface OmegaCouncilVotes {
  trend: OmegaVote | null;
  scalper: OmegaVote | null;
  swing: OmegaVote | null;
  reversal: OmegaVote | null;
  volatility: OmegaVote | null;
  risk: OmegaVote | null;
  omega8: Omega8Vote | null;
  omega9: Omega9ValidationResult | null;
}
