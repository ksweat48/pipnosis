/**
 * Alpha Hunt Readiness Scanner — Scheduled Netlify Function
 *
 * GOVERNANCE CONTRACT (CCIP-2026-0510J — Armed Precision Upgrade):
 * ──────────────────────────────────────────────────────────────────
 * Binary readiness signal. One question per symbol:
 *   "Has a high-precision, confirmed trigger just printed that warrants a scan RIGHT NOW?"
 *
 * States:
 *   armed      — confirmed trigger fired, regime match, adversarial clear, PC1-PC7 all met
 *   not_ready  — anything less
 *
 * This scanner is a PARALLEL ADVISORY channel. It does NOT gate Alpha's pre-filter,
 * it does NOT suggest or influence Alpha's SL/TP, and its internal arming metrics
 * (invalidation_price, invalidation_distance_atr, reward_room_atr) are stored for
 * diagnostics only — never injected into Alpha's prompt or shown in user UI.
 *
 * Alpha retains full sovereignty. Alpha can scan at any time and find golden
 * nuggets on his own. This monitor only tells the user "something confirmed just
 * printed — now is an optimal moment to scan Alpha".
 *
 * Seven Trigger Archetypes (all must be CONFIRMED — no 'developing' tier):
 *   1. BOS_CONFIRMED         — swing high/low broken AND closed beyond
 *   2. SWEEP_RECLAIM         — wick swept extreme, body closed back inside
 *   3. MANIPULATION_CANDLE   — large-wick reversal candle close confirms rejection
 *   4. MULTI_TOUCH_REJECTION — 3rd touch of same level rejected
 *   5. COMPRESSION_BREAKOUT  — multi-candle compression resolved with expansion close
 *   6. FVG_OB_REACTION       — price reacts off fair-value-gap / order-block boundary
 *   7. MEAN_REVERSION        — extreme RSI + rejection candle at range boundary
 *
 * Seven Preconditions:
 *   PC1 — Market phase readable
 *   PC2 — Phase-native setup material exists
 *   PC3 — Structural room ≥ style ATR threshold
 *   PC4 — Confirmed trigger archetype fired
 *   PC5 — Quality score ≥ MIN_QUALITY_SCORE (70)
 *   PC6 — Invalidation distance ≤ 1.0 ATR (tight-stop geometry — INTERNAL)
 *   PC7 — Reward room ≥ 2.0 × invalidation distance (R:R runway — INTERNAL)
 *
 * PC6 and PC7 use structural invalidation measurements. The numbers stay in
 * Supabase for post-hoc analytics. Alpha chooses his own SL in every trade.
 *
 * Schedule: every 3 minutes.
 * Single style: MICRO_INTRADAY (CCIP-2026-0507C single-style mandate).
 */

import type { Handler } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase-admin';

const supabase = getSupabaseAdmin();

const SYMBOLS = [
  'XAUUSD', 'US30', 'NAS100',
  'EURUSD', 'GBPUSD', 'USDJPY',
  'BTCUSD', 'ETHUSD',
];

type TradingStyle = 'MICRO_INTRADAY';
type HuntState = 'armed' | 'not_ready';
type PhaseLabel = 'ACCUMULATION' | 'EXPANSION' | 'DISTRIBUTION' | 'RETRACEMENT' | 'REVERSAL' | 'UNCLEAR';
type DirectionLean = 'BUY' | 'SELL' | 'NEUTRAL';
type TriggerArchetype =
  | 'BOS_CONFIRMED'
  | 'SWEEP_RECLAIM'
  | 'MANIPULATION_CANDLE'
  | 'MULTI_TOUCH_REJECTION'
  | 'COMPRESSION_BREAKOUT'
  | 'FVG_OB_REACTION'
  | 'MEAN_REVERSION';

const PRIMARY_TF = 'M15';
const CONTROL_TF = 'H1';
const EXPIRE_MINUTES = 5;
const MIN_ATR_ROOM = 1.2;
const MAX_INVALIDATION_ATR = 1.0;
const MIN_REWARD_RATIO = 2.0;
const MIN_QUALITY_SCORE = 70;
const MULTI_TOUCH_N = 3;

const PIP_SIZE: Record<string, number> = {
  EURUSD: 0.0001, GBPUSD: 0.0001, USDJPY: 0.01,
  XAUUSD: 0.1,   US30: 1.0,      NAS100: 1.0,
  BTCUSD: 1.0,   ETHUSD: 0.1,
};

interface CandleRow {
  open: number;
  high: number;
  low: number;
  close: number;
  close_time: string;
}

interface TriggerResult {
  archetype: TriggerArchetype;
  direction: DirectionLean;
  invalidationPrice: number;
  evidence: string;
  sensorEvidence: Record<string, unknown>;
}

interface HuntAssessment {
  symbol: string;
  style: TradingStyle;
  session: string;
  hunt_state: HuntState;
  phase_detected: PhaseLabel;
  phase_evidence: string;
  preconditions_met: string[];
  structural_room_pips: number;
  structural_room_direction: DirectionLean;
  trigger_state: 'confirmed' | 'none';
  trigger_evidence: string;
  trigger_archetype: TriggerArchetype | null;
  direction_lean: DirectionLean;
  quality_score: number;
  hunt_summary: string;
  last_scanned_at: string;
  expires_at: string;
  armed_at: string | null;
  invalidation_price: number | null;
  invalidation_distance_atr: number | null;
  reward_room_atr: number | null;
  adversarial_clear: boolean;
  regime_match: boolean;
  sensor_evidence: Record<string, unknown>;
  session_minutes_remaining: number | null;
}

// ─── Math helpers ────────────────────────────────────────────────────────────

function calcEMA(closes: number[], period: number): number[] {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(ema);
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

function calcATR(candles: CandleRow[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - 100 / (1 + rs);
}

function toPips(d: number, symbol: string): number {
  return d / (PIP_SIZE[symbol] ?? 0.0001);
}

// ─── Phase Detection (PC1) ───────────────────────────────────────────────────

function detectPhase(candles: CandleRow[]): {
  phase: PhaseLabel;
  evidence: string;
  directionLean: DirectionLean;
  atr: number;
} {
  if (candles.length < 20) {
    return { phase: 'UNCLEAR', evidence: 'Insufficient history', directionLean: 'NEUTRAL', atr: 0 };
  }

  const closes = candles.map(c => c.close);
  const rsi = calcRSI(closes, 14);
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const atr = calcATR(candles, 14);
  const last = candles[candles.length - 1];
  const e20 = ema20[ema20.length - 1] ?? last.close;
  const e50 = ema50.length > 0 ? ema50[ema50.length - 1] : last.close;

  const last5 = closes.slice(-5);
  let up = 0, down = 0;
  for (let i = 1; i < last5.length; i++) {
    if (last5[i] > last5[i - 1]) up++;
    else if (last5[i] < last5[i - 1]) down++;
  }
  const trendingUp = up >= 3;
  const trendingDown = down >= 3;

  const last5R = candles.slice(-5).map(c => c.high - c.low);
  const prior10R = candles.slice(-15, -5).map(c => c.high - c.low);
  const avgLast = last5R.reduce((s, v) => s + v, 0) / last5R.length;
  const avgPrior = prior10R.length > 0 ? prior10R.reduce((s, v) => s + v, 0) / prior10R.length : avgLast;
  const rangeRatio = avgPrior > 0 ? avgLast / avgPrior : 1;
  const rangeExpanding = (last.high - last.low) > atr * 1.3;

  if ((trendingUp || trendingDown) && rangeExpanding) {
    const dir: DirectionLean = trendingUp ? 'BUY' : 'SELL';
    return {
      phase: 'EXPANSION',
      evidence: `${Math.max(up, down)}/4 directional closes with range expansion`,
      directionLean: dir,
      atr,
    };
  }

  const aboveE20 = last.close > e20;
  const aboveE50 = last.close > e50;
  if (trendingUp && !aboveE20 && aboveE50 && rsi > 40 && rsi < 65) {
    return { phase: 'RETRACEMENT', evidence: 'Pullback to EMA20 in uptrend', directionLean: 'BUY', atr };
  }
  if (trendingDown && aboveE20 && !aboveE50 && rsi > 35 && rsi < 60) {
    return { phase: 'RETRACEMENT', evidence: 'Pullback to EMA20 in downtrend', directionLean: 'SELL', atr };
  }
  if (aboveE20 && aboveE50 && rsi > 68 && !rangeExpanding) {
    return { phase: 'DISTRIBUTION', evidence: `RSI ${rsi.toFixed(0)} at highs, compression`, directionLean: 'SELL', atr };
  }
  if (!aboveE20 && !aboveE50 && rsi < 32 && !rangeExpanding) {
    return { phase: 'DISTRIBUTION', evidence: `RSI ${rsi.toFixed(0)} at lows, compression`, directionLean: 'BUY', atr };
  }
  if (rangeRatio < 0.75) {
    const lookback = candles.slice(-22, -2);
    const hi = Math.max(...lookback.map(c => c.high));
    const lo = Math.min(...lookback.map(c => c.low));
    const span = hi - lo;
    const pos = span > 0 ? (last.close - lo) / span : 0.5;
    const dir: DirectionLean = pos < 0.3 ? 'BUY' : pos > 0.7 ? 'SELL' : 'NEUTRAL';
    return {
      phase: 'ACCUMULATION',
      evidence: `Range ${(rangeRatio * 100).toFixed(0)}% of baseline, pos ${(pos * 100).toFixed(0)}%`,
      directionLean: dir,
      atr,
    };
  }
  if (trendingUp) return { phase: 'EXPANSION', evidence: 'Slow bullish expansion', directionLean: 'BUY', atr };
  if (trendingDown) return { phase: 'EXPANSION', evidence: 'Slow bearish expansion', directionLean: 'SELL', atr };

  return { phase: 'UNCLEAR', evidence: 'No dominant phase', directionLean: 'NEUTRAL', atr };
}

// ─── Structural Room (PC3) ───────────────────────────────────────────────────

function measureStructuralRoom(
  primary: CandleRow[],
  control: CandleRow[],
  symbol: string,
  dir: DirectionLean,
  atr: number,
): { pips: number; roomInATR: number; direction: DirectionLean; targetPrice: number } {
  const last = primary[primary.length - 1];
  const all = [...control, ...primary].slice(-40);
  const lookback = all.slice(-30, -3);
  if (lookback.length === 0) return { pips: 0, roomInATR: 0, direction: 'NEUTRAL', targetPrice: last.close };

  const hi = Math.max(...lookback.map(c => c.high));
  const lo = Math.min(...lookback.map(c => c.low));
  const up = Math.max(hi - last.close, 0);
  const dn = Math.max(last.close - lo, 0);
  const safeATR = atr > 0 ? atr : 1;

  if (dir === 'BUY') return { pips: toPips(up, symbol), roomInATR: up / safeATR, direction: 'BUY', targetPrice: hi };
  if (dir === 'SELL') return { pips: toPips(dn, symbol), roomInATR: dn / safeATR, direction: 'SELL', targetPrice: lo };
  if (up > dn) return { pips: toPips(up, symbol), roomInATR: up / safeATR, direction: 'BUY', targetPrice: hi };
  if (dn > up) return { pips: toPips(dn, symbol), roomInATR: dn / safeATR, direction: 'SELL', targetPrice: lo };
  return { pips: toPips(Math.max(up, dn), symbol), roomInATR: Math.max(up, dn) / safeATR, direction: 'NEUTRAL', targetPrice: last.close };
}

// ─── Confirmed Trigger Detection (PC4) ───────────────────────────────────────
// Returns the highest-priority CONFIRMED trigger or null. No developing tier.

function detectConfirmedTrigger(
  candles: CandleRow[],
  phase: PhaseLabel,
  atr: number,
): TriggerResult | null {
  if (candles.length < 20 || atr <= 0) return null;

  const closes = candles.map(c => c.close);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const lookback = candles.slice(-20, -3);
  const recentHigh = Math.max(...lookback.map(c => c.high));
  const recentLow = Math.min(...lookback.map(c => c.low));

  // ── 1. BOS_CONFIRMED (expansion-family phases) ─────────────────────────────
  const bosFamily = phase === 'EXPANSION' || phase === 'RETRACEMENT' || phase === 'REVERSAL';
  if (bosFamily) {
    const bosUp = last.close > recentHigh && prev.close <= recentHigh && (last.close - recentHigh) > atr * 0.1;
    const bosDown = last.close < recentLow && prev.close >= recentLow && (recentLow - last.close) > atr * 0.1;
    if (bosUp) {
      return {
        archetype: 'BOS_CONFIRMED',
        direction: 'BUY',
        invalidationPrice: recentHigh - atr * 0.3,
        evidence: `BOS up: close ${last.close.toFixed(5)} cleared swing high ${recentHigh.toFixed(5)}`,
        sensorEvidence: { swing_high: recentHigh, breakout_distance_atr: (last.close - recentHigh) / atr },
      };
    }
    if (bosDown) {
      return {
        archetype: 'BOS_CONFIRMED',
        direction: 'SELL',
        invalidationPrice: recentLow + atr * 0.3,
        evidence: `BOS down: close ${last.close.toFixed(5)} broke swing low ${recentLow.toFixed(5)}`,
        sensorEvidence: { swing_low: recentLow, breakout_distance_atr: (recentLow - last.close) / atr },
      };
    }
  }

  // ── 2. SWEEP_RECLAIM (any phase — strong stop-hunt signal) ─────────────────
  const sweptHigh = prev.high > recentHigh && prev.close < recentHigh && last.close < prev.high;
  const sweptLow = prev.low < recentLow && prev.close > recentLow && last.close > prev.low;
  if (sweptLow) {
    return {
      archetype: 'SWEEP_RECLAIM',
      direction: 'BUY',
      invalidationPrice: prev.low - atr * 0.15,
      evidence: `Sweep of ${recentLow.toFixed(5)} with reclaim — stop hunt completed`,
      sensorEvidence: { swept_level: recentLow, wick_depth_atr: (recentLow - prev.low) / atr },
    };
  }
  if (sweptHigh) {
    return {
      archetype: 'SWEEP_RECLAIM',
      direction: 'SELL',
      invalidationPrice: prev.high + atr * 0.15,
      evidence: `Sweep of ${recentHigh.toFixed(5)} with reclaim — stop hunt completed`,
      sensorEvidence: { swept_level: recentHigh, wick_depth_atr: (prev.high - recentHigh) / atr },
    };
  }

  // ── 3. MANIPULATION_CANDLE (large wick reversal) ───────────────────────────
  const body = Math.abs(last.close - last.open);
  const upperWick = last.high - Math.max(last.close, last.open);
  const lowerWick = Math.min(last.close, last.open) - last.low;
  const totalRange = last.high - last.low;
  if (totalRange > atr * 0.8 && body > 0) {
    const bullishManip =
      lowerWick > body * 2 && lowerWick > totalRange * 0.6 && last.close > last.open;
    const bearishManip =
      upperWick > body * 2 && upperWick > totalRange * 0.6 && last.close < last.open;
    if (bullishManip && phase !== 'EXPANSION') {
      return {
        archetype: 'MANIPULATION_CANDLE',
        direction: 'BUY',
        invalidationPrice: last.low - atr * 0.15,
        evidence: `Bullish manipulation: lower wick ${(lowerWick / atr).toFixed(2)}× ATR rejected`,
        sensorEvidence: { wick_body_ratio: lowerWick / body, wick_atr: lowerWick / atr },
      };
    }
    if (bearishManip && phase !== 'EXPANSION') {
      return {
        archetype: 'MANIPULATION_CANDLE',
        direction: 'SELL',
        invalidationPrice: last.high + atr * 0.15,
        evidence: `Bearish manipulation: upper wick ${(upperWick / atr).toFixed(2)}× ATR rejected`,
        sensorEvidence: { wick_body_ratio: upperWick / body, wick_atr: upperWick / atr },
      };
    }
  }

  // ── 4. MULTI_TOUCH_REJECTION (N=3) — range-family phases ───────────────────
  const rangeFamily = phase === 'ACCUMULATION' || phase === 'DISTRIBUTION';
  if (rangeFamily) {
    const touchRange = atr * 0.2;
    const highTouches = lookback.filter(c => Math.abs(c.high - recentHigh) < touchRange).length;
    const lowTouches = lookback.filter(c => Math.abs(c.low - recentLow) < touchRange).length;
    const rejectedHighNow = Math.abs(last.high - recentHigh) < touchRange && last.close < last.open &&
      last.close < recentHigh - atr * 0.2;
    const rejectedLowNow = Math.abs(last.low - recentLow) < touchRange && last.close > last.open &&
      last.close > recentLow + atr * 0.2;
    if (highTouches >= MULTI_TOUCH_N - 1 && rejectedHighNow) {
      return {
        archetype: 'MULTI_TOUCH_REJECTION',
        direction: 'SELL',
        invalidationPrice: recentHigh + atr * 0.25,
        evidence: `${highTouches + 1}-touch rejection at ${recentHigh.toFixed(5)}`,
        sensorEvidence: { touches: highTouches + 1, level: recentHigh },
      };
    }
    if (lowTouches >= MULTI_TOUCH_N - 1 && rejectedLowNow) {
      return {
        archetype: 'MULTI_TOUCH_REJECTION',
        direction: 'BUY',
        invalidationPrice: recentLow - atr * 0.25,
        evidence: `${lowTouches + 1}-touch rejection at ${recentLow.toFixed(5)}`,
        sensorEvidence: { touches: lowTouches + 1, level: recentLow },
      };
    }
  }

  // ── 5. COMPRESSION_BREAKOUT (accumulation-resolved) ────────────────────────
  const last4R = candles.slice(-5, -1).map(c => c.high - c.low);
  const priorR = candles.slice(-15, -5).map(c => c.high - c.low);
  const compressedPrior = last4R.every(r => r < atr * 0.7) &&
    priorR.length > 0 && (priorR.reduce((s, v) => s + v, 0) / priorR.length) > atr * 0.9;
  if (compressedPrior && totalRange > atr * 1.1) {
    if (last.close > last.open && last.close > recentHigh - atr * 0.1) {
      return {
        archetype: 'COMPRESSION_BREAKOUT',
        direction: 'BUY',
        invalidationPrice: Math.min(...last4R.map((_, i) => candles[candles.length - 5 + i].low)) - atr * 0.15,
        evidence: `Compression resolved with expansion close ${(totalRange / atr).toFixed(2)}× ATR`,
        sensorEvidence: { breakout_range_atr: totalRange / atr, compression_bars: 4 },
      };
    }
    if (last.close < last.open && last.close < recentLow + atr * 0.1) {
      return {
        archetype: 'COMPRESSION_BREAKOUT',
        direction: 'SELL',
        invalidationPrice: Math.max(...last4R.map((_, i) => candles[candles.length - 5 + i].high)) + atr * 0.15,
        evidence: `Compression resolved with expansion close ${(totalRange / atr).toFixed(2)}× ATR`,
        sensorEvidence: { breakout_range_atr: totalRange / atr, compression_bars: 4 },
      };
    }
  }

  // ── 6. FVG_OB_REACTION (gap boundary reaction) ─────────────────────────────
  // FVG = 3-bar imbalance where candle[n-2].high < candle[n].low (bullish) or
  // candle[n-2].low > candle[n].high (bearish). Reaction = current bar rejecting
  // the gap edge.
  if (candles.length >= 6) {
    for (let i = candles.length - 6; i < candles.length - 1; i++) {
      const c0 = candles[i];
      const c2 = candles[i + 2];
      const bullFVG = c0.high < c2.low;
      const bearFVG = c0.low > c2.high;
      if (bullFVG) {
        const gapLo = c0.high;
        const gapHi = c2.low;
        const touchedGap = last.low <= gapHi && last.low >= gapLo - atr * 0.1;
        const rejected = last.close > last.open && last.close > gapHi;
        if (touchedGap && rejected) {
          return {
            archetype: 'FVG_OB_REACTION',
            direction: 'BUY',
            invalidationPrice: gapLo - atr * 0.15,
            evidence: `Bullish FVG reaction at ${gapLo.toFixed(5)}–${gapHi.toFixed(5)}`,
            sensorEvidence: { gap_low: gapLo, gap_high: gapHi, gap_age_bars: candles.length - 1 - (i + 2) },
          };
        }
      }
      if (bearFVG) {
        const gapHi = c0.low;
        const gapLo = c2.high;
        const touchedGap = last.high >= gapLo && last.high <= gapHi + atr * 0.1;
        const rejected = last.close < last.open && last.close < gapLo;
        if (touchedGap && rejected) {
          return {
            archetype: 'FVG_OB_REACTION',
            direction: 'SELL',
            invalidationPrice: gapHi + atr * 0.15,
            evidence: `Bearish FVG reaction at ${gapLo.toFixed(5)}–${gapHi.toFixed(5)}`,
            sensorEvidence: { gap_low: gapLo, gap_high: gapHi, gap_age_bars: candles.length - 1 - (i + 2) },
          };
        }
      }
    }
  }

  // ── 7. MEAN_REVERSION (extreme RSI + rejection candle at boundary) ─────────
  if (rangeFamily) {
    const rsi = calcRSI(closes, 14);
    const nearHigh = Math.abs(last.high - recentHigh) < atr * 0.3;
    const nearLow = Math.abs(last.low - recentLow) < atr * 0.3;
    if (rsi > 70 && nearHigh && last.close < last.open && upperWick > body) {
      return {
        archetype: 'MEAN_REVERSION',
        direction: 'SELL',
        invalidationPrice: last.high + atr * 0.2,
        evidence: `RSI ${rsi.toFixed(0)} with rejection at range high ${recentHigh.toFixed(5)}`,
        sensorEvidence: { rsi, range_position: 'high' },
      };
    }
    if (rsi < 30 && nearLow && last.close > last.open && lowerWick > body) {
      return {
        archetype: 'MEAN_REVERSION',
        direction: 'BUY',
        invalidationPrice: last.low - atr * 0.2,
        evidence: `RSI ${rsi.toFixed(0)} with rejection at range low ${recentLow.toFixed(5)}`,
        sensorEvidence: { rsi, range_position: 'low' },
      };
    }
  }

  return null;
}

// ─── Regime/Trigger Compatibility Matrix ─────────────────────────────────────

function regimeAllowsTrigger(phase: PhaseLabel, archetype: TriggerArchetype): boolean {
  switch (archetype) {
    case 'BOS_CONFIRMED':
      return phase === 'EXPANSION' || phase === 'RETRACEMENT' || phase === 'REVERSAL';
    case 'COMPRESSION_BREAKOUT':
      return phase === 'ACCUMULATION' || phase === 'EXPANSION' || phase === 'RETRACEMENT';
    case 'SWEEP_RECLAIM':
    case 'MANIPULATION_CANDLE':
    case 'FVG_OB_REACTION':
      return phase !== 'UNCLEAR';
    case 'MULTI_TOUCH_REJECTION':
    case 'MEAN_REVERSION':
      return phase === 'ACCUMULATION' || phase === 'DISTRIBUTION';
    default:
      return false;
  }
}

// ─── Adversarial Clear Check ─────────────────────────────────────────────────
// Quick adversarial cross-check: did the SAME BAR that produced the trigger also
// run stops in the OPPOSITE direction (fake-breakout risk)?

function checkAdversarialClear(
  candles: CandleRow[],
  trigger: TriggerResult,
  atr: number,
): { clear: boolean; evidence: string } {
  if (candles.length < 10 || atr <= 0) return { clear: true, evidence: 'insufficient-data' };
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const lookback = candles.slice(-15, -2);
  const recentHigh = Math.max(...lookback.map(c => c.high));
  const recentLow = Math.min(...lookback.map(c => c.low));

  if (trigger.direction === 'BUY') {
    // fake-breakout risk: bar wicked HIGHER than recentHigh then closed below
    // (indicates a long trap despite bullish trigger)
    const trappedLong = last.high > recentHigh + atr * 0.2 && last.close < recentHigh;
    if (trappedLong) return { clear: false, evidence: 'long-trap-wick-detected' };
    // Or prev bar was a clean bullish BOS already (trigger is stale)
    const stale = prev.close > recentHigh && trigger.archetype !== 'SWEEP_RECLAIM';
    if (stale) return { clear: false, evidence: 'trigger-stale-bos-already-printed' };
  } else if (trigger.direction === 'SELL') {
    const trappedShort = last.low < recentLow - atr * 0.2 && last.close > recentLow;
    if (trappedShort) return { clear: false, evidence: 'short-trap-wick-detected' };
    const stale = prev.close < recentLow && trigger.archetype !== 'SWEEP_RECLAIM';
    if (stale) return { clear: false, evidence: 'trigger-stale-bos-already-printed' };
  }

  return { clear: true, evidence: 'no-adversarial-evidence' };
}

// ─── Quality Scoring (PC5) ───────────────────────────────────────────────────

function scoreQuality(
  phase: PhaseLabel,
  direction: DirectionLean,
  archetype: TriggerArchetype,
  roomInATR: number,
  invalidationATR: number,
  rewardRatio: number,
  candles: CandleRow[],
): number {
  let score = 0;

  // Trigger archetype base (0–30). High-signal archetypes score higher.
  const archetypeScore: Record<TriggerArchetype, number> = {
    BOS_CONFIRMED: 30,
    SWEEP_RECLAIM: 30,
    COMPRESSION_BREAKOUT: 28,
    MANIPULATION_CANDLE: 25,
    MULTI_TOUCH_REJECTION: 25,
    FVG_OB_REACTION: 22,
    MEAN_REVERSION: 20,
  };
  score += archetypeScore[archetype];

  // Reward ratio (0–25)
  score += Math.min(25, Math.floor((rewardRatio - MIN_REWARD_RATIO) * 10) + 15);

  // Invalidation tightness (0–15). Smaller is better within the PC6 ceiling.
  const tightness = Math.max(0, 1 - invalidationATR / MAX_INVALIDATION_ATR);
  score += Math.floor(tightness * 15);

  // Structural room depth (0–15)
  score += Math.min(15, Math.floor((roomInATR / MIN_ATR_ROOM - 1) * 10) + 5);

  // Phase clarity (0–10)
  if (phase === 'EXPANSION' && direction !== 'NEUTRAL') score += 10;
  else if (phase === 'RETRACEMENT' && direction !== 'NEUTRAL') score += 9;
  else if ((phase === 'DISTRIBUTION' || phase === 'ACCUMULATION') && direction !== 'NEUTRAL') score += 7;
  else if (phase === 'REVERSAL' && direction !== 'NEUTRAL') score += 6;
  else score += 3;

  // EMA alignment (0–5)
  if (candles.length >= 50) {
    const closes = candles.map(c => c.close);
    const e20 = calcEMA(closes, 20);
    const e50 = calcEMA(closes, 50);
    if (e20.length > 0 && e50.length > 0) {
      const last = candles[candles.length - 1].close;
      const bull = last > e20[e20.length - 1] && e20[e20.length - 1] > e50[e50.length - 1];
      const bear = last < e20[e20.length - 1] && e20[e20.length - 1] < e50[e50.length - 1];
      if ((direction === 'BUY' && bull) || (direction === 'SELL' && bear)) score += 5;
    }
  }

  return Math.min(100, Math.max(0, score));
}

// ─── Session Helpers ─────────────────────────────────────────────────────────

function detectSession(): string {
  const hour = new Date().getUTCHours();
  if (hour >= 22 || hour < 1) return 'sydney';
  if (hour >= 1 && hour < 8) return 'asian';
  if (hour >= 8 && hour < 12) return 'london';
  if (hour >= 12 && hour < 17) return 'overlap';
  if (hour >= 17 && hour < 22) return 'ny';
  return 'dead';
}

function getSessionMinutesRemaining(): number | null {
  const now = new Date();
  const m = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (m >= 22 * 60) return 24 * 60 - m;
  if (m < 1 * 60) return 1 * 60 - m;
  if (m >= 1 * 60 && m < 8 * 60) return 8 * 60 - m;
  if (m >= 8 * 60 && m < 17 * 60) return 17 * 60 - m;
  if (m >= 17 * 60 && m < 22 * 60) return 22 * 60 - m;
  return null;
}

// ─── Main Assessment ─────────────────────────────────────────────────────────

function notReady(
  symbol: string, style: TradingStyle, session: string,
  reason: string, sessionMinutesRemaining: number | null,
  phase: PhaseLabel = 'UNCLEAR', phaseEvidence = '', direction: DirectionLean = 'NEUTRAL',
  preconditionsMet: string[] = [], roomPips = 0, roomDir: DirectionLean = 'NEUTRAL',
  qualityScore = 0,
): HuntAssessment {
  const now = new Date();
  return {
    symbol, style, session,
    hunt_state: 'not_ready',
    phase_detected: phase,
    phase_evidence: phaseEvidence,
    preconditions_met: preconditionsMet,
    structural_room_pips: roomPips,
    structural_room_direction: roomDir,
    trigger_state: 'none',
    trigger_evidence: '',
    trigger_archetype: null,
    direction_lean: direction,
    quality_score: qualityScore,
    hunt_summary: reason,
    last_scanned_at: now.toISOString(),
    expires_at: new Date(now.getTime() + EXPIRE_MINUTES * 60 * 1000).toISOString(),
    armed_at: null,
    invalidation_price: null,
    invalidation_distance_atr: null,
    reward_room_atr: null,
    adversarial_clear: false,
    regime_match: false,
    sensor_evidence: {},
    session_minutes_remaining: sessionMinutesRemaining,
  };
}

async function assess(
  symbol: string, style: TradingStyle, session: string,
  sessionMinutesRemaining: number | null,
): Promise<HuntAssessment> {
  const { data: primaryRows, error: pErr } = await supabase
    .rpc('get_best_candles', {
      p_symbol: symbol,
      p_timeframe: PRIMARY_TF,
      p_limit: 60
    });
  if (pErr || !primaryRows || primaryRows.length < 20) {
    return notReady(symbol, style, session, `Insufficient ${PRIMARY_TF} candles`, sessionMinutesRemaining);
  }
  const { data: controlRows } = await supabase
    .rpc('get_best_candles', {
      p_symbol: symbol,
      p_timeframe: CONTROL_TF,
      p_limit: 30
    });

  const primary = [...primaryRows].reverse() as CandleRow[];
  const control = controlRows ? [...controlRows].reverse() as CandleRow[] : [];
  const precond: string[] = [];

  // PC1
  const { phase, evidence: phaseEvidence, directionLean, atr } = detectPhase(primary);
  if (phase === 'UNCLEAR') {
    return notReady(symbol, style, session, 'Phase unreadable', sessionMinutesRemaining);
  }
  precond.push('PC1_PHASE_READABLE');

  // PC4 — attempt confirmed trigger first (cheapest reject)
  const trigger = detectConfirmedTrigger(primary, phase, atr);
  if (!trigger) {
    return notReady(
      symbol, style, session,
      `${phase} phase — no confirmed trigger this bar`, sessionMinutesRemaining,
      phase, phaseEvidence, directionLean, precond,
    );
  }

  // Regime compatibility
  const regimeMatch = regimeAllowsTrigger(phase, trigger.archetype);
  if (!regimeMatch) {
    return notReady(
      symbol, style, session,
      `${trigger.archetype} detected but not valid in ${phase} regime`, sessionMinutesRemaining,
      phase, phaseEvidence, directionLean, precond,
    );
  }

  // PC2 implicit-passed because trigger fired with phase-archetype match
  precond.push('PC2_SETUP_MATERIAL');
  precond.push('PC4_TRIGGER');

  // PC3 — structural room in trigger direction
  const { pips: roomPips, roomInATR, direction: roomDir, targetPrice } = measureStructuralRoom(
    primary, control, symbol, trigger.direction, atr,
  );
  if (roomInATR < MIN_ATR_ROOM) {
    return notReady(
      symbol, style, session,
      `${trigger.archetype} fired but only ${roomInATR.toFixed(2)}× ATR room (need ${MIN_ATR_ROOM}×)`,
      sessionMinutesRemaining, phase, phaseEvidence, trigger.direction, precond, roomPips, roomDir,
    );
  }
  precond.push('PC3_STRUCTURAL_ROOM');

  // PC6 — invalidation tightness (INTERNAL)
  const last = primary[primary.length - 1];
  const invalidationDist = Math.abs(last.close - trigger.invalidationPrice);
  const invalidationATR = atr > 0 ? invalidationDist / atr : 999;
  if (invalidationATR > MAX_INVALIDATION_ATR) {
    return notReady(
      symbol, style, session,
      `${trigger.archetype} fired but structural invalidation ${invalidationATR.toFixed(2)}× ATR exceeds PC6 ceiling`,
      sessionMinutesRemaining, phase, phaseEvidence, trigger.direction, precond, roomPips, roomDir,
    );
  }
  precond.push('PC6_TIGHT_INVALIDATION');

  // PC7 — reward room ratio (INTERNAL)
  const rewardDist = Math.abs(targetPrice - last.close);
  const rewardRatio = invalidationDist > 0 ? rewardDist / invalidationDist : 0;
  if (rewardRatio < MIN_REWARD_RATIO) {
    return notReady(
      symbol, style, session,
      `${trigger.archetype} fired but reward ratio ${rewardRatio.toFixed(2)}× below PC7 (${MIN_REWARD_RATIO}×)`,
      sessionMinutesRemaining, phase, phaseEvidence, trigger.direction, precond, roomPips, roomDir,
    );
  }
  precond.push('PC7_REWARD_RUNWAY');

  // Adversarial cross-check
  const adv = checkAdversarialClear(primary, trigger, atr);
  if (!adv.clear) {
    return notReady(
      symbol, style, session,
      `${trigger.archetype} fired but adversarial risk present (${adv.evidence})`,
      sessionMinutesRemaining, phase, phaseEvidence, trigger.direction, precond, roomPips, roomDir,
    );
  }

  // PC5 — quality score
  const qs = scoreQuality(phase, trigger.direction, trigger.archetype, roomInATR, invalidationATR, rewardRatio, primary);
  if (qs < MIN_QUALITY_SCORE) {
    return notReady(
      symbol, style, session,
      `${trigger.archetype} fired but quality ${qs}/100 below armed threshold (${MIN_QUALITY_SCORE})`,
      sessionMinutesRemaining, phase, phaseEvidence, trigger.direction, precond, roomPips, roomDir, qs,
    );
  }
  precond.push('PC5_QUALITY');

  const now = new Date();
  return {
    symbol, style, session,
    hunt_state: 'armed',
    phase_detected: phase,
    phase_evidence: phaseEvidence,
    preconditions_met: precond,
    structural_room_pips: roomPips,
    structural_room_direction: roomDir,
    trigger_state: 'confirmed',
    trigger_evidence: trigger.evidence,
    trigger_archetype: trigger.archetype,
    direction_lean: trigger.direction,
    quality_score: qs,
    hunt_summary: `${trigger.archetype} confirmed in ${phase} — scan Alpha now`,
    last_scanned_at: now.toISOString(),
    expires_at: new Date(now.getTime() + EXPIRE_MINUTES * 60 * 1000).toISOString(),
    armed_at: now.toISOString(),
    invalidation_price: trigger.invalidationPrice,
    invalidation_distance_atr: invalidationATR,
    reward_room_atr: rewardRatio,
    adversarial_clear: true,
    regime_match: true,
    sensor_evidence: { ...trigger.sensorEvidence, adversarial: adv.evidence },
    session_minutes_remaining: sessionMinutesRemaining,
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export const handler: Handler = async () => {
  const style: TradingStyle = 'MICRO_INTRADAY';
  const session = detectSession();
  const sessionMinutesRemaining = getSessionMinutesRemaining();
  const results: HuntAssessment[] = [];

  for (const symbol of SYMBOLS) {
    try {
      results.push(await assess(symbol, style, session, sessionMinutesRemaining));
    } catch (err) {
      console.error(`[HuntReadiness] ${symbol} error:`, err);
      results.push(notReady(symbol, style, session, 'Scanner error', sessionMinutesRemaining));
    }
  }

  let written = 0;
  const failures: Array<{ symbol: string; error: string }> = [];
  for (const row of results) {
    const { error } = await supabase
      .from('alpha_hunt_readiness')
      .upsert(row, { onConflict: 'symbol,style' });
    if (error) {
      console.error(`[HuntReadiness] Upsert ${row.symbol}:`, error.message);
      failures.push({ symbol: row.symbol, error: error.message });
    } else {
      written += 1;
    }
  }

  if (written === 0) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'zero rows written', failures }),
    };
  }

  const armedCount = results.filter(r => r.hunt_state === 'armed').length;
  console.log(
    `[HuntReadiness] ${armedCount} armed, ${results.length - armedCount} not_ready | ` +
    `written=${written}/${results.length} | session=${session}`,
  );

  return {
    statusCode: 200,
    body: JSON.stringify({
      armed: armedCount,
      not_ready: results.length - armedCount,
      session,
      total: results.length,
      written,
      failures,
    }),
  };
};
