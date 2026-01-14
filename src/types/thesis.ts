/**
 * THESIS CLASSIFICATION TYPES
 * SSOT for all trade thesis definitions and detection logic
 */

export enum ThesisType {
  MOMENTUM_SCALP = 'momentum_scalp',
  LIQUIDITY_SWEEP_REVERSAL = 'liquidity_sweep_reversal',
  TREND_PULLBACK = 'trend_pullback',
  BREAKOUT_CONTINUATION = 'breakout_continuation',
  MEAN_REVERSION = 'mean_reversion',
  FAILED_MOVE = 'failed_move',
  RANGE_EXTREME = 'range_extreme'
}

export enum StyleIntent {
  SCALP = 'SCALP',
  MICRO_INTRADAY = 'MICRO_INTRADAY',
  INTRADAY = 'INTRADAY'
}

export enum ExecutionPreference {
  IMMEDIATE = 'IMMEDIATE',
  WAIT_PULLBACK = 'WAIT_PULLBACK',
  WAIT_CONFIRMATION = 'WAIT_CONFIRMATION'
}

export interface AcceptableProfitRange {
  minUSD: number;
  idealUSD: number;
}

export interface ThesisClassification {
  thesis: ThesisType;
  confidence: number;
  supporting_factors: string[];
  primary_driver: string;
}

export interface ThesisRequirements {
  momentum_strength?: number;
  candle_body_dominance?: number;
  ema_alignment?: number;
  vwap_proximity?: number;
  pullback_quality?: number;
  noise_absence?: number;
  sweep_magnitude?: number;
  break_of_structure?: boolean;
  acceptance_candles?: boolean;
  wick_rejection?: number;
  vwap_reclaim?: boolean;
  volume_confirmation?: boolean;
  htf_trend_alignment?: boolean;
  pullback_depth?: number;
  ema_support?: boolean;
  range_compression?: number;
  break_strength?: number;
  retest_quality?: number;
  volume_expansion?: boolean;
  distance_from_mean?: number;
  exhaustion_candle?: boolean;
  momentum_decay?: number;
  failed_break_confirmation?: boolean;
  fast_reclaim?: boolean;
  momentum_flip?: boolean;
  range_validity?: boolean;
  extreme_location?: number;
  rejection_candle?: boolean;
  volatility_contraction?: number;
}

export interface ThesisEQSBreakdown {
  thesis: ThesisType;
  score: number;
  readiness: 'EXECUTE_NOW' | 'WAIT';
  requirements_met: Partial<ThesisRequirements>;
  requirements_missed: Partial<ThesisRequirements>;
  critical_gaps: string[];
  improvement_suggestions: string[];
}
