/**
 * Alpha Hunt Readiness Scanner — Scheduled Netlify Function
 *
 * GOVERNANCE CONTRACT (CCIP-2026-0421-HUNT-READINESS):
 * ─────────────────────────────────────────────────────
 * This scanner answers ONE question per symbol+style:
 *   "Does Alpha have the raw structural material to execute a trade here right now?"
 *
 * It does NOT:
 * - Score candle patterns or detect generic market events
 * - Make trade recommendations
 * - Predict trade direction with conviction
 * - Pre-approve or gate Alpha's decisions
 *
 * It DOES detect Alpha's four hunting preconditions:
 *   PC1 — Market phase is readable (ACCUMULATION/EXPANSION/DISTRIBUTION/RETRACEMENT/REVERSAL)
 *   PC2 — Phase-native trade type has raw structural material
 *   PC3 — Structural room exists (measurable open distance before first wall)
 *   PC4 — Trigger evidence present or developing (sweep, BOS, compression break)
 *
 * Hunt states:
 *   live      — PC1+PC2+PC3+PC4 all confirmed. Trigger has fired. Alpha likely executes.
 *   ready     — PC1+PC2+PC3 confirmed. Trigger developing or imminent. Worth scanning.
 *   not_ready — PC1/PC2/PC3 absent. Alpha will likely output NO_TRADE. Skip scanning.
 *
 * Schedule: every 3 minutes (same cadence as old market-behavior-scanner).
 * Runs for 9 symbols × 3 styles = 27 rows per scan.
 * Uses only pre-aggregated forex_candles — zero external API calls.
 */

import type { Handler } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase-admin';

const supabase = getSupabaseAdmin();

const SYMBOLS = [
  'XAUUSD', 'US30', 'NAS100',
  'EURUSD', 'GBPUSD', 'USDJPY',
  'BTCUSD', 'ETHUSD', 'SPX500',
];

type TradingStyle = 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';
type HuntState = 'live' | 'ready' | 'not_ready';
type PhaseLabel = 'ACCUMULATION' | 'EXPANSION' | 'DISTRIBUTION' | 'RETRACEMENT' | 'REVERSAL' | 'UNCLEAR';
type TriggerState = 'fired' | 'developing' | 'none';
type DirectionLean = 'BUY' | 'SELL' | 'NEUTRAL';

// Style → primary timeframe for phase detection
const STYLE_PRIMARY_TF: Record<TradingStyle, string> = {
  SCALP: 'M5',          // Alpha reads M5 for phase when scalping on M1
  MICRO_INTRADAY: 'M15', // Alpha reads M15 for phase when on M5
  INTRADAY: 'H1',        // Alpha reads H1 for phase when on M15
};

// Style → control timeframe for structural validation
const STYLE_CONTROL_TF: Record<TradingStyle, string> = {
  SCALP: 'M15',
  MICRO_INTRADAY: 'H1',
  INTRADAY: 'H4',
};

// TTL per style — how long a readiness row stays valid
const EXPIRE_MINUTES: Record<TradingStyle, number> = {
  SCALP: 5,
  MICRO_INTRADAY: 8,
  INTRADAY: 12,
};

// Minimum pip size per instrument for structural room measurement
const PIP_SIZE: Record<string, number> = {
  EURUSD: 0.0001, GBPUSD: 0.0001, USDJPY: 0.01,
  XAUUSD: 0.1,   US30: 1.0,      NAS100: 1.0,  SPX500: 0.1,
  BTCUSD: 1.0,   ETHUSD: 0.1,
};

// Minimum structural room (pips) to qualify as PC3 — enough for a valid 1:1 trade
const MIN_STRUCTURAL_ROOM: Record<TradingStyle, number> = {
  SCALP: 10,
  MICRO_INTRADAY: 20,
  INTRADAY: 35,
};

interface CandleRow {
  open: number;
  high: number;
  low: number;
  close: number;
  close_time: string;
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
  trigger_state: TriggerState;
  trigger_evidence: string;
  direction_lean: DirectionLean;
  hunt_summary: string;
  last_scanned_at: string;
  expires_at: string;
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

function calcEMA(closes: number[], period: number): number[] {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(ema);
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

function calcATR(candles: CandleRow[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)));
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function toPips(priceDistance: number, symbol: string): number {
  const pip = PIP_SIZE[symbol] ?? 0.0001;
  return priceDistance / pip;
}

function avgRange(candles: CandleRow[], count = 10): number {
  return candles.slice(-count).reduce((s, c) => s + (c.high - c.low), 0) / count;
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

// ─── Phase Detection ─────────────────────────────────────────────────────────
// Determines which of Alpha's 5 phases the market is currently in.
// Uses candle structure from the style's primary timeframe.

function detectPhase(
  candles: CandleRow[],
  symbol: string
): { phase: PhaseLabel; evidence: string; directionLean: DirectionLean } {
  if (candles.length < 20) {
    return { phase: 'UNCLEAR', evidence: 'Insufficient candle history', directionLean: 'NEUTRAL' };
  }

  const closes = candles.map(c => c.close);
  const rsi = calcRSI(closes, 14);
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const atr = calcATR(candles, 14);
  const avgR = avgRange(candles, 10);

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];

  const currentEMA20 = ema20[ema20.length - 1] ?? last.close;
  const prevEMA20 = ema20[ema20.length - 2] ?? last.close;
  const currentEMA50 = ema50.length > 0 ? ema50[ema50.length - 1] : last.close;

  // Measure recent range compression (last 5 vs prior 10)
  const last5Ranges = candles.slice(-5).map(c => c.high - c.low);
  const prior10Ranges = candles.slice(-15, -5).map(c => c.high - c.low);
  const avgLast5 = last5Ranges.reduce((s, v) => s + v, 0) / last5Ranges.length;
  const avgPrior10 = prior10Ranges.length > 0
    ? prior10Ranges.reduce((s, v) => s + v, 0) / prior10Ranges.length
    : avgLast5;
  const rangeRatio = avgPrior10 > 0 ? avgLast5 / avgPrior10 : 1;

  // Swing high/low structure (last 20 candles excluding last 2)
  const lookback = candles.slice(-22, -2);
  const swingHigh = lookback.length > 0 ? Math.max(...lookback.map(c => c.high)) : last.high;
  const swingLow = lookback.length > 0 ? Math.min(...lookback.map(c => c.low)) : last.low;

  // Higher highs / lower lows detection (last 5 closes)
  const last5Closes = closes.slice(-5);
  let higherHighCount = 0, lowerLowCount = 0;
  for (let i = 1; i < last5Closes.length; i++) {
    if (last5Closes[i] > last5Closes[i - 1]) higherHighCount++;
    else if (last5Closes[i] < last5Closes[i - 1]) lowerLowCount++;
  }
  const trendingUp = higherHighCount >= 3;
  const trendingDown = lowerLowCount >= 3;

  // Price position relative to EMAs
  const aboveEMA20 = last.close > currentEMA20;
  const aboveEMA50 = last.close > currentEMA50;
  const ema20Rising = currentEMA20 > prevEMA20;

  // Current range vs ATR baseline
  const currentRange = last.high - last.low;
  const rangeExpanding = currentRange > avgR * 1.3;

  // ── REVERSAL: price has crossed EMA20 against recent trend after a strong move
  if (ema20.length >= 5) {
    const was_above = ema20[ema20.length - 3] < candles[candles.length - 3].close;
    const crossed_below = !aboveEMA20 && candles[candles.length - 2].close < currentEMA20;
    const was_below = ema20[ema20.length - 3] > candles[candles.length - 3].close;
    const crossed_above = aboveEMA20 && candles[candles.length - 2].close > currentEMA20;

    if (was_above && crossed_below && !trendingDown && rsi < 45) {
      return {
        phase: 'REVERSAL',
        evidence: `EMA20 crossed bearish at ${currentEMA20.toFixed(symbol.includes('JPY') ? 3 : 5)}, RSI ${rsi.toFixed(0)} — downside reversal structure`,
        directionLean: 'SELL',
      };
    }
    if (was_below && crossed_above && !trendingUp && rsi > 55) {
      return {
        phase: 'REVERSAL',
        evidence: `EMA20 crossed bullish at ${currentEMA20.toFixed(symbol.includes('JPY') ? 3 : 5)}, RSI ${rsi.toFixed(0)} — upside reversal structure`,
        directionLean: 'BUY',
      };
    }
  }

  // ── EXPANSION: price trending strongly in one direction with range expanding
  if ((trendingUp || trendingDown) && rangeExpanding) {
    const dir = trendingUp ? 'BUY' : 'SELL';
    const dirLabel = trendingUp ? 'bullish' : 'bearish';
    return {
      phase: 'EXPANSION',
      evidence: `${higherHighCount > lowerLowCount ? higherHighCount : lowerLowCount}/4 directional closes, range ${(rangeRatio * 100).toFixed(0)}% of baseline — ${dirLabel} expansion active`,
      directionLean: dir,
    };
  }

  // ── RETRACEMENT: trending pair pulling back into structure
  if (trendingUp && !aboveEMA20 && aboveEMA50 && rsi > 40 && rsi < 65) {
    return {
      phase: 'RETRACEMENT',
      evidence: `Pullback to EMA20 (${currentEMA20.toFixed(symbol.includes('JPY') ? 3 : 5)}) in uptrend — wait_pullback zone active`,
      directionLean: 'BUY',
    };
  }
  if (trendingDown && aboveEMA20 && !aboveEMA50 && rsi > 35 && rsi < 60) {
    return {
      phase: 'RETRACEMENT',
      evidence: `Pullback to EMA20 (${currentEMA20.toFixed(symbol.includes('JPY') ? 3 : 5)}) in downtrend — wait_pullback zone active`,
      directionLean: 'SELL',
    };
  }

  // ── DISTRIBUTION: price at range top with weakening momentum (RSI divergence proxy)
  if (aboveEMA20 && aboveEMA50 && rsi > 68 && !rangeExpanding) {
    return {
      phase: 'DISTRIBUTION',
      evidence: `RSI ${rsi.toFixed(0)} above 68 with range compression — potential distribution at highs`,
      directionLean: 'SELL',
    };
  }
  if (!aboveEMA20 && !aboveEMA50 && rsi < 32 && !rangeExpanding) {
    return {
      phase: 'DISTRIBUTION',
      evidence: `RSI ${rsi.toFixed(0)} below 32 with range compression — potential distribution at lows`,
      directionLean: 'BUY',
    };
  }

  // ── ACCUMULATION: range-bound, compressing, near extremes
  if (rangeRatio < 0.75) {
    // Determine where price is within the recent range
    const rangeSpan = swingHigh - swingLow;
    const pricePosition = rangeSpan > 0 ? (last.close - swingLow) / rangeSpan : 0.5;
    const nearBottom = pricePosition < 0.3;
    const nearTop = pricePosition > 0.7;
    const dirLean: DirectionLean = nearBottom ? 'BUY' : nearTop ? 'SELL' : 'NEUTRAL';
    return {
      phase: 'ACCUMULATION',
      evidence: `Range ${(rangeRatio * 100).toFixed(0)}% of baseline — compression forming, price at ${(pricePosition * 100).toFixed(0)}% of recent range`,
      directionLean: dirLean,
    };
  }

  // ── EXPANSION (single direction trending but not explosive)
  if (trendingUp) {
    return {
      phase: 'EXPANSION',
      evidence: `${higherHighCount}/4 higher closes — slow bullish expansion, EMA20 ${ema20Rising ? 'rising' : 'flat'}`,
      directionLean: 'BUY',
    };
  }
  if (trendingDown) {
    return {
      phase: 'EXPANSION',
      evidence: `${lowerLowCount}/4 lower closes — slow bearish expansion, EMA20 ${!ema20Rising ? 'declining' : 'flat'}`,
      directionLean: 'SELL',
    };
  }

  return { phase: 'UNCLEAR', evidence: 'No dominant phase signal detected', directionLean: 'NEUTRAL' };
}

// ─── Structural Room Measurement (PC3) ───────────────────────────────────────
// Measures how much clear distance exists from current price to the nearest wall.
// Returns pips in the direction with most room.

function measureStructuralRoom(
  candles: CandleRow[],
  controlCandles: CandleRow[],
  symbol: string,
  directionLean: DirectionLean
): { pips: number; direction: DirectionLean } {
  if (candles.length < 10) return { pips: 0, direction: 'NEUTRAL' };

  const last = candles[candles.length - 1];
  const allCandles = [...controlCandles, ...candles].slice(-40);

  // Identify structural walls: swing highs and lows in lookback
  const lookback = allCandles.slice(-30, -3);
  if (lookback.length === 0) return { pips: 0, direction: 'NEUTRAL' };

  const structuralHigh = Math.max(...lookback.map(c => c.high));
  const structuralLow = Math.min(...lookback.map(c => c.low));

  const roomUp = toPips(structuralHigh - last.close, symbol);
  const roomDown = toPips(last.close - structuralLow, symbol);

  // Prefer the direction Alpha is leaning
  if (directionLean === 'BUY') return { pips: Math.max(roomUp, 0), direction: 'BUY' };
  if (directionLean === 'SELL') return { pips: Math.max(roomDown, 0), direction: 'SELL' };

  // NEUTRAL: return the direction with more room
  if (roomUp > roomDown) return { pips: roomUp, direction: 'BUY' };
  if (roomDown > roomUp) return { pips: roomDown, direction: 'SELL' };
  return { pips: Math.max(roomUp, roomDown), direction: 'NEUTRAL' };
}

// ─── Phase-Native Trade Type Check (PC2) ─────────────────────────────────────
// For each phase, checks that its native trade types have the raw material.

function checkPhaseNativeSetup(
  phase: PhaseLabel,
  candles: CandleRow[],
  directionLean: DirectionLean,
  symbol: string
): { passed: boolean; evidence: string } {
  if (phase === 'UNCLEAR') return { passed: false, evidence: 'Phase unclear — no native setup possible' };

  const closes = candles.map(c => c.close);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const lookback = candles.slice(-20, -2);
  const swingHigh = lookback.length > 0 ? Math.max(...lookback.map(c => c.high)) : last.high;
  const swingLow = lookback.length > 0 ? Math.min(...lookback.map(c => c.low)) : last.low;
  const ema20 = calcEMA(closes, 20);
  const currentEMA20 = ema20.length > 0 ? ema20[ema20.length - 1] : last.close;
  const atr = calcATR(candles, 14);
  const rangeSpan = swingHigh - swingLow;
  const pricePosition = rangeSpan > 0 ? (last.close - swingLow) / rangeSpan : 0.5;

  switch (phase) {
    case 'ACCUMULATION': {
      // Alpha hunts: range boundary fade, sweep-reclaim, compression breakout
      const nearBoundary = pricePosition < 0.2 || pricePosition > 0.8;
      const lastFewRanges = candles.slice(-5).map(c => c.high - c.low);
      const compressionForming = Math.max(...lastFewRanges) < atr * 0.8;
      if (nearBoundary) return { passed: true, evidence: `Price at ${(pricePosition * 100).toFixed(0)}% of range — boundary fade material available` };
      if (compressionForming) return { passed: true, evidence: 'Compression forming inside accumulation range — breakout setup coiling' };
      return { passed: false, evidence: 'Price in range mid-zone, no boundary proximity, no compression — Alpha would find no ACCUMULATION setup' };
    }

    case 'EXPANSION': {
      // Alpha hunts: trend continuation, pullback entry, momentum breakout
      const breakingSwingHigh = last.close > swingHigh && prev.close <= swingHigh;
      const breakingSwingLow = last.close < swingLow && prev.close >= swingLow;
      const nearEMA = Math.abs(last.close - currentEMA20) < atr * 0.5;
      if (breakingSwingHigh) return { passed: true, evidence: 'Breaking above swing high — momentum breakout material fired' };
      if (breakingSwingLow) return { passed: true, evidence: 'Breaking below swing low — bearish momentum breakout material fired' };
      if (nearEMA && directionLean !== 'NEUTRAL') return { passed: true, evidence: `Price near EMA20 in ${directionLean === 'BUY' ? 'uptrend' : 'downtrend'} — pullback continuation entry material present` };
      return { passed: true, evidence: 'Active expansion phase — continuation material available' };
    }

    case 'DISTRIBUTION': {
      // Alpha hunts: reversal entry at extreme, range top/bottom fade
      const rsi = calcRSI(closes, 14);
      const extremeRSI = rsi > 65 || rsi < 35;
      if (extremeRSI || pricePosition > 0.75 || pricePosition < 0.25) {
        return { passed: true, evidence: `RSI ${rsi.toFixed(0)}, price at ${(pricePosition * 100).toFixed(0)}% of range — reversal fade material at extreme` };
      }
      return { passed: false, evidence: 'Distribution phase but price not at a fade extreme — Alpha needs price at level' };
    }

    case 'RETRACEMENT': {
      // Alpha hunts: pullback continuation into prior structure zone
      const nearEMA = Math.abs(last.close - currentEMA20) < atr * 0.8;
      if (nearEMA) return { passed: true, evidence: `Price pulled back to EMA20 zone — continuation entry material present` };
      return { passed: true, evidence: 'Active retracement — wait_pullback continuation structure forming' };
    }

    case 'REVERSAL': {
      // Alpha hunts: counter-trend entry with strong evidence, structure retest
      const prevBodyDir = prev.close > prev.open ? 'bull' : 'bear';
      const lastBodyDir = last.close > last.open ? 'bull' : 'bear';
      const engulfing = prevBodyDir !== lastBodyDir &&
        Math.abs(last.close - last.open) > Math.abs(prev.close - prev.open) * 0.8;
      if (engulfing) return { passed: true, evidence: 'Engulfing reversal candle — counter-structure entry material present' };
      return { passed: true, evidence: 'Reversal phase active — structural retest entry material exists' };
    }

    default:
      return { passed: false, evidence: 'No phase-native setup detected' };
  }
}

// ─── Trigger Detection (PC4) ──────────────────────────────────────────────────
// Detects whether a trade trigger has fired or is developing.
// Trigger = the specific event Alpha needs to enter execute_now vs wait modes.

function detectTrigger(
  candles: CandleRow[],
  phase: PhaseLabel,
  directionLean: DirectionLean,
  symbol: string
): { state: TriggerState; evidence: string } {
  if (candles.length < 5) return { state: 'none', evidence: 'Insufficient data' };

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];
  const atr = calcATR(candles, 14);
  const closes = candles.map(c => c.close);

  // Sweep + BOS: strong wick that crosses a key level then closes back
  const lookback = candles.slice(-20, -3);
  const recentHigh = lookback.length > 0 ? Math.max(...lookback.map(c => c.high)) : last.high;
  const recentLow = lookback.length > 0 ? Math.min(...lookback.map(c => c.low)) : last.low;

  const sweptHigh = prev.high > recentHigh && prev.close < recentHigh;
  const sweptLow = prev.low < recentLow && prev.close > recentLow;
  const bosUp = last.close > recentHigh && prev.close <= recentHigh;
  const bosDown = last.close < recentLow && prev.close >= recentLow;

  // FIRED: BOS (Break of Structure) — price broke and closed beyond swing level
  if (bosUp && directionLean !== 'SELL') {
    return { state: 'fired', evidence: `BOS confirmed: close above swing high ${recentHigh.toFixed(symbol.includes('JPY') ? 3 : 5)} — execute_now trigger` };
  }
  if (bosDown && directionLean !== 'BUY') {
    return { state: 'fired', evidence: `BOS confirmed: close below swing low ${recentLow.toFixed(symbol.includes('JPY') ? 3 : 5)} — execute_now trigger` };
  }

  // FIRED: Sweep reclaim — wick swept extreme then closed back inside
  if (sweptLow && directionLean !== 'SELL') {
    return { state: 'fired', evidence: `Sweep of low ${recentLow.toFixed(symbol.includes('JPY') ? 3 : 5)} with close above — stop hunt completed, reclaim trigger` };
  }
  if (sweptHigh && directionLean !== 'BUY') {
    return { state: 'fired', evidence: `Sweep of high ${recentHigh.toFixed(symbol.includes('JPY') ? 3 : 5)} with close below — stop hunt completed, reclaim trigger` };
  }

  // FIRED: Strong directional close into EMA zone (rejection trigger)
  const ema20 = calcEMA(closes, 20);
  if (ema20.length > 0) {
    const currentEMA = ema20[ema20.length - 1];
    const touchedEMA = prev.low <= currentEMA * 1.001 && prev.high >= currentEMA * 0.999;
    const bullishReject = touchedEMA && last.close > prev.close && last.close > currentEMA;
    const bearishReject = touchedEMA && last.close < prev.close && last.close < currentEMA;
    if (bullishReject && directionLean !== 'SELL') {
      return { state: 'fired', evidence: `EMA20 rejection trigger: bounce from ${currentEMA.toFixed(symbol.includes('JPY') ? 3 : 5)}` };
    }
    if (bearishReject && directionLean !== 'BUY') {
      return { state: 'fired', evidence: `EMA20 rejection trigger: rejection from ${currentEMA.toFixed(symbol.includes('JPY') ? 3 : 5)}` };
    }
  }

  // DEVELOPING: Compression forming — trigger imminent
  const last3Ranges = candles.slice(-3).map(c => c.high - c.low);
  const compressionForming = Math.max(...last3Ranges) < atr * 0.6 && atr > 0;
  if (compressionForming) {
    return { state: 'developing', evidence: 'Compression tightening — breakout trigger is imminent' };
  }

  // DEVELOPING: Price approaching a key level (within 20% ATR)
  const distToHigh = Math.abs(last.close - recentHigh);
  const distToLow = Math.abs(last.close - recentLow);
  const approaching = (distToHigh < atr * 0.3 || distToLow < atr * 0.3) && atr > 0;
  if (approaching) {
    const level = distToHigh < distToLow ? recentHigh : recentLow;
    return { state: 'developing', evidence: `Price approaching key level ${level.toFixed(symbol.includes('JPY') ? 3 : 5)} — trigger developing` };
  }

  // DEVELOPING: 2+ consecutive closes in same direction building momentum
  const last3Closes = closes.slice(-3);
  const allUp = last3Closes[2] > last3Closes[1] && last3Closes[1] > last3Closes[0];
  const allDown = last3Closes[2] < last3Closes[1] && last3Closes[1] < last3Closes[0];
  if (allUp && (directionLean === 'BUY' || directionLean === 'NEUTRAL')) {
    return { state: 'developing', evidence: '3 consecutive bullish closes — momentum trigger building' };
  }
  if (allDown && (directionLean === 'SELL' || directionLean === 'NEUTRAL')) {
    return { state: 'developing', evidence: '3 consecutive bearish closes — momentum trigger building' };
  }

  return { state: 'none', evidence: 'No trigger evidence detected — Alpha would wait or pass' };
}

// ─── Session Detection ────────────────────────────────────────────────────────

function detectSession(): string {
  const hour = new Date().getUTCHours();
  if (hour >= 22 || hour < 1) return 'sydney';
  if (hour >= 1 && hour < 8) return 'asian';
  if (hour >= 8 && hour < 12) return 'london';
  if (hour >= 12 && hour < 17) return 'overlap';
  if (hour >= 17 && hour < 22) return 'ny';
  return 'dead';
}

// ─── Hunt Summary Builder ─────────────────────────────────────────────────────

function buildHuntSummary(
  phase: PhaseLabel,
  huntState: HuntState,
  triggerState: TriggerState,
  triggerEvidence: string,
  phaseEvidence: string,
  structuralRoomPips: number,
  directionLean: DirectionLean
): string {
  if (huntState === 'not_ready') {
    return `Phase unclear or structural room insufficient — Alpha likely returns NO_TRADE.`;
  }

  const dirText = directionLean === 'NEUTRAL' ? 'either direction' : directionLean === 'BUY' ? 'long' : 'short';
  const phaseText = phase.toLowerCase().replace('_', ' ');

  if (huntState === 'live') {
    return `${phase} phase — trigger fired (${triggerEvidence}). ${structuralRoomPips.toFixed(0)} pips structural room ${dirText}. Alpha likely executes.`;
  }

  // ready state
  if (triggerState === 'developing') {
    return `${phase} phase — ${phaseEvidence}. Trigger developing. ${structuralRoomPips.toFixed(0)} pips structural room available ${dirText}.`;
  }

  return `${phase} phase — structural material present for ${phaseText} setup. ${structuralRoomPips.toFixed(0)} pips room ${dirText}. Scan Alpha now.`;
}

// ─── Main Assessment ──────────────────────────────────────────────────────────

async function assessHuntReadiness(
  symbol: string,
  style: TradingStyle,
  session: string
): Promise<HuntAssessment> {
  const primaryTF = STYLE_PRIMARY_TF[style];
  const controlTF = STYLE_CONTROL_TF[style];
  const now = new Date();
  const expiresAt = new Date(now.getTime() + EXPIRE_MINUTES[style] * 60 * 1000);
  const minRoom = MIN_STRUCTURAL_ROOM[style];

  const notReady = (reason: string): HuntAssessment => ({
    symbol, style, session,
    hunt_state: 'not_ready',
    phase_detected: 'UNCLEAR',
    phase_evidence: reason,
    preconditions_met: [],
    structural_room_pips: 0,
    structural_room_direction: 'NEUTRAL',
    trigger_state: 'none',
    trigger_evidence: '',
    direction_lean: 'NEUTRAL',
    hunt_summary: `No structural material detected — Alpha will likely NO_TRADE.`,
    last_scanned_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  });

  // Fetch primary timeframe candles
  const { data: primaryCandles, error: primaryErr } = await supabase
    .from('forex_candles')
    .select('open, high, low, close, close_time')
    .eq('symbol', symbol)
    .eq('timeframe', primaryTF)
    .order('close_time', { ascending: false })
    .limit(60);

  if (primaryErr || !primaryCandles || primaryCandles.length < 15) {
    return notReady(`Insufficient ${primaryTF} candle data`);
  }

  // Fetch control timeframe candles (for structural room measurement)
  const { data: controlCandles } = await supabase
    .from('forex_candles')
    .select('open, high, low, close, close_time')
    .eq('symbol', symbol)
    .eq('timeframe', controlTF)
    .order('close_time', { ascending: false })
    .limit(30);

  const primary = [...primaryCandles].reverse() as CandleRow[];
  const control = controlCandles ? [...controlCandles].reverse() as CandleRow[] : [];

  const preconditionsMet: string[] = [];

  // ── PC1: Phase Detection ────────────────────────────────────────────────────
  const { phase, evidence: phaseEvidence, directionLean } = detectPhase(primary, symbol);
  if (phase === 'UNCLEAR') {
    return notReady('Market phase unreadable — no structural identity established');
  }
  preconditionsMet.push('PC1_PHASE_READABLE');

  // ── PC2: Phase-Native Setup Check ──────────────────────────────────────────
  const { passed: pc2Passed, evidence: pc2Evidence } = checkPhaseNativeSetup(phase, primary, directionLean, symbol);
  if (!pc2Passed) {
    return {
      symbol, style, session,
      hunt_state: 'not_ready',
      phase_detected: phase,
      phase_evidence: phaseEvidence,
      preconditions_met: preconditionsMet,
      structural_room_pips: 0,
      structural_room_direction: 'NEUTRAL',
      trigger_state: 'none',
      trigger_evidence: pc2Evidence,
      direction_lean: directionLean,
      hunt_summary: `${phase} phase detected but no phase-native setup material — ${pc2Evidence}`,
      last_scanned_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    };
  }
  preconditionsMet.push('PC2_SETUP_MATERIAL');

  // ── PC3: Structural Room Measurement ───────────────────────────────────────
  const { pips: structuralRoomPips, direction: roomDirection } = measureStructuralRoom(
    primary, control, symbol, directionLean
  );
  if (structuralRoomPips < minRoom) {
    return {
      symbol, style, session,
      hunt_state: 'not_ready',
      phase_detected: phase,
      phase_evidence: phaseEvidence,
      preconditions_met: preconditionsMet,
      structural_room_pips: structuralRoomPips,
      structural_room_direction: roomDirection,
      trigger_state: 'none',
      trigger_evidence: '',
      direction_lean: directionLean,
      hunt_summary: `${phase} phase but only ${structuralRoomPips.toFixed(0)} pips structural room (need ${minRoom}) — geometry too tight for ${style}`,
      last_scanned_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    };
  }
  preconditionsMet.push('PC3_STRUCTURAL_ROOM');

  // ── PC4: Trigger Detection ──────────────────────────────────────────────────
  const { state: triggerState, evidence: triggerEvidence } = detectTrigger(primary, phase, directionLean, symbol);
  if (triggerState !== 'none') {
    preconditionsMet.push('PC4_TRIGGER');
  }

  // ── Determine Hunt State ────────────────────────────────────────────────────
  const huntState: HuntState = triggerState === 'fired' ? 'live' : 'ready';

  const huntSummary = buildHuntSummary(
    phase, huntState, triggerState, triggerEvidence,
    phaseEvidence, structuralRoomPips, directionLean
  );

  return {
    symbol, style, session,
    hunt_state: huntState,
    phase_detected: phase,
    phase_evidence: phaseEvidence,
    preconditions_met: preconditionsMet,
    structural_room_pips: structuralRoomPips,
    structural_room_direction: roomDirection,
    trigger_state: triggerState,
    trigger_evidence: triggerEvidence,
    direction_lean: directionLean,
    hunt_summary: huntSummary,
    last_scanned_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export const handler: Handler = async () => {
  const styles: TradingStyle[] = ['SCALP', 'MICRO_INTRADAY', 'INTRADAY'];
  const session = detectSession();
  const results: HuntAssessment[] = [];

  for (const symbol of SYMBOLS) {
    for (const style of styles) {
      try {
        const assessment = await assessHuntReadiness(symbol, style, session);
        results.push(assessment);
      } catch (err) {
        console.error(`[HuntReadiness] Failed ${symbol} ${style}:`, err);
        results.push({
          symbol, style, session,
          hunt_state: 'not_ready',
          phase_detected: 'UNCLEAR',
          phase_evidence: 'Scanner error',
          preconditions_met: [],
          structural_room_pips: 0,
          structural_room_direction: 'NEUTRAL',
          trigger_state: 'none',
          trigger_evidence: '',
          direction_lean: 'NEUTRAL',
          hunt_summary: 'Scanner error — treating as not ready',
          last_scanned_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        });
      }
    }
  }

  const { error } = await supabase
    .from('alpha_hunt_readiness')
    .upsert(results, { onConflict: 'symbol,style' });

  if (error) {
    console.error('[HuntReadiness] Upsert failed:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }

  const liveCount = results.filter(r => r.hunt_state === 'live').length;
  const readyCount = results.filter(r => r.hunt_state === 'ready').length;

  console.log(`[HuntReadiness] Scan complete: ${liveCount} live, ${readyCount} ready, ${results.length - liveCount - readyCount} not_ready | session=${session}`);

  return {
    statusCode: 200,
    body: JSON.stringify({ live: liveCount, ready: readyCount, session, total: results.length }),
  };
};
