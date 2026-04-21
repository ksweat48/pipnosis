/**
 * Momentum Trajectory — Pre-Decision Context Type
 *
 * GOVERNANCE CONTRACT:
 * This type describes raw computed measurements about the current momentum
 * trajectory of the market. It is advisory-only context for Alpha — it does
 * NOT gate, block, score, or penalise any trade decision.
 *
 * Alpha is a hunter. Every trajectory phase contains a hunt. This context
 * tells Alpha WHAT KIND of hunt is available — not whether to hunt.
 *
 * CCIP-2026-0421-MTL: Momentum Trajectory Layer — hunter context only.
 */

export type MomentumVelocityState =
  | 'accelerating'   // Close-to-close delta growing over last 5 vs prior 10 candles
  | 'steady'         // Close-to-close delta stable
  | 'decelerating';  // Close-to-close delta shrinking — move may be maturing

export type ATRExpansionState =
  | 'expanding'      // Current ATR > 20-bar mean
  | 'stable'         // Current ATR within ±10% of mean
  | 'compressing';   // Current ATR < 20-bar mean — range tightening

export type VolumeTrajectoryState =
  | 'rising'         // Last 5 candle avg volume > prior 10 candle avg volume
  | 'stable'         // Within ±15% of prior avg
  | 'falling';       // Falling — participation shrinking

export type BodyRatioState =
  | 'strengthening'  // Body / total-range ratio increasing — directional pressure building
  | 'neutral'        // Ratio stable
  | 'weakening';     // Body / total-range ratio shrinking — indecision or absorption

export type SweepFollowThroughState =
  | 'strong'         // BOS confirmed, candles_since_sweep <= 3, velocity accelerating
  | 'developing'     // BOS confirmed or velocity building, 4-8 candles since sweep
  | 'stalling'       // No BOS or decelerating after sweep, 9+ candles since
  | 'none';          // No sweep detected

/**
 * The overall momentum phase. Tells Alpha which type of hunt is active.
 *
 * IMPORTANT: Every phase has a hunt inside it. This is not a pass/fail gate.
 * It is a battlefield classification — Alpha reads the phase and selects
 * the appropriate hunting strategy for that environment.
 */
export type MomentumPhase =
  | 'building'             // Momentum growing — trend/continuation hunts alive
  | 'peak'                 // High momentum, may be near exhaustion — watch for reversal signal
  | 'exhausting'           // Momentum fading — reversal and mean-reversion hunts available
  | 'compressing'          // Low ATR + low velocity — pre-breakout compression — breakout hunts alive
  | 'post_sweep_resolving' // Fresh sweep with developing BOS — sweep follow-through hunt
  | 'neutral';             // Mixed signals — no dominant phase, all hunt types valid

export interface MomentumTrajectory {
  /** Computed from close-to-close delta trend over last 15 candles */
  velocityState: MomentumVelocityState;
  /** Computed ATR relative to 20-bar ATR mean */
  atrExpansionState: ATRExpansionState;
  /** Volume trend: last 5 vs prior 10 candle average */
  volumeState: VolumeTrajectoryState;
  /** Body/range ratio trend over last 10 candles */
  bodyRatioState: BodyRatioState;
  /** Follow-through state after a detected liquidity sweep */
  sweepFollowThrough: SweepFollowThroughState;
  /** Derived overall phase — which hunt type is dominant */
  phase: MomentumPhase;
  /** Raw computed numbers for Alpha's direct inspection */
  raw: {
    velocityRatio: number;        // last5CloseDelta / prior10CloseDelta
    atrRatio: number;             // currentATR / mean20ATR
    volumeRatio: number;          // last5VolAvg / prior10VolAvg
    bodyRatio: number;            // avg body/range ratio over last 10 candles (0-1)
    candleCount: number;          // how many candles were used in analysis
  };
  /** Which trade style this was computed for */
  tradeStyle: string;
  /** Which session was active at computation time */
  session: string;
}
