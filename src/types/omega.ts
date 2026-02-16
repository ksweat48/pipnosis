/**
 * Type definitions for Omega specialist modules
 */

import type { SafetyZone, SafetyEvaluation } from '../config/alpha-safety-zones';
import type { OmegaVote } from './omega-vote';
export type { OmegaVote };

export type Omega8LiquidityBias = 'clean' | 'stoprun_risk' | 'stoprun_entry' | 'reaccumulation' | 'distribution';

export interface Omega8Vote extends OmegaVote {
  liquidity_bias: Omega8LiquidityBias;
  direction_support: 'buy' | 'sell' | 'neutral';
  sweep_details?: {
    type: 'high' | 'low' | 'none';
    candles_ago: number;
    has_bos: boolean;
  };
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
  safety_zone?: SafetyZone;
  safety_evaluation?: SafetyEvaluation;
  constraintViolations?: Omega9ConstraintViolation[];
}

export interface Omega9ConstraintViolation {
  type:
    | 'STOP_BELOW_NOISE_FLOOR'
    | 'STOP_INSIDE_SPREAD'
    | 'RR_CATASTROPHIC'
    | 'MATHEMATICAL_ERROR';
  severity: 'WARNING' | 'HARD_BLOCK';
  currentValue: number;
  minimumValue?: number;
  message: string;
  suggestedActions: string[];
}

export interface OmegaCouncilVotes {
  trend: OmegaVote | null;
  scalper: OmegaVote | null;
  confirmation: OmegaVote | null;
  reversal: OmegaVote | null;
  volatility: OmegaVote | null;
  risk: OmegaVote | null;
  omega8: Omega8Vote | null;
  omega9: Omega9ValidationResult | null;
}
