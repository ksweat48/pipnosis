/**
 * Pre-Screen Structure Monitor — Scheduled Netlify Function
 *
 * CCIP-2026-0409A: Style Timeframe Realignment
 *
 * Responsibility:
 * - Runs every 5 minutes (schedule: every-5-min cron)
 * - Evaluates 10+ technical signals for 9 symbols × 3 styles = 27 rows
 * - Uses ONLY pre-aggregated forex_candles (zero external API calls)
 * - Detects current market phase (ACCUMULATION/EXPANSION/DISTRIBUTION/RETRACEMENT/REVERSAL)
 * - Applies phase-specific signal weight multipliers from alpha_phase_confluence_calibration
 * - Writes phase-contextual signal confluence data to pre_screen_results via upsert
 *
 * SSOT Compliance:
 * - forex_candles is the single candle data authority
 * - pre_screen_results is the SSOT for structural pre-screen state
 * - alpha_phase_confluence_calibration is the SSOT for phase-specific weight multipliers
 * - SYMBOLS array is the single source of truth — derived from DEFAULT_WATCHLIST
 * - No business logic duplication with Alpha — this is a READINESS INDICATOR only
 *
 * Timeframe Governance (CCIP-2026-0409A):
 * - SCALP:          M1  — fastest signals, immediate price action
 * - MICRO_INTRADAY: M5  — near-term structure, faster than intraday
 * - INTRADAY:       M15 — intraday structural context
 * Each style now uses its canonical controlling timeframe. Indicators are
 * computed exclusively on that timeframe's candle data.
 *
 * Calibration Keys (CCIP-2026-0409A):
 * - SCALP → 'SCALP' calibration
 * - MICRO_INTRADAY → 'MICRO_INTRADAY' calibration (own rows, M5-tuned)
 * - INTRADAY → 'INTRADAY' calibration (own rows, M15-tuned, independent of SWING)
 */

import type { Handler } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase-admin';

const supabase = getSupabaseAdmin();

/**
 * SSOT: Must match DEFAULT_WATCHLIST in src/config/watchlist.ts.
 */
const SYMBOLS = [
  'XAUUSD', 'US30', 'NAS100', 'SPX500',
  'EURUSD', 'GBPUSD', 'USDJPY',
  'BTCUSD', 'ETHUSD',
];

const STYLE_TIMEFRAME_MAP: Record<string, string> = {
  SCALP: 'M1',
  MICRO_INTRADAY: 'M5',
  INTRADAY: 'M15',
};

/**
 * Maps each style to its own calibration key.
 * CCIP-2026-0409A: MICRO_INTRADAY and INTRADAY each have independent calibration rows.
 */
function styleToCalibrationKey(style: string): 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY' | 'SWING' {
  if (style === 'SCALP') return 'SCALP';
  if (style === 'MICRO_INTRADAY') return 'MICRO_INTRADAY';
  if (style === 'INTRADAY') return 'INTRADAY';
  return 'SWING';
}

const CANDLE_COUNT = 60;

type MarketPhase = 'ACCUMULATION' | 'EXPANSION' | 'DISTRIBUTION' | 'RETRACEMENT' | 'REVERSAL' | 'UNKNOWN';

interface CandleRow {
  open: number;
  high: number;
  low: number;
  close: number;
  close_time: string;
}

interface PhaseCalibrationRow {
  market_phase: string;
  trade_style: string;
  min_signals_required: number;
  load_bearing_dimensions: string[];
  signal_weight_multipliers: Record<string, number>;
  expected_confidence_band_min: number;
  expected_confidence_band_max: number;
  historical_win_rate: number | null;
  sample_size: number;
  rationale: string;
}

type CalibrationMatrix = Record<string, Record<string, PhaseCalibrationRow>>;

async function getCandlesForSymbol(symbol: string, timeframe: string): Promise<CandleRow[]> {
  const { data, error } = await supabase
    .from('forex_candles')
    .select('open, high, low, close, close_time')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .order('close_time', { ascending: false })
    .limit(CANDLE_COUNT);

  if (error || !data) return [];
  return (data as CandleRow[]).reverse();
}

async function loadCalibrationMatrix(): Promise<CalibrationMatrix> {
  const { data, error } = await supabase.rpc('get_phase_calibration_matrix');
  if (error || !data) {
    console.warn('[PreScreenMonitor] Could not load calibration matrix — using flat weights');
    return {};
  }
  const matrix: CalibrationMatrix = {};
  for (const row of data as PhaseCalibrationRow[]) {
    if (!matrix[row.market_phase]) matrix[row.market_phase] = {};
    matrix[row.market_phase][row.trade_style] = row;
  }
  return matrix;
}

// ─── EMA calculation ──────────────────────────────────────────────────────────

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

// ─── ATR calculation ──────────────────────────────────────────────────────────

function calcATR(candles: CandleRow[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close),
    );
    trs.push(tr);
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ─── RSI calculation ──────────────────────────────────────────────────────────

function calcRSI(closes: number[], period = 14): number[] {
  if (closes.length < period + 1) return [];
  const rsi: number[] = [];
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;

  const firstRS = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsi.push(100 - 100 / (1 + firstRS));

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(100 - 100 / (1 + rs));
  }
  return rsi;
}

// ─── Market phase detection ───────────────────────────────────────────────────
/**
 * Detects market phase from the last 20 candles using the same evidence
 * Alpha reads in Q12. This keeps the pre-screen and Alpha in alignment.
 *
 * Detection logic:
 * - REVERSAL: A BOS (close beyond prior swing) has fired against the recent trend
 * - DISTRIBUTION: Bodies shrinking + wicks growing + failed new high/low
 * - EXPANSION: Consecutive new highs/lows + growing bodies + ATR expansion
 * - RETRACEMENT: Counter-direction move of 2-5 candles against established trend
 * - ACCUMULATION: Equal highs and lows, small bodies, no clear direction
 */
function detectMarketPhase(candles: CandleRow[], atr: number): MarketPhase {
  if (candles.length < 20) return 'UNKNOWN';

  const recent = candles.slice(-20);
  const last = recent[recent.length - 1];
  const closes = recent.map(c => c.close);
  const bodies = recent.map(c => Math.abs(c.close - c.open));
  const avgBody = bodies.reduce((a, b) => a + b, 0) / bodies.length;
  const recentBodies = bodies.slice(-5);
  const avgRecentBody = recentBodies.reduce((a, b) => a + b, 0) / recentBodies.length;

  // Swing high/low over lookback
  const highs = recent.map(c => c.high);
  const lows = recent.map(c => c.low);
  const priorHigh = Math.max(...highs.slice(0, 10));
  const priorLow = Math.min(...lows.slice(0, 10));
  const recentHigh = Math.max(...highs.slice(10));
  const recentLow = Math.min(...lows.slice(10));

  // Determine prior direction from first half of lookback
  const firstClose = closes[0];
  const midClose = closes[9];
  const priorBullish = midClose > firstClose;

  // REVERSAL: Last close has crossed the prior swing opposite to direction
  const bullReversal = priorBullish && last.close < priorLow;
  const bearReversal = !priorBullish && last.close > priorHigh;
  if (bullReversal || bearReversal) return 'REVERSAL';

  // EXPANSION: Sequential new highs (bull) or new lows (bear) with body growth
  const makingNewHighs = recentHigh > priorHigh && avgRecentBody >= avgBody * 0.9;
  const makingNewLows = recentLow < priorLow && avgRecentBody >= avgBody * 0.9;
  if (makingNewHighs || makingNewLows) {
    // Check for DISTRIBUTION: bodies shrinking despite new high/low
    const firstHalfBody = bodies.slice(-10, -5).reduce((a, b) => a + b, 0) / 5;
    const secondHalfBody = bodies.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const upperWickRatio = recent.slice(-5).reduce((acc, c) => {
      const body = Math.abs(c.close - c.open);
      const upperWick = c.high - Math.max(c.open, c.close);
      return acc + (body > 0 ? upperWick / body : 0);
    }, 0) / 5;

    if (secondHalfBody < firstHalfBody * 0.7 && upperWickRatio > 0.6 && makingNewHighs) {
      return 'DISTRIBUTION';
    }
    if (secondHalfBody < firstHalfBody * 0.7 && makingNewLows) {
      return 'DISTRIBUTION';
    }
    return 'EXPANSION';
  }

  // RETRACEMENT: Counter-trend move against established direction, 3-8 candles
  const last5Closes = closes.slice(-5);
  const last5Bullish = last5Closes[4] > last5Closes[0];
  const establishedBullish = closes[14] > closes[5];
  const retracing = (establishedBullish && !last5Bullish) || (!establishedBullish && last5Bullish);
  const retracementDepth = Math.abs(last.close - closes[14]);
  if (retracing && retracementDepth < atr * 3 && retracementDepth > atr * 0.5) {
    return 'RETRACEMENT';
  }

  // ACCUMULATION: Low range, small bodies, no sustained direction
  const rangeSize = recentHigh - recentLow;
  const isCompressed = rangeSize < atr * 2.5 && avgRecentBody < avgBody * 0.8;
  if (isCompressed) return 'ACCUMULATION';

  // Default: if expanding but not cleanly directional
  return 'EXPANSION';
}

// ─── Baseline signal weights (flat, before phase multipliers) ─────────────────

const BASE_SIGNAL_WEIGHTS: Record<string, number> = {
  BOS: 20,
  LIQUIDITY_SWEEP: 15,
  CHOCH: 18,
  FVG: 12,
  PIN_BAR: 14,
  ENGULFING: 13,
  EMA_STACK: 16,
  MOMENTUM_DIV: 11,
  ATR_EXPANSION: 10,
  ORDER_BLOCK: 12,
};

/**
 * Maps Q7 dimension names to pre-screen signal names for load-bearing display.
 * Allows the UI to highlight which signals are load-bearing in the current phase.
 */
const DIMENSION_TO_SIGNAL_MAP: Record<string, string[]> = {
  STRUCTURE: ['BOS', 'CHOCH', 'ORDER_BLOCK'],
  LIQUIDITY: ['LIQUIDITY_SWEEP', 'FVG'],
  TIMING: ['ATR_EXPANSION'],
  TREND: ['BOS', 'EMA_STACK'],
  MOMENTUM: ['MOMENTUM_DIV', 'ATR_EXPANSION', 'ENGULFING'],
  PATTERN: ['PIN_BAR', 'ENGULFING'],
  CHOCH: ['CHOCH'],
  EMA_STACK: ['EMA_STACK'],
  BOS: ['BOS'],
};

function getPhaseWeights(
  calibrationMatrix: CalibrationMatrix,
  phase: MarketPhase,
  styleKey: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY' | 'SWING',
): { weights: Record<string, number>; calibration: PhaseCalibrationRow | null } {
  if (phase === 'UNKNOWN' || !calibrationMatrix[phase]) {
    return { weights: { ...BASE_SIGNAL_WEIGHTS }, calibration: null };
  }

  const cal = calibrationMatrix[phase][styleKey];
  if (!cal || !cal.signal_weight_multipliers) {
    return { weights: { ...BASE_SIGNAL_WEIGHTS }, calibration: null };
  }

  const adjusted: Record<string, number> = {};
  for (const [signal, baseWeight] of Object.entries(BASE_SIGNAL_WEIGHTS)) {
    const multiplier = cal.signal_weight_multipliers[signal] ?? 1.0;
    adjusted[signal] = Math.round(baseWeight * multiplier * 10) / 10;
  }

  return { weights: adjusted, calibration: cal };
}

/**
 * Determines which firing signals are load-bearing for the current phase.
 * Used by the UI to highlight the key signals.
 */
function identifyLoadBearingSignals(
  firingSignals: string[],
  calibration: PhaseCalibrationRow | null,
): string[] {
  if (!calibration || !calibration.load_bearing_dimensions) return [];

  const loadBearingSignals: string[] = [];
  for (const dimension of calibration.load_bearing_dimensions) {
    const signals = DIMENSION_TO_SIGNAL_MAP[dimension] ?? [];
    for (const sig of signals) {
      if (firingSignals.includes(sig) && !loadBearingSignals.includes(sig)) {
        loadBearingSignals.push(sig);
      }
    }
  }
  return loadBearingSignals;
}

// ─── Full signal evaluation ───────────────────────────────────────────────────

interface SignalResult {
  rule1_met: boolean;
  rule2_met: boolean;
  rule1_detail: string;
  rule2_detail: string;
  direction_bias: 'BUY' | 'SELL' | 'NEUTRAL';
  alignment_status: 'ALIGNED' | 'RULE1_ONLY' | 'RULE2_ONLY' | 'BOTH_RULES_MET' | 'BLOCKED';
  signals_firing: string[];
  bull_signals: string[];
  bear_signals: string[];
  readiness_score: number;
  readiness_tier: 'GREEN' | 'YELLOW' | 'RED';
  signal_count: number;
  dominant_signal: string;
  signal_summary: string;
  market_phase: MarketPhase;
  load_bearing_signals: string[];
  phase_min_signals: number;
  phase_confidence_band_min: number;
  phase_confidence_band_max: number;
}

function evaluateAllSignals(
  candles: CandleRow[],
  calibrationMatrix: CalibrationMatrix,
  styleKey: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY' | 'SWING',
): SignalResult {
  const fallback: SignalResult = {
    rule1_met: false,
    rule2_met: false,
    rule1_detail: `Insufficient candle data (${candles.length} of 10 required)`,
    rule2_detail: '',
    direction_bias: 'NEUTRAL',
    alignment_status: 'BLOCKED',
    signals_firing: [],
    bull_signals: [],
    bear_signals: [],
    readiness_score: 0,
    readiness_tier: 'RED',
    signal_count: 0,
    dominant_signal: '',
    signal_summary: 'Insufficient data',
    market_phase: 'UNKNOWN',
    load_bearing_signals: [],
    phase_min_signals: 3,
    phase_confidence_band_min: 50,
    phase_confidence_band_max: 65,
  };

  if (candles.length < 10) return fallback;

  const closes = candles.map((c) => c.close);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];

  const bullSignals: string[] = [];
  const bearSignals: string[] = [];

  const atr = calcATR(candles, 14);
  const phase = detectMarketPhase(candles, atr);
  const { weights: phaseWeights, calibration } = getPhaseWeights(calibrationMatrix, phase, styleKey);

  // ── Signal 1: BOS (Break of Structure) ───────────────────────────────────
  const bullBOS = last.close > prev.high;
  const bearBOS = last.close < prev.low;
  const rule1_met = bullBOS || bearBOS;
  const rule1Direction: 'BUY' | 'SELL' | 'NEUTRAL' = bullBOS ? 'BUY' : bearBOS ? 'SELL' : 'NEUTRAL';
  const rule1_detail = rule1_met
    ? `${rule1Direction === 'BUY' ? 'Bull' : 'Bear'} BOS: close ${last.close.toFixed(5)} ${bullBOS ? '>' : '<'} prior ${bullBOS ? 'high' : 'low'} ${(bullBOS ? prev.high : prev.low).toFixed(5)}`
    : `No BOS: close ${last.close.toFixed(5)} within [${prev.low.toFixed(5)} – ${prev.high.toFixed(5)}]`;

  if (bullBOS) bullSignals.push('BOS');
  if (bearBOS) bearSignals.push('BOS');

  // ── Signal 2: Liquidity Sweep ─────────────────────────────────────────────
  const recent3 = candles.slice(-3);
  let rule2_met = false;
  let rule2_detail = '';
  let sweepDir: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';

  for (const c of recent3) {
    const body = Math.abs(c.close - c.open);
    if (body === 0) continue;
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerRatio = lowerWick / body;
    const upperRatio = upperWick / body;

    if (lowerRatio >= 1.5) {
      rule2_met = true;
      sweepDir = 'BUY';
      rule2_detail = `Bull sweep wick: lower wick ${lowerRatio.toFixed(2)}x body`;
      bullSignals.push('LIQUIDITY_SWEEP');
      break;
    }
    if (upperRatio >= 1.5) {
      rule2_met = true;
      sweepDir = 'SELL';
      rule2_detail = `Bear sweep wick: upper wick ${upperRatio.toFixed(2)}x body`;
      bearSignals.push('LIQUIDITY_SWEEP');
      break;
    }
  }
  if (!rule2_met) rule2_detail = 'No sweep wick >= 1.5x body in last 3 candles';

  // ── Signal 3: ChoCH (Change of Character) ────────────────────────────────
  const prev3 = candles[candles.length - 4];
  if (prev3) {
    const priorWasBearish = prev2.close < prev3.close;
    const nowBullish = prev.close > prev2.close && last.close > prev.close;
    const priorWasBullish = prev2.close > prev3.close;
    const nowBearish = prev.close < prev2.close && last.close < prev.close;

    if (priorWasBearish && nowBullish) bullSignals.push('CHOCH');
    else if (priorWasBullish && nowBearish) bearSignals.push('CHOCH');
  }

  // ── Signal 4: Fair Value Gap (FVG) ────────────────────────────────────────
  const fvgBull = prev2.high < last.low;
  const fvgBear = prev2.low > last.high;
  if (fvgBull) bullSignals.push('FVG');
  if (fvgBear) bearSignals.push('FVG');

  // ── Signal 5: Pin Bar / Long Wick Rejection ───────────────────────────────
  const checkPinBar = (c: CandleRow): 'BUY' | 'SELL' | null => {
    const body = Math.abs(c.close - c.open);
    if (body === 0) return null;
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const upperWick = c.high - Math.max(c.open, c.close);
    if (lowerWick >= body * 2 && upperWick <= body * 0.3) return 'BUY';
    if (upperWick >= body * 2 && lowerWick <= body * 0.3) return 'SELL';
    return null;
  };

  for (const c of [last, prev]) {
    const pinDir = checkPinBar(c);
    if (pinDir === 'BUY') { bullSignals.push('PIN_BAR'); break; }
    if (pinDir === 'SELL') { bearSignals.push('PIN_BAR'); break; }
  }

  // ── Signal 6: Engulfing Candle ────────────────────────────────────────────
  const lastBody = Math.abs(last.close - last.open);
  const prevBody = Math.abs(prev.close - prev.open);
  const bullEngulf = last.close > last.open && last.open < prev.close && last.close > prev.open && lastBody > prevBody;
  const bearEngulf = last.close < last.open && last.open > prev.close && last.close < prev.open && lastBody > prevBody;
  if (bullEngulf) bullSignals.push('ENGULFING');
  if (bearEngulf) bearSignals.push('ENGULFING');

  // ── Signal 7: EMA Stack (9/21/50) ────────────────────────────────────────
  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const ema50 = calcEMA(closes, 50);

  if (ema9.length > 0 && ema21.length > 0 && ema50.length > 0) {
    const e9 = ema9[ema9.length - 1];
    const e21 = ema21[ema21.length - 1];
    const e50 = ema50[ema50.length - 1];
    if (e9 > e21 && e21 > e50) bullSignals.push('EMA_STACK');
    if (e9 < e21 && e21 < e50) bearSignals.push('EMA_STACK');
  }

  // ── Signal 8: Momentum Divergence (RSI) ──────────────────────────────────
  const rsiValues = calcRSI(closes, 14);
  if (rsiValues.length >= 10) {
    const recentCloses = closes.slice(-10);
    const recentRSI = rsiValues.slice(-10);

    const priceMin = Math.min(...recentCloses);
    const priceMax = Math.max(...recentCloses);
    const rsiAtPriceMin = recentRSI[recentCloses.indexOf(priceMin)];
    const rsiAtPriceMax = recentRSI[recentCloses.indexOf(priceMax)];
    const rsiMin = Math.min(...recentRSI);
    const rsiMax = Math.max(...recentRSI);

    const priceLowPct = (last.close - priceMin) / (priceMax - priceMin + 0.0001);
    const rsiLowPct = (recentRSI[recentRSI.length - 1] - rsiMin) / (rsiMax - rsiMin + 0.0001);
    if (priceLowPct < 0.2 && rsiLowPct > 0.3 && rsiAtPriceMin < recentRSI[recentRSI.length - 1]) {
      bullSignals.push('MOMENTUM_DIV');
    }
    const priceHighPct = (last.close - priceMin) / (priceMax - priceMin + 0.0001);
    if (priceHighPct > 0.8 && rsiLowPct < 0.7 && rsiAtPriceMax > recentRSI[recentRSI.length - 1]) {
      bearSignals.push('MOMENTUM_DIV');
    }
  }

  // ── Signal 9: ATR Expansion ───────────────────────────────────────────────
  if (atr > 0) {
    const lastRange = last.high - last.low;
    if (lastRange >= atr * 1.3) {
      const lastIsBull = last.close > last.open;
      if (lastIsBull) bullSignals.push('ATR_EXPANSION');
      else bearSignals.push('ATR_EXPANSION');
    }
  }

  // ── Signal 10: Order Block Proximity ─────────────────────────────────────
  if (atr > 0 && candles.length >= 20) {
    const lookback = candles.slice(-20, -3);
    for (const ob of lookback) {
      const obBody = Math.abs(ob.close - ob.open);
      if (obBody < atr * 1.8) continue;
      const obIsBull = ob.close > ob.open;
      const obHigh = Math.max(ob.open, ob.close);
      const obLow = Math.min(ob.open, ob.close);
      const isRetestingOB = last.low <= obHigh && last.high >= obLow;
      if (isRetestingOB) {
        if (obIsBull) bullSignals.push('ORDER_BLOCK');
        else bearSignals.push('ORDER_BLOCK');
        break;
      }
    }
  }

  // ── Direction resolution ──────────────────────────────────────────────────
  const uniqueBull = [...new Set(bullSignals)];
  const uniqueBear = [...new Set(bearSignals)];

  let direction_bias: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
  if (rule1_met && rule2_met) {
    direction_bias = rule1Direction === sweepDir ? rule1Direction : 'NEUTRAL';
  } else if (rule1_met) {
    direction_bias = rule1Direction;
  } else if (rule2_met) {
    direction_bias = sweepDir;
  }

  if (direction_bias === 'NEUTRAL') {
    if (uniqueBull.length > uniqueBear.length) direction_bias = 'BUY';
    else if (uniqueBear.length > uniqueBull.length) direction_bias = 'SELL';
  }

  const dominantSignals = direction_bias === 'BUY' ? uniqueBull : direction_bias === 'SELL' ? uniqueBear : [];
  const signals_firing = direction_bias === 'BUY' ? uniqueBull : direction_bias === 'SELL' ? uniqueBear : [...uniqueBull, ...uniqueBear];

  // ── Phase-aware readiness score ───────────────────────────────────────────
  let rawScore = 0;
  for (const sig of signals_firing) {
    rawScore += phaseWeights[sig] ?? BASE_SIGNAL_WEIGHTS[sig] ?? 10;
  }

  // Max possible score uses phase-adjusted weights
  const maxScore = Object.values(phaseWeights).reduce((a, b) => a + b, 0);
  const readiness_score = Math.min(100, Math.round((rawScore / maxScore) * 100));

  // Phase-relative tier thresholds
  // In phases with fewer required signals (ACCUMULATION, RETRACEMENT), 3 load-bearing
  // signals should still reach YELLOW. We use calibration band to inform tier.
  const phaseMinSignals = calibration?.min_signals_required ?? 3;
  const phaseBandMin = calibration?.expected_confidence_band_min ?? 50;

  const greenThreshold = phaseBandMin >= 60 ? 60 : 65;
  const yellowThreshold = phaseMinSignals <= 3 ? 30 : 35;

  const readiness_tier: 'GREEN' | 'YELLOW' | 'RED' =
    readiness_score >= greenThreshold ? 'GREEN' : readiness_score >= yellowThreshold ? 'YELLOW' : 'RED';

  // ── Alignment status ──────────────────────────────────────────────────────
  let alignment_status: SignalResult['alignment_status'] = 'BLOCKED';
  if (rule1_met && rule2_met) {
    alignment_status = direction_bias !== 'NEUTRAL' ? 'ALIGNED' : 'BOTH_RULES_MET';
  } else if (rule1_met) {
    alignment_status = 'RULE1_ONLY';
  } else if (rule2_met) {
    alignment_status = 'RULE2_ONLY';
  }

  // ── Dominant signal (by phase weight) ────────────────────────────────────
  const dominant_signal = dominantSignals.length > 0
    ? dominantSignals.reduce((best, sig) => (phaseWeights[sig] ?? 0) > (phaseWeights[best] ?? 0) ? sig : best, dominantSignals[0])
    : '';

  // ── Load-bearing signals for this phase ───────────────────────────────────
  const load_bearing_signals = identifyLoadBearingSignals(signals_firing, calibration);

  // ── Signal summary ────────────────────────────────────────────────────────
  const sigCount = signals_firing.length;
  let signal_summary = '';
  if (sigCount === 0) {
    signal_summary = 'No signals detected — structure unclear';
  } else if (direction_bias === 'NEUTRAL') {
    signal_summary = `${sigCount} signal${sigCount > 1 ? 's' : ''} — direction unclear`;
  } else {
    const tierWord = readiness_tier === 'GREEN' ? 'strong setup' : readiness_tier === 'YELLOW' ? 'developing setup' : 'weak setup';
    const topSigs = signals_firing.slice(0, 3).join(', ');
    signal_summary = `${sigCount} signal${sigCount > 1 ? 's' : ''} aligned ${direction_bias} — ${tierWord} (${topSigs})`;
  }

  return {
    rule1_met,
    rule2_met,
    rule1_detail,
    rule2_detail,
    direction_bias,
    alignment_status,
    signals_firing,
    bull_signals: uniqueBull,
    bear_signals: uniqueBear,
    readiness_score,
    readiness_tier,
    signal_count: sigCount,
    dominant_signal,
    signal_summary,
    market_phase: phase,
    load_bearing_signals,
    phase_min_signals: phaseMinSignals,
    phase_confidence_band_min: calibration?.expected_confidence_band_min ?? 50,
    phase_confidence_band_max: calibration?.expected_confidence_band_max ?? 65,
  };
}

const handler: Handler = async () => {
  const startedAt = Date.now();
  let processed = 0;
  let failed = 0;

  const calibrationMatrix = await loadCalibrationMatrix();
  const hasCalibration = Object.keys(calibrationMatrix).length > 0;
  if (!hasCalibration) {
    console.warn('[PreScreenMonitor] Running with flat weights — no calibration data available');
  }

  for (const symbol of SYMBOLS) {
    for (const [style, timeframe] of Object.entries(STYLE_TIMEFRAME_MAP)) {
      try {
        const candles = await getCandlesForSymbol(symbol, timeframe);
        const styleKey = styleToCalibrationKey(style);
        const result = evaluateAllSignals(candles, calibrationMatrix, styleKey);

        const { error } = await supabase
          .from('pre_screen_results')
          .upsert(
            {
              symbol,
              style,
              controlling_timeframe: timeframe,
              alignment_status: result.alignment_status,
              direction_bias: result.direction_bias,
              rule1_met: result.rule1_met,
              rule2_met: result.rule2_met,
              rule1_detail: result.rule1_detail,
              rule2_detail: result.rule2_detail,
              signals_firing: result.signals_firing,
              bull_signals: result.bull_signals,
              bear_signals: result.bear_signals,
              readiness_score: result.readiness_score,
              readiness_tier: result.readiness_tier,
              signal_count: result.signal_count,
              dominant_signal: result.dominant_signal,
              signal_summary: result.signal_summary,
              market_phase: result.market_phase,
              load_bearing_signals: result.load_bearing_signals,
              phase_min_signals: result.phase_min_signals,
              phase_confidence_band_min: result.phase_confidence_band_min,
              phase_confidence_band_max: result.phase_confidence_band_max,
              last_checked_at: new Date().toISOString(),
            },
            { onConflict: 'symbol,style,controlling_timeframe' },
          );

        if (error) {
          console.error(`[PreScreenMonitor] Upsert failed for ${symbol}/${style}:`, error.message);
          failed++;
        } else {
          processed++;
        }
      } catch (err) {
        console.error(
          `[PreScreenMonitor] Error processing ${symbol}/${style}:`,
          err instanceof Error ? err.message : String(err),
        );
        failed++;
      }
    }
  }

  const durationMs = Date.now() - startedAt;
  console.log(`[PreScreenMonitor] Complete: ${processed} processed, ${failed} failed in ${durationMs}ms (phase-calibrated: ${hasCalibration})`);

  return {
    statusCode: 200,
    body: JSON.stringify({ processed, failed, durationMs, phaseCalibrated: hasCalibration }),
  };
};

export { handler };
