/**
 * Omega Brains - Deterministic Trading Analysis Layer
 *
 * All Omega brains are FULLY DETERMINISTIC - NO LLM CALLS.
 * They use OmegaSensors as SSOT and technical-math library for calculations.
 *
 * Architecture:
 * - Omega-1 Trend: EMA alignment, momentum, trend strength
 * - Omega-2 Scalper: VWAP positioning, chase risk, entry quality
 * - Omega-3 Confirmation: S/R proximity, structure, MTF alignment
 * - Omega-4 Reversal: RSI extremes, divergences, exhaustion
 * - Omega-5 Volatility: ATR regime, wick analysis, vol sensors
 * - Omega-6 Confluence: Vote aggregation, weighted consensus
 * - Omega-7 Regime: Market regime classification
 * - Omega-8 OrderFlow: Liquidity zones, sweeps, FVG
 * - Omega-9 Hallucination: Mathematical safety validation
 *
 * IMPORTANT: Risk validation moved to pre-flight gate service.
 */

export { omegaTrend } from './trend';
export type { TrendSnapshot } from './trend';

export { omegaScalper } from './scalper';
export type { ScalperSnapshot } from './scalper';

export { omegaConfirmation } from './confirmation';
export type { ConfirmationSnapshot } from './confirmation';

export { omegaReversal } from './reversal';
export type { ReversalSnapshot } from './reversal';

export { omegaVolatility } from './volatility';
export type { VolatilitySnapshot } from './volatility';

export { omegaConfluenceAggregator } from './confluence-aggregator';
export type {
  ConfluenceInput,
  ConfluenceResult,
  VoteBreakdown,
  ConflictDetail
} from './confluence-aggregator';

export { omegaRegime } from './regime';
export type {
  RegimeSnapshot,
  RegimeType,
  VolatilityRegime,
  RegimeAnalysis
} from './regime';

export { omegaOrderFlow } from './orderflow';
export type {
  OrderFlowSnapshot,
  OrderFlowPatterns,
  LiquidityBias
} from './orderflow';

export { omegaHallucination } from './hallucination';
export type {
  HallucinationInput,
  HallucinationResult,
  HallucinationCorrections
} from './hallucination';
