/**
 * Momentum Trajectory Analyzer — Pre-Decision Hunter Context Layer
 *
 * GOVERNANCE CONTRACT (CCIP-2026-0421-MTL):
 * ─────────────────────────────────────────────────────────────────
 * This service is a PURE COMPUTATION layer. It runs BEFORE Alpha
 * assembles his prompt and delivers situational awareness about
 * what momentum is doing right now.
 *
 * WHAT THIS MODULE MUST NEVER DO:
 * - Gate or block any trade (Alpha is sole authority)
 * - Label momentum as "good" or "bad" for trading
 * - Recommend entry or avoidance
 * - Score Alpha's confidence up or down
 * - Add any hard block to the execution chain
 *
 * WHAT THIS MODULE PROVIDES:
 * - Velocity: is close-to-close delta growing or shrinking?
 * - ATR expansion: is volatility range growing or compressing?
 * - Volume trajectory: is participation rising or fading?
 * - Body ratio: is directional pressure building or weakening?
 * - Sweep follow-through: is a post-sweep move resolving or stalling?
 * - Phase classification: what TYPE of hunt does this environment support?
 *
 * ALPHA IS A HUNTER. Every phase contains a hunt:
 * - building     → trend continuation and breakout hunts
 * - peak         → reversal setup scouts and momentum continuation
 * - exhausting   → reversal, mean-reversion, and fade hunts
 * - compressing  → breakout and liquidity grab anticipation
 * - post_sweep_resolving → follow-through momentum hunts
 * - neutral      → all hunt types valid, Alpha chooses
 *
 * This context sharpens Alpha's ability to identify WHAT KIND of
 * trade to look for — not WHETHER to trade.
 *
 * STYLE SUPPORT: All three styles (SCALP, MICRO_INTRADAY, INTRADAY)
 * are supported. Each style receives candles appropriate to its
 * timeframe from the coordinator. Analysis adapts automatically
 * to the candle count and volatility characteristics of each style.
 *
 * SESSION SUPPORT: Asian, London, NY, Overlap, Dead/Sydney.
 * No session is penalised. Dead sessions surface compression and
 * liquidity grab setups. Active sessions surface trend and
 * continuation setups. Alpha reads the phase and hunts accordingly.
 */

import type {
  MomentumTrajectory,
  MomentumVelocityState,
  ATRExpansionState,
  VolumeTrajectoryState,
  BodyRatioState,
  SweepFollowThroughState,
  MomentumPhase,
} from '../types/momentum-trajectory';
import type { LiquiditySweepFacts } from './liquidity-intent-analyzer';
import type { MicroRegimeResult } from './micro-regime-classifier';

interface RawCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// ─── Velocity ────────────────────────────────────────────────────────────────

/**
 * Compute close-to-close delta ratio: last 5 candles vs prior 10.
 * Returns velocityRatio and derived state.
 *
 * Uses absolute deltas so direction does not matter — we measure
 * the SIZE of moves, not their direction. Alpha decides direction.
 */
function computeVelocity(candles: RawCandle[]): {
  state: MomentumVelocityState;
  ratio: number;
} {
  if (candles.length < 15) return { state: 'steady', ratio: 1.0 };

  const last15 = candles.slice(-15);
  const deltas = last15.map((c, i) =>
    i === 0 ? 0 : Math.abs(c.close - last15[i - 1].close)
  ).slice(1); // 14 deltas from 15 candles

  const prior10 = deltas.slice(0, 9);  // first 9 deltas (older)
  const last5 = deltas.slice(9);       // last 5 deltas (newer)

  const avgPrior = prior10.reduce((s, v) => s + v, 0) / prior10.length;
  const avgLast = last5.reduce((s, v) => s + v, 0) / last5.length;

  if (avgPrior === 0) return { state: 'steady', ratio: 1.0 };

  const ratio = avgLast / avgPrior;

  let state: MomentumVelocityState;
  if (ratio >= 1.2) state = 'accelerating';
  else if (ratio <= 0.8) state = 'decelerating';
  else state = 'steady';

  return { state, ratio: Math.round(ratio * 100) / 100 };
}

// ─── ATR Expansion ───────────────────────────────────────────────────────────

/**
 * Compute per-candle ATR proxy (high - low) and compare current value
 * to the 20-candle mean. Returns state and ratio.
 *
 * We do not require a pre-computed ATR from the coordinator — we derive
 * it fresh from the candle ranges so this works across all timeframes
 * and symbol scales (EURUSD vs NAS100 vs XAUUSD).
 */
function computeATRExpansion(candles: RawCandle[]): {
  state: ATRExpansionState;
  ratio: number;
} {
  if (candles.length < 5) return { state: 'stable', ratio: 1.0 };

  const ranges = candles.map(c => c.high - c.low);
  const recent = ranges.slice(-20);
  const mean = recent.reduce((s, v) => s + v, 0) / recent.length;
  const current = ranges[ranges.length - 1];

  if (mean === 0) return { state: 'stable', ratio: 1.0 };

  const ratio = current / mean;

  let state: ATRExpansionState;
  if (ratio >= 1.15) state = 'expanding';
  else if (ratio <= 0.85) state = 'compressing';
  else state = 'stable';

  return { state, ratio: Math.round(ratio * 100) / 100 };
}

// ─── Volume Trajectory ───────────────────────────────────────────────────────

/**
 * Compare avg volume of last 5 candles vs prior 10 candles.
 * If volume data is sparse (zeros), falls back to 'stable'.
 */
function computeVolumeTrajectory(candles: RawCandle[]): {
  state: VolumeTrajectoryState;
  ratio: number;
} {
  if (candles.length < 15) return { state: 'stable', ratio: 1.0 };

  const last15 = candles.slice(-15);
  const vols = last15.map(c => c.volume ?? 0);
  const prior10 = vols.slice(0, 10);
  const last5 = vols.slice(10);

  const validPrior = prior10.filter(v => v > 0);
  const validLast = last5.filter(v => v > 0);

  // Not enough volume data — most forex tick data has no volume
  if (validPrior.length < 3 || validLast.length < 2) {
    return { state: 'stable', ratio: 1.0 };
  }

  const avgPrior = validPrior.reduce((s, v) => s + v, 0) / validPrior.length;
  const avgLast = validLast.reduce((s, v) => s + v, 0) / validLast.length;

  if (avgPrior === 0) return { state: 'stable', ratio: 1.0 };

  const ratio = avgLast / avgPrior;

  let state: VolumeTrajectoryState;
  if (ratio >= 1.15) state = 'rising';
  else if (ratio <= 0.85) state = 'falling';
  else state = 'stable';

  return { state, ratio: Math.round(ratio * 100) / 100 };
}

// ─── Body Ratio ──────────────────────────────────────────────────────────────

/**
 * Body/range ratio measures directional conviction per candle.
 * A high ratio = clean directional candles with small wicks.
 * A falling ratio = indecision building, wicks absorbing range.
 *
 * Compare avg of last 5 vs prior 5 candle body ratios.
 */
function computeBodyRatio(candles: RawCandle[]): {
  state: BodyRatioState;
  ratio: number;
} {
  if (candles.length < 10) return { state: 'neutral', ratio: 0.5 };

  const last10 = candles.slice(-10);
  const bodyRatios = last10.map(c => {
    const totalRange = c.high - c.low;
    if (totalRange === 0) return 0.5;
    return Math.abs(c.close - c.open) / totalRange;
  });

  const prior5 = bodyRatios.slice(0, 5);
  const last5 = bodyRatios.slice(5);

  const avgPrior = prior5.reduce((s, v) => s + v, 0) / prior5.length;
  const avgLast = last5.reduce((s, v) => s + v, 0) / last5.length;

  const delta = avgLast - avgPrior;

  let state: BodyRatioState;
  if (delta >= 0.08) state = 'strengthening';
  else if (delta <= -0.08) state = 'weakening';
  else state = 'neutral';

  return { state, ratio: Math.round(avgLast * 100) / 100 };
}

// ─── Sweep Follow-Through ────────────────────────────────────────────────────

/**
 * Evaluates how well a detected liquidity sweep is resolving.
 * Uses sweepFacts from the liquidity intent analyzer.
 */
function computeSweepFollowThrough(
  sweepFacts: LiquiditySweepFacts | null,
  velocityState: MomentumVelocityState
): SweepFollowThroughState {
  if (!sweepFacts || !sweepFacts.sweep_detected) return 'none';

  const { candles_since_sweep, has_bos } = sweepFacts;

  if (has_bos && candles_since_sweep <= 3 && velocityState === 'accelerating') {
    return 'strong';
  }
  if (has_bos || (candles_since_sweep <= 8 && velocityState !== 'decelerating')) {
    return 'developing';
  }
  return 'stalling';
}

// ─── Phase Derivation ────────────────────────────────────────────────────────

/**
 * Derive the overall momentum phase from individual measurements.
 *
 * EVERY PHASE HAS A HUNT:
 * - building     → continuation, trend-entry, breakout
 * - peak         → late-trend entry or reversal scouts
 * - exhausting   → reversal, fade, mean-reversion
 * - compressing  → breakout anticipation, liquidity grab setup
 * - post_sweep_resolving → sweep follow-through momentum
 * - neutral      → all hunt types valid
 *
 * Phase derivation uses priority rules — sweep states are highest priority
 * because they represent the clearest structural signal.
 */
function derivePhase(
  velocity: MomentumVelocityState,
  atr: ATRExpansionState,
  volume: VolumeTrajectoryState,
  bodyRatio: BodyRatioState,
  sweepFollowThrough: SweepFollowThroughState,
  regimeResult: MicroRegimeResult | null
): MomentumPhase {
  // P1: Post-sweep states take priority — clearest structural signal
  if (sweepFollowThrough === 'strong' || sweepFollowThrough === 'developing') {
    return 'post_sweep_resolving';
  }

  // P2: Classified micro-regime can inform — if regime service has enough data
  if (regimeResult?.type === 'classified') {
    const { regime } = regimeResult;
    if (regime === 'pre_break_compression' || regime === 'liquidity_vacuum') {
      return 'compressing';
    }
    if (regime === 'trend_acceleration') {
      return 'building';
    }
    if (regime === 'trend_exhaustion' || regime === 'mean_reversion_pocket') {
      return 'exhausting';
    }
    if (regime === 'stop_hunt_expansion' || regime === 'post_break_retest') {
      return 'post_sweep_resolving';
    }
  }

  // P3: Derive from raw measurements when no classified regime available
  const isCompressing = atr === 'compressing' && velocity === 'decelerating';
  const isBuilding =
    (velocity === 'accelerating' && atr !== 'compressing') ||
    (bodyRatio === 'strengthening' && velocity !== 'decelerating');
  const isPeak =
    velocity === 'accelerating' && atr === 'expanding' && bodyRatio === 'weakening';
  const isExhausting =
    velocity === 'decelerating' && (bodyRatio === 'weakening' || atr === 'compressing');

  if (isCompressing) return 'compressing';
  if (isPeak) return 'peak';
  if (isExhausting) return 'exhausting';
  if (isBuilding) return 'building';

  return 'neutral';
}

// ─── Hunt Type Description ───────────────────────────────────────────────────

/**
 * Returns a plain-English description of what type of hunt each phase supports.
 * This is injected into Alpha's prompt to sharpen his hunting intent.
 */
function getHuntDescription(phase: MomentumPhase): string {
  switch (phase) {
    case 'building':
      return 'Momentum building — trend continuation, breakout, and pullback-to-structure entries are most alive.';
    case 'peak':
      return 'Momentum at peak — late trend continuation valid if structure confirms; watch for reversal sequences forming.';
    case 'exhausting':
      return 'Momentum fading — reversal, mean-reversion, and fade setups are active. Look for rejection at structural highs/lows.';
    case 'compressing':
      return 'Range compressing — pre-breakout and liquidity grab setups are available. Price is coiling; the move comes from here.';
    case 'post_sweep_resolving':
      return 'Post-sweep momentum developing — follow-through in the direction of the sweep reversal is the primary hunt.';
    case 'neutral':
      return 'Mixed momentum — no dominant phase. All hunt types valid. Structure and liquidity context determine the edge.';
  }
}

// ─── Prompt Formatter ────────────────────────────────────────────────────────

/**
 * Format the MomentumTrajectory into a compact text block for Alpha's prompt.
 *
 * CRITICAL: The header explicitly states this is advisory-only.
 * Alpha's hunting authority is NEVER restricted by this context.
 */
export function formatMomentumTrajectoryForPrompt(t: MomentumTrajectory): string {
  // CCIP-2026-0512A RAW-DATA DOCTRINE: Phase label, "Hunt" narrative, and
  // state-label columns (stripped to the numeric ratios only). Alpha reads
  // the raw ratios and interprets momentum himself.
  const lines: string[] = [];

  lines.push('\nMOMENTUM RATIOS (raw measurements):');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`Velocity ratio (last5/prior10 close-delta): ${t.raw.velocityRatio.toFixed(2)}x`);
  lines.push(`ATR range ratio (current/mean20): ${t.raw.atrRatio.toFixed(2)}x`);
  lines.push(`Volume ratio (last5/prior10): ${t.raw.volumeRatio.toFixed(2)}x`);
  lines.push(`Body/range avg (last 10 candles): ${(t.raw.bodyRatio * 100).toFixed(0)}%`);
  lines.push(`Candles analysed: ${t.raw.candleCount}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return lines.join('\n');
}

// ─── Main Analyzer ───────────────────────────────────────────────────────────

/**
 * Compute the full momentum trajectory from raw candles.
 *
 * Designed to work with any style (SCALP, MICRO_INTRADAY, INTRADAY) and
 * any session. No minimum candle requirement blocks execution — the
 * computation degrades gracefully if fewer candles are available.
 *
 * @param candles Raw OHLCV candles (the same array used by microRegimeClassifier)
 * @param sweepFacts Output from liquidityIntentAnalyzer (null if no sweep)
 * @param regimeResult Output from microRegimeClassifier (null if unavailable)
 * @param tradeStyle Current trade style string
 * @param session Current session name
 */
export function computeMomentumTrajectory(
  candles: RawCandle[],
  sweepFacts: LiquiditySweepFacts | null,
  regimeResult: MicroRegimeResult | null,
  tradeStyle: string,
  session: string
): MomentumTrajectory {
  const { state: velocityState, ratio: velocityRatio } = computeVelocity(candles);
  const { state: atrExpansionState, ratio: atrRatio } = computeATRExpansion(candles);
  const { state: volumeState, ratio: volumeRatio } = computeVolumeTrajectory(candles);
  const { state: bodyRatioState, ratio: bodyRatio } = computeBodyRatio(candles);

  const sweepFollowThrough = computeSweepFollowThrough(sweepFacts, velocityState);

  const phase = derivePhase(
    velocityState,
    atrExpansionState,
    volumeState,
    bodyRatioState,
    sweepFollowThrough,
    regimeResult
  );

  return {
    velocityState,
    atrExpansionState,
    volumeState,
    bodyRatioState,
    sweepFollowThrough,
    phase,
    raw: {
      velocityRatio,
      atrRatio,
      volumeRatio,
      bodyRatio,
      candleCount: candles.length,
    },
    tradeStyle,
    session,
  };
}
