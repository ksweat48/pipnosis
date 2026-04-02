/**
 * Type definitions for Omega specialist modules
 *
 * CCIP-2026-03-12: Omega8Vote is a PURE PATTERN SCAN result.
 * No bias, no confidence, no direction_support.
 * Alpha receives raw computed facts and reasons independently.
 */

import type { OmegaVote } from './omega-vote';
export type { OmegaVote };

/**
 * Structural liquidity classification tag for Omega-8.
 *
 * CCIP-ALPHA-AUDIT-TEXT GOVERNANCE:
 * This enum is a FACTUAL CLASSIFICATION derived from computed pattern data.
 * It is not an opinion and not a recommendation — it is a measured categorisation
 * of what the order flow patterns indicate.
 *
 * However, novel liquidity structures (e.g., "accumulation inside distribution with
 * absorption at the low") cannot be expressed by this 5-value list alone.
 * Alpha's interpretation of the liquidity context must go in the companion
 * free-text fields in the prompt layer (liquidity_sweep_read, Q_TRAPPED_FUEL, etc.)
 * where Alpha has full expressive freedom.
 */
export type Omega8LiquidityBias = 'clean' | 'stoprun_risk' | 'stoprun_entry' | 'reaccumulation' | 'distribution';

/**
 * Raw pattern scan data from Omega-8.
 * All fields are computed facts — not opinions, scores, or directional biases.
 */
export interface Omega8Patterns {
  equalHighs: number;
  equalLows: number;
  sweptHighs: number;
  sweptLows: number;
  fvgBullish: number;
  fvgBearish: number;
  volSpikeBullish: boolean;
  volSpikeBearish: boolean;
  absorptionBullish: boolean;
  absorptionBearish: boolean;
  accumulationZone: boolean;
  distributionZone: boolean;
  confluenceScore: number;
}

export interface Omega8Vote extends OmegaVote {
  /** Raw detected patterns — computed facts, not scores */
  patterns: Omega8Patterns;
  /** Machine-readable signal tags (e.g. liq_sweep_low, bull_fvg) */
  signals: string[];
  /**
   * Structural liquidity classification — FACTUAL, not directional.
   * stoprun_entry  = sweep + BOS confirmed (institutional direction revealed)
   * stoprun_risk   = recent sweep, no BOS yet (manipulation still active)
   * clean          = no recent sweeps
   * reaccumulation = accumulation zone detected
   * distribution   = distribution zone detected
   */
  liquidity_bias: Omega8LiquidityBias;
  sweep_details?: {
    type: 'high' | 'low' | 'none';
    candles_ago: number;
    has_bos: boolean;
    /** Exact wick extreme price of the sweep candle. SSOT for sweep-aware stop placement. */
    sweep_extreme_price?: number;
    /** Nearest equal high/low cluster price adjacent to sweep zone. */
    nearest_cluster_price?: number;
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
  constraintViolations?: Omega9ConstraintViolation[];
}

export interface Omega9ConstraintViolation {
  /**
   * Violation routing type — governs which recovery path the system takes.
   * CCIP-ALPHA-AUDIT-TEXT: This is a machine-routing tag.
   * The specific violation context must be expressed in `message`.
   */
  type:
    | 'STOP_BELOW_NOISE_FLOOR'
    | 'STOP_INSIDE_SPREAD'
    | 'RR_CATASTROPHIC'
    | 'MATHEMATICAL_ERROR';
  severity: 'WARNING' | 'HARD_BLOCK';
  currentValue: number;
  minimumValue?: number;
  /**
   * CCIP-ALPHA-AUDIT-TEXT: Free-text explanation of this specific violation.
   * Not just "stop below noise floor" — but what the actual numbers are,
   * what they mean in context, and what Alpha should understand from this.
   */
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
