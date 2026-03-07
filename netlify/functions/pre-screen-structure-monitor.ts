/**
 * Pre-Screen Structure Monitor — Scheduled Netlify Function
 *
 * Responsibility:
 * - Runs every 5 minutes (schedule: every-5-min cron)
 * - Evaluates 10+ technical signals for 9 symbols × 3 styles = 27 rows
 * - Uses ONLY pre-aggregated forex_candles (zero external API calls)
 * - Writes full signal confluence data to pre_screen_results via upsert
 *
 * SSOT Compliance:
 * - forex_candles is the single candle data authority
 * - pre_screen_results is the SSOT for structural pre-screen state
 * - SYMBOLS array is the single source of truth — derived from DEFAULT_WATCHLIST (src/config/watchlist.ts)
 * - No business logic duplication with Alpha — this is a READINESS INDICATOR only
 * - Alpha reads the same raw candle data and will reach the same or better conclusions
 *
 * CCIP Governance:
 * - Additive extension: all existing columns (rule1_met, rule2_met, alignment_status) preserved
 * - All writes are upserts (idempotent, no duplicate rows)
 * - Service-role client used (RLS policy: service_role can INSERT/UPDATE)
 * - Errors logged per row — one failure does not abort the entire run
 * - SYMBOLS must always match DEFAULT_WATCHLIST exactly — any change requires CCIP review
 *
 * Purpose for Users:
 * - Tells users WHEN the market structure is most ready for a scan
 * - Higher readiness_score = more technical signals aligning = better moment to run Alpha
 * - Does NOT replace Alpha — gives users the timing signal to launch Alpha at the right moment
 *
 * Signals Evaluated (10 total):
 *  1. BOS (Break of Structure) — last close beyond prior candle's extreme
 *  2. Liquidity Sweep — wick >= 1.5x body in counter-trend direction (existing Rule 2)
 *  3. ChoCH (Change of Character) — two consecutive closes that flip structure
 *  4. Fair Value Gap (FVG) — a 3-candle imbalance gap between candle 1 high and candle 3 low
 *  5. Pin Bar / Long Wick Rejection — wick >= 2x body with small opposite wick
 *  6. Engulfing Candle — body fully engulfs prior candle's body
 *  7. EMA Stack — 9/21/50 EMAs all aligned (9 > 21 > 50 for bull, inverse for bear)
 *  8. Momentum Divergence — price making lower low but RSI making higher low (or inverse)
 *  9. ATR Expansion — last candle's range >= 1.3x ATR(14) — market is moving, not compressed
 * 10. Order Block Proximity — price near a prior bearish or bullish order block candle
 */

import type { Handler } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase-admin';

const supabase = getSupabaseAdmin();

/**
 * SSOT: This array must exactly match DEFAULT_WATCHLIST in src/config/watchlist.ts.
 * Governance: Do NOT add or remove symbols here without a CCIP change request
 * that also updates watchlist.ts. These are the 9 official Pipnosis trading pairs.
 */
const SYMBOLS = [
  'XAUUSD', 'US30', 'NAS100', 'SPX500',
  'EURUSD', 'GBPUSD', 'USDJPY',
  'BTCUSD', 'ETHUSD',
];

const STYLE_TIMEFRAME_MAP: Record<string, string> = {
  SCALP: 'M15',
  MICRO_INTRADAY: 'H1',
  INTRADAY: 'H4',
};

const CANDLE_COUNT = 60;

interface CandleRow {
  open: number;
  high: number;
  low: number;
  close: number;
  close_time: string;
}

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

// ─── EMA calculation ─────────────────────────────────────────────────────────

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

// ─── ATR calculation ─────────────────────────────────────────────────────────

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

// ─── RSI calculation ─────────────────────────────────────────────────────────

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

// ─── Signal weights ───────────────────────────────────────────────────────────

const SIGNAL_WEIGHTS: Record<string, number> = {
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
}

function evaluateAllSignals(candles: CandleRow[]): SignalResult {
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
  };

  if (candles.length < 10) return fallback;

  const closes = candles.map((c) => c.close);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];

  const bullSignals: string[] = [];
  const bearSignals: string[] = [];

  // ── Signal 1: BOS (Break of Structure) ──────────────────────────────────
  const bullBOS = last.close > prev.high;
  const bearBOS = last.close < prev.low;
  const rule1_met = bullBOS || bearBOS;
  const rule1Direction: 'BUY' | 'SELL' | 'NEUTRAL' = bullBOS ? 'BUY' : bearBOS ? 'SELL' : 'NEUTRAL';
  const rule1_detail = rule1_met
    ? `${rule1Direction === 'BUY' ? 'Bull' : 'Bear'} BOS: close ${last.close.toFixed(5)} ${bullBOS ? '>' : '<'} prior ${bullBOS ? 'high' : 'low'} ${(bullBOS ? prev.high : prev.low).toFixed(5)}`
    : `No BOS: close ${last.close.toFixed(5)} within [${prev.low.toFixed(5)} – ${prev.high.toFixed(5)}]`;

  if (bullBOS) bullSignals.push('BOS');
  if (bearBOS) bearSignals.push('BOS');

  // ── Signal 2: Liquidity Sweep (existing Rule 2) ──────────────────────────
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
  if (!rule2_met) {
    rule2_detail = 'No sweep wick >= 1.5x body in last 3 candles';
  }

  // ── Signal 3: ChoCH (Change of Character) ────────────────────────────────
  // Two consecutive closes flipping structure direction
  const prev3 = candles[candles.length - 4];
  if (prev3) {
    const priorWasBearish = prev2.close < prev3.close;
    const nowBullish = prev.close > prev2.close && last.close > prev.close;
    const priorWasBullish = prev2.close > prev3.close;
    const nowBearish = prev.close < prev2.close && last.close < prev.close;

    if (priorWasBearish && nowBullish) {
      bullSignals.push('CHOCH');
    } else if (priorWasBullish && nowBearish) {
      bearSignals.push('CHOCH');
    }
  }

  // ── Signal 4: Fair Value Gap (FVG) ────────────────────────────────────────
  // Bullish FVG: candle[i-2].high < candle[i].low (gap between them)
  // Bearish FVG: candle[i-2].low > candle[i].high (gap between them)
  const fvgBull = prev2.high < last.low;
  const fvgBear = prev2.low > last.high;
  if (fvgBull) bullSignals.push('FVG');
  if (fvgBear) bearSignals.push('FVG');

  // ── Signal 5: Pin Bar / Long Wick Rejection ───────────────────────────────
  // Wick >= 2x body, opposite wick <= 0.3x body
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
  // Bullish: price makes lower low but RSI makes higher low over last 10 candles
  // Bearish: price makes higher high but RSI makes lower high
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

    // Bullish div: price near its low but RSI not at its low
    const priceLowPct = (last.close - priceMin) / (priceMax - priceMin + 0.0001);
    const rsiLowPct = (recentRSI[recentRSI.length - 1] - rsiMin) / (rsiMax - rsiMin + 0.0001);
    if (priceLowPct < 0.2 && rsiLowPct > 0.3 && rsiAtPriceMin < recentRSI[recentRSI.length - 1]) {
      bullSignals.push('MOMENTUM_DIV');
    }
    // Bearish div: price near its high but RSI not at its high
    const priceHighPct = (last.close - priceMin) / (priceMax - priceMin + 0.0001);
    if (priceHighPct > 0.8 && rsiLowPct < 0.7 && rsiAtPriceMax > recentRSI[recentRSI.length - 1]) {
      bearSignals.push('MOMENTUM_DIV');
    }
  }

  // ── Signal 9: ATR Expansion ───────────────────────────────────────────────
  const atr = calcATR(candles, 14);
  if (atr > 0) {
    const lastRange = last.high - last.low;
    if (lastRange >= atr * 1.3) {
      // ATR expansion is directionally neutral — assign to whichever direction we have more signals
      const lastIsBull = last.close > last.open;
      if (lastIsBull) bullSignals.push('ATR_EXPANSION');
      else bearSignals.push('ATR_EXPANSION');
    }
  }

  // ── Signal 10: Order Block Proximity ─────────────────────────────────────
  // Look in last 20 candles for a strong move candle (body >= 1.8x ATR)
  // Price returning to test that candle's body zone
  if (atr > 0 && candles.length >= 20) {
    const lookback = candles.slice(-20, -3);
    for (const ob of lookback) {
      const obBody = Math.abs(ob.close - ob.open);
      if (obBody < atr * 1.8) continue;
      const obIsBull = ob.close > ob.open;
      const obHigh = Math.max(ob.open, ob.close);
      const obLow = Math.min(ob.open, ob.close);
      // Price returning to test the order block zone
      const isRetestingOB = last.low <= obHigh && last.high >= obLow;
      if (isRetestingOB) {
        if (obIsBull) bullSignals.push('ORDER_BLOCK');
        else bearSignals.push('ORDER_BLOCK');
        break;
      }
    }
  }

  // ── Direction resolution ──────────────────────────────────────────────────
  // Deduplicate signals (in case multiple candles fire same signal)
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

  // Further refine direction from overall signal count
  if (direction_bias === 'NEUTRAL') {
    if (uniqueBull.length > uniqueBear.length) direction_bias = 'BUY';
    else if (uniqueBear.length > uniqueBull.length) direction_bias = 'SELL';
  }

  const dominantSignals = direction_bias === 'BUY' ? uniqueBull : direction_bias === 'SELL' ? uniqueBear : [];
  const signals_firing = direction_bias === 'BUY' ? uniqueBull : direction_bias === 'SELL' ? uniqueBear : [...uniqueBull, ...uniqueBear];

  // ── Compute readiness score ───────────────────────────────────────────────
  let rawScore = 0;
  for (const sig of signals_firing) {
    rawScore += SIGNAL_WEIGHTS[sig] ?? 10;
  }

  // Max possible score ≈ sum of all weights ≈ 141
  // Normalise to 0-100
  const maxScore = Object.values(SIGNAL_WEIGHTS).reduce((a, b) => a + b, 0);
  const readiness_score = Math.min(100, Math.round((rawScore / maxScore) * 100));

  const readiness_tier: 'GREEN' | 'YELLOW' | 'RED' =
    readiness_score >= 65 ? 'GREEN' : readiness_score >= 35 ? 'YELLOW' : 'RED';

  // ── Alignment status (preserve existing logic) ────────────────────────────
  let alignment_status: SignalResult['alignment_status'] = 'BLOCKED';
  if (rule1_met && rule2_met) {
    alignment_status = direction_bias !== 'NEUTRAL' ? 'ALIGNED' : 'BOTH_RULES_MET';
  } else if (rule1_met) {
    alignment_status = 'RULE1_ONLY';
  } else if (rule2_met) {
    alignment_status = 'RULE2_ONLY';
  }

  // ── Dominant signal ───────────────────────────────────────────────────────
  const dominant_signal = dominantSignals.length > 0
    ? dominantSignals.reduce((best, sig) => (SIGNAL_WEIGHTS[sig] ?? 0) > (SIGNAL_WEIGHTS[best] ?? 0) ? sig : best, dominantSignals[0])
    : '';

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
  };
}

const handler: Handler = async () => {
  const startedAt = Date.now();
  let processed = 0;
  let failed = 0;

  for (const symbol of SYMBOLS) {
    for (const [style, timeframe] of Object.entries(STYLE_TIMEFRAME_MAP)) {
      try {
        const candles = await getCandlesForSymbol(symbol, timeframe);
        const result = evaluateAllSignals(candles);

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
  console.log(`[PreScreenMonitor] Complete: ${processed} processed, ${failed} failed in ${durationMs}ms`);

  return {
    statusCode: 200,
    body: JSON.stringify({ processed, failed, durationMs }),
  };
};

export { handler };
