/**
 * Market Behavior Scanner — Scheduled Netlify Function
 *
 * Responsibility:
 * - Runs every 3 minutes
 * - Detects raw market behaviors (momentum, compression, EMA shifts, etc.)
 *   for 9 symbols × 3 styles = 27 rows
 * - Uses ONLY pre-aggregated forex_candles (zero external API calls)
 * - Writes market_behavior_signals via upsert
 *
 * Governance:
 * - This is NOT a trade signal system — Alpha is the sole trade authority
 * - This only answers: "Is something interesting happening with this pair?"
 * - No readiness scoring, no structure gates, no trade pre-approval
 * - Pure candle behavior detection to guide user attention
 *
 * Signal Categories:
 *   MOMENTUM    — Engulfing, consecutive trend candles, strong closes, spikes
 *   COMPRESSION — Range tightening, inside bar breakouts, compression breaks
 *   EMA         — Close above/below 20 EMA, slope changes, rejections
 *   STRUCTURE   — Swing breaks, wick rejections, outside bars
 *   VOLATILITY  — ATR spikes, range expansion
 */

import type { Handler } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase-admin';

const supabase = getSupabaseAdmin();

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

const CANDLE_COUNT = 50;

type TradingStyle = 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';
type DirectionLean = 'BUY' | 'SELL' | 'NEUTRAL';
type HeatLevel = 'QUIET' | 'ACTIVE' | 'HOT';
type SignalKey =
  | 'LARGE_ENGULFING'
  | 'CONSECUTIVE_TREND'
  | 'STRONG_CLOSE'
  | 'MOMENTUM_SPIKE'
  | 'VELOCITY_CANDLE'
  | 'COMPRESSION_FORMING'
  | 'COMPRESSION_BREAK'
  | 'INSIDE_BAR_BREAK'
  | 'CLOSE_ABOVE_20EMA'
  | 'CLOSE_BELOW_20EMA'
  | 'EMA_SLOPE_CHANGE'
  | 'PRICE_EMA_REJECTION'
  | 'SWING_BREAK'
  | 'WICK_REJECTION'
  | 'OUTSIDE_BAR'
  | 'ATR_SPIKE'
  | 'RANGE_EXPANSION';

interface CandleRow {
  open: number;
  high: number;
  low: number;
  close: number;
  close_time: string;
}

interface SignalResult {
  key: SignalKey;
  direction: DirectionLean;
  weight: number;
  description: string;
}

interface ScanResult {
  symbol: string;
  style: TradingStyle;
  controlling_timeframe: string;
  firing_signals: SignalKey[];
  signal_details: Record<string, { direction: DirectionLean; description: string }>;
  attention_score: number;
  heat_level: HeatLevel;
  direction_lean: DirectionLean;
  dominant_behavior: string;
  signal_count: number;
  last_scanned_at: string;
  expires_at: string;
}

const SIGNAL_WEIGHTS: Record<SignalKey, number> = {
  LARGE_ENGULFING:     18,
  CONSECUTIVE_TREND:   15,
  STRONG_CLOSE:        14,
  MOMENTUM_SPIKE:      16,
  VELOCITY_CANDLE:     13,
  COMPRESSION_FORMING: 14,
  COMPRESSION_BREAK:   20,
  INSIDE_BAR_BREAK:    15,
  CLOSE_ABOVE_20EMA:   15,
  CLOSE_BELOW_20EMA:   15,
  EMA_SLOPE_CHANGE:    16,
  PRICE_EMA_REJECTION: 14,
  SWING_BREAK:         18,
  WICK_REJECTION:      13,
  OUTSIDE_BAR:         12,
  ATR_SPIKE:           14,
  RANGE_EXPANSION:     12,
};

const STYLE_RELEVANCE: Record<TradingStyle, Record<SignalKey, number>> = {
  SCALP: {
    LARGE_ENGULFING: 1.0, CONSECUTIVE_TREND: 0.9, STRONG_CLOSE: 1.0, MOMENTUM_SPIKE: 1.0,
    VELOCITY_CANDLE: 1.0, COMPRESSION_FORMING: 0.8, COMPRESSION_BREAK: 0.9, INSIDE_BAR_BREAK: 1.0,
    CLOSE_ABOVE_20EMA: 0.8, CLOSE_BELOW_20EMA: 0.8, EMA_SLOPE_CHANGE: 0.7, PRICE_EMA_REJECTION: 0.8,
    SWING_BREAK: 0.8, WICK_REJECTION: 1.0, OUTSIDE_BAR: 1.0, ATR_SPIKE: 0.9, RANGE_EXPANSION: 0.9,
  },
  MICRO_INTRADAY: {
    LARGE_ENGULFING: 0.9, CONSECUTIVE_TREND: 1.0, STRONG_CLOSE: 0.9, MOMENTUM_SPIKE: 1.0,
    VELOCITY_CANDLE: 0.9, COMPRESSION_FORMING: 1.0, COMPRESSION_BREAK: 1.0, INSIDE_BAR_BREAK: 0.9,
    CLOSE_ABOVE_20EMA: 1.0, CLOSE_BELOW_20EMA: 1.0, EMA_SLOPE_CHANGE: 1.0, PRICE_EMA_REJECTION: 1.0,
    SWING_BREAK: 1.0, WICK_REJECTION: 0.9, OUTSIDE_BAR: 0.9, ATR_SPIKE: 1.0, RANGE_EXPANSION: 1.0,
  },
  INTRADAY: {
    LARGE_ENGULFING: 0.8, CONSECUTIVE_TREND: 1.0, STRONG_CLOSE: 0.8, MOMENTUM_SPIKE: 0.9,
    VELOCITY_CANDLE: 0.7, COMPRESSION_FORMING: 1.0, COMPRESSION_BREAK: 1.0, INSIDE_BAR_BREAK: 0.8,
    CLOSE_ABOVE_20EMA: 1.0, CLOSE_BELOW_20EMA: 1.0, EMA_SLOPE_CHANGE: 1.0, PRICE_EMA_REJECTION: 0.9,
    SWING_BREAK: 1.0, WICK_REJECTION: 0.8, OUTSIDE_BAR: 0.8, ATR_SPIKE: 1.0, RANGE_EXPANSION: 0.9,
  },
};

const HEAT_THRESHOLDS: Record<TradingStyle, { active: number; hot: number }> = {
  SCALP:          { active: 22, hot: 45 },
  MICRO_INTRADAY: { active: 25, hot: 50 },
  INTRADAY:       { active: 28, hot: 55 },
};

const EXPIRE_MINUTES: Record<TradingStyle, number> = {
  SCALP: 5,
  MICRO_INTRADAY: 8,
  INTRADAY: 12,
};

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
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close),
    );
    trs.push(tr);
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function avgBody(candles: CandleRow[], count = 10): number {
  return candles.slice(-count).reduce((sum, c) => sum + Math.abs(c.close - c.open), 0) / count;
}

function avgRange(candles: CandleRow[], count = 10): number {
  return candles.slice(-count).reduce((sum, c) => sum + (c.high - c.low), 0) / count;
}

// ─── Signal detectors ─────────────────────────────────────────────────────────

function detectSignals(candles: CandleRow[], style: TradingStyle): SignalResult[] {
  const results: SignalResult[] = [];
  if (candles.length < 10) return results;

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];
  const closes = candles.map(c => c.close);
  const atr = calcATR(candles, 14);
  const ema20 = calcEMA(closes, 20);
  const avgBodySize = avgBody(candles, 14);
  const avgRangeSize = avgRange(candles, 14);
  const currentBody = Math.abs(last.close - last.open);
  const currentRange = last.high - last.low;

  // ── LARGE_ENGULFING ──────────────────────────────────────────────────────────
  if (candles.length >= 3) {
    const prevBody = Math.abs(prev.close - prev.open);
    const lastBody = Math.abs(last.close - last.open);
    const isBullEngulf = last.close > last.open &&
                         last.open < prev.close &&
                         last.close > prev.open &&
                         lastBody > prevBody * 1.1;
    const isBearEngulf = last.close < last.open &&
                         last.open > prev.close &&
                         last.close < prev.open &&
                         lastBody > prevBody * 1.1;
    if ((isBullEngulf || isBearEngulf) && lastBody > avgBodySize * 1.2) {
      results.push({
        key: 'LARGE_ENGULFING',
        direction: isBullEngulf ? 'BUY' : 'SELL',
        weight: SIGNAL_WEIGHTS.LARGE_ENGULFING,
        description: `${isBullEngulf ? 'Bullish' : 'Bearish'} engulfing candle absorbed prior candle`,
      });
    }
  }

  // ── CONSECUTIVE_TREND ────────────────────────────────────────────────────────
  if (candles.length >= 5) {
    const last5 = candles.slice(-5);
    const bullCount = last5.filter(c => c.close > c.open).length;
    const bearCount = last5.filter(c => c.close < c.open).length;
    if (bullCount >= 3) {
      results.push({
        key: 'CONSECUTIVE_TREND',
        direction: 'BUY',
        weight: SIGNAL_WEIGHTS.CONSECUTIVE_TREND,
        description: `${bullCount} of last 5 candles closed bullish — momentum building`,
      });
    } else if (bearCount >= 3) {
      results.push({
        key: 'CONSECUTIVE_TREND',
        direction: 'SELL',
        weight: SIGNAL_WEIGHTS.CONSECUTIVE_TREND,
        description: `${bearCount} of last 5 candles closed bearish — selling pressure`,
      });
    }
  }

  // ── STRONG_CLOSE ─────────────────────────────────────────────────────────────
  if (currentRange > 0) {
    const closePosition = (last.close - last.low) / currentRange;
    if (closePosition >= 0.75) {
      results.push({
        key: 'STRONG_CLOSE',
        direction: 'BUY',
        weight: SIGNAL_WEIGHTS.STRONG_CLOSE,
        description: 'Candle closed in top 25% of range — strong bullish close',
      });
    } else if (closePosition <= 0.25) {
      results.push({
        key: 'STRONG_CLOSE',
        direction: 'SELL',
        weight: SIGNAL_WEIGHTS.STRONG_CLOSE,
        description: 'Candle closed in bottom 25% of range — strong bearish close',
      });
    }
  }

  // ── MOMENTUM_SPIKE ───────────────────────────────────────────────────────────
  if (currentBody >= avgBodySize * 2.0 && currentRange >= avgRangeSize * 1.5) {
    results.push({
      key: 'MOMENTUM_SPIKE',
      direction: last.close > last.open ? 'BUY' : 'SELL',
      weight: SIGNAL_WEIGHTS.MOMENTUM_SPIKE,
      description: `Candle body ${(currentBody / avgBodySize).toFixed(1)}x the average — explosive momentum`,
    });
  }

  // ── VELOCITY_CANDLE ──────────────────────────────────────────────────────────
  if (currentBody >= avgBodySize * 1.5 && currentRange > 0) {
    const bodyRatio = currentBody / currentRange;
    if (bodyRatio >= 0.75) {
      results.push({
        key: 'VELOCITY_CANDLE',
        direction: last.close > last.open ? 'BUY' : 'SELL',
        weight: SIGNAL_WEIGHTS.VELOCITY_CANDLE,
        description: 'Clean directional candle with minimal wicks — pure velocity',
      });
    }
  }

  // ── COMPRESSION_FORMING ──────────────────────────────────────────────────────
  if (candles.length >= 12) {
    const recent6 = candles.slice(-6);
    const older6 = candles.slice(-12, -6);
    const recentAvgRange = avgRange(recent6, 6);
    const olderAvgRange = avgRange(older6, 6);
    if (recentAvgRange < olderAvgRange * 0.65 && recentAvgRange > 0) {
      results.push({
        key: 'COMPRESSION_FORMING',
        direction: 'NEUTRAL',
        weight: SIGNAL_WEIGHTS.COMPRESSION_FORMING,
        description: 'Range contracting — market compressing before potential breakout',
      });
    }
  }

  // ── COMPRESSION_BREAK ────────────────────────────────────────────────────────
  if (candles.length >= 12) {
    const prior8 = candles.slice(-12, -4);
    const priorRangeHigh = Math.max(...prior8.map(c => c.high));
    const priorRangeLow = Math.min(...prior8.map(c => c.low));
    const prior8Range = priorRangeHigh - priorRangeLow;
    const prior8AvgRange = avgRange(prior8, 8);
    const wasCompressed = prior8AvgRange < avgRangeSize * 0.7;
    if (wasCompressed) {
      if (last.close > priorRangeHigh && currentBody > avgBodySize * 1.3) {
        results.push({
          key: 'COMPRESSION_BREAK',
          direction: 'BUY',
          weight: SIGNAL_WEIGHTS.COMPRESSION_BREAK,
          description: 'Breakout above compressed range — energy releasing to upside',
        });
      } else if (last.close < priorRangeLow && currentBody > avgBodySize * 1.3) {
        results.push({
          key: 'COMPRESSION_BREAK',
          direction: 'SELL',
          weight: SIGNAL_WEIGHTS.COMPRESSION_BREAK,
          description: 'Breakdown below compressed range — energy releasing to downside',
        });
      }
    }
  }

  // ── INSIDE_BAR_BREAK ─────────────────────────────────────────────────────────
  if (candles.length >= 4) {
    const insideCandle = candles[candles.length - 3];
    const motherCandle = candles[candles.length - 4];
    const wasInside = insideCandle.high <= motherCandle.high && insideCandle.low >= motherCandle.low;
    if (wasInside) {
      if (last.close > motherCandle.high) {
        results.push({
          key: 'INSIDE_BAR_BREAK',
          direction: 'BUY',
          weight: SIGNAL_WEIGHTS.INSIDE_BAR_BREAK,
          description: 'Price broke above inside bar mother candle — directional resolution',
        });
      } else if (last.close < motherCandle.low) {
        results.push({
          key: 'INSIDE_BAR_BREAK',
          direction: 'SELL',
          weight: SIGNAL_WEIGHTS.INSIDE_BAR_BREAK,
          description: 'Price broke below inside bar mother candle — directional resolution',
        });
      }
    }
  }

  // ── CLOSE_ABOVE/BELOW_20EMA ──────────────────────────────────────────────────
  if (ema20.length >= 2) {
    const currentEMA = ema20[ema20.length - 1];
    const prevEMA = ema20[ema20.length - 2];
    const prevCloseWasBelow = prev.close < prevEMA;
    const prevCloseWasAbove = prev.close > prevEMA;

    if (prevCloseWasBelow && last.close > currentEMA) {
      results.push({
        key: 'CLOSE_ABOVE_20EMA',
        direction: 'BUY',
        weight: SIGNAL_WEIGHTS.CLOSE_ABOVE_20EMA,
        description: 'Price closed above 20 EMA for first time — bullish bias shift',
      });
    } else if (prevCloseWasAbove && last.close < currentEMA) {
      results.push({
        key: 'CLOSE_BELOW_20EMA',
        direction: 'SELL',
        weight: SIGNAL_WEIGHTS.CLOSE_BELOW_20EMA,
        description: 'Price closed below 20 EMA for first time — bearish bias shift',
      });
    }
  }

  // ── EMA_SLOPE_CHANGE ─────────────────────────────────────────────────────────
  if (ema20.length >= 5) {
    const emaPrev3 = ema20[ema20.length - 4];
    const emaPrev2 = ema20[ema20.length - 3];
    const emaPrev1 = ema20[ema20.length - 2];
    const emaCurr = ema20[ema20.length - 1];
    const wasDecreasing = emaPrev3 > emaPrev2 && emaPrev2 > emaPrev1;
    const wasIncreasing = emaPrev3 < emaPrev2 && emaPrev2 < emaPrev1;
    const nowIncreasing = emaPrev1 < emaCurr;
    const nowDecreasing = emaPrev1 > emaCurr;
    if (wasDecreasing && nowIncreasing) {
      results.push({
        key: 'EMA_SLOPE_CHANGE',
        direction: 'BUY',
        weight: SIGNAL_WEIGHTS.EMA_SLOPE_CHANGE,
        description: '20 EMA turned from declining to rising — potential trend reversal',
      });
    } else if (wasIncreasing && nowDecreasing) {
      results.push({
        key: 'EMA_SLOPE_CHANGE',
        direction: 'SELL',
        weight: SIGNAL_WEIGHTS.EMA_SLOPE_CHANGE,
        description: '20 EMA turned from rising to declining — potential trend reversal',
      });
    }
  }

  // ── PRICE_EMA_REJECTION ──────────────────────────────────────────────────────
  if (ema20.length >= 2) {
    const currentEMA = ema20[ema20.length - 1];
    const emaTouched = prev.low <= currentEMA * 1.001 && prev.high >= currentEMA * 0.999;
    if (emaTouched) {
      if (prev.close < currentEMA && last.close < prev.close) {
        results.push({
          key: 'PRICE_EMA_REJECTION',
          direction: 'SELL',
          weight: SIGNAL_WEIGHTS.PRICE_EMA_REJECTION,
          description: 'Price tapped 20 EMA from below and was rejected — bearish',
        });
      } else if (prev.close > currentEMA && last.close > prev.close) {
        results.push({
          key: 'PRICE_EMA_REJECTION',
          direction: 'BUY',
          weight: SIGNAL_WEIGHTS.PRICE_EMA_REJECTION,
          description: 'Price tapped 20 EMA from above and bounced — bullish',
        });
      }
    }
  }

  // ── SWING_BREAK ──────────────────────────────────────────────────────────────
  if (candles.length >= 20) {
    const lookback = candles.slice(-20, -3);
    const swingHigh = Math.max(...lookback.map(c => c.high));
    const swingLow = Math.min(...lookback.map(c => c.low));
    if (last.close > swingHigh && prev.close <= swingHigh) {
      results.push({
        key: 'SWING_BREAK',
        direction: 'BUY',
        weight: SIGNAL_WEIGHTS.SWING_BREAK,
        description: 'Price broke above recent swing high — bullish structure shift',
      });
    } else if (last.close < swingLow && prev.close >= swingLow) {
      results.push({
        key: 'SWING_BREAK',
        direction: 'SELL',
        weight: SIGNAL_WEIGHTS.SWING_BREAK,
        description: 'Price broke below recent swing low — bearish structure shift',
      });
    }
  }

  // ── WICK_REJECTION ───────────────────────────────────────────────────────────
  if (currentRange > 0 && atr > 0) {
    const upperWick = last.high - Math.max(last.open, last.close);
    const lowerWick = Math.min(last.open, last.close) - last.low;
    const minWickSize = atr * 0.3;
    if (lowerWick > upperWick * 2.0 && lowerWick >= minWickSize && currentBody < currentRange * 0.5) {
      results.push({
        key: 'WICK_REJECTION',
        direction: 'BUY',
        weight: SIGNAL_WEIGHTS.WICK_REJECTION,
        description: 'Long lower wick rejected downside — buyers defending level',
      });
    } else if (upperWick > lowerWick * 2.0 && upperWick >= minWickSize && currentBody < currentRange * 0.5) {
      results.push({
        key: 'WICK_REJECTION',
        direction: 'SELL',
        weight: SIGNAL_WEIGHTS.WICK_REJECTION,
        description: 'Long upper wick rejected upside — sellers defending level',
      });
    }
  }

  // ── OUTSIDE_BAR ──────────────────────────────────────────────────────────────
  if (last.high > prev.high && last.low < prev.low && currentRange > avgRangeSize * 1.3) {
    results.push({
      key: 'OUTSIDE_BAR',
      direction: 'NEUTRAL',
      weight: SIGNAL_WEIGHTS.OUTSIDE_BAR,
      description: 'Outside bar swallowed prior candle range — volatility event',
    });
  }

  // ── ATR_SPIKE ────────────────────────────────────────────────────────────────
  if (atr > 0 && currentRange > atr * 2.0) {
    results.push({
      key: 'ATR_SPIKE',
      direction: 'NEUTRAL',
      weight: SIGNAL_WEIGHTS.ATR_SPIKE,
      description: `Range is ${(currentRange / atr).toFixed(1)}x ATR — volatility spike`,
    });
  }

  // ── RANGE_EXPANSION ──────────────────────────────────────────────────────────
  if (avgRangeSize > 0 && currentRange >= avgRangeSize * 1.5 && currentRange < atr * 2.0) {
    results.push({
      key: 'RANGE_EXPANSION',
      direction: 'NEUTRAL',
      weight: SIGNAL_WEIGHTS.RANGE_EXPANSION,
      description: `Candle range expanded to ${(currentRange / avgRangeSize).toFixed(1)}x average`,
    });
  }

  return results;
}

// ─── Score computation ────────────────────────────────────────────────────────

function computeAttentionScore(signals: SignalResult[], style: TradingStyle): number {
  if (signals.length === 0) return 0;
  const relevance = STYLE_RELEVANCE[style];
  let raw = 0;
  for (const s of signals) {
    const r = relevance[s.key] ?? 0.8;
    raw += s.weight * r;
  }
  return Math.min(100, Math.round(raw));
}

function computeDirectionLean(signals: SignalResult[]): DirectionLean {
  let buyScore = 0;
  let sellScore = 0;
  for (const s of signals) {
    if (s.direction === 'BUY') buyScore += s.weight;
    else if (s.direction === 'SELL') sellScore += s.weight;
  }
  const diff = Math.abs(buyScore - sellScore);
  const total = buyScore + sellScore;
  if (total === 0) return 'NEUTRAL';
  if (diff / total < 0.2) return 'NEUTRAL';
  return buyScore > sellScore ? 'BUY' : 'SELL';
}

function computeHeatLevel(score: number, style: TradingStyle): HeatLevel {
  const t = HEAT_THRESHOLDS[style];
  if (score >= t.hot) return 'HOT';
  if (score >= t.active) return 'ACTIVE';
  return 'QUIET';
}

function findDominantBehavior(signals: SignalResult[]): string {
  if (signals.length === 0) return 'No signals detected';
  const top = signals.reduce((a, b) => (b.weight > a.weight ? b : a));
  return top.description;
}

// ─── Data fetching ────────────────────────────────────────────────────────────

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

// ─── Main scan ────────────────────────────────────────────────────────────────

async function scanSymbolStyle(
  symbol: string,
  style: TradingStyle,
): Promise<ScanResult> {
  const tf = STYLE_TIMEFRAME_MAP[style];
  const candles = await getCandlesForSymbol(symbol, tf);
  const now = new Date();
  const expires = new Date(now.getTime() + EXPIRE_MINUTES[style] * 60 * 1000);

  if (candles.length < 10) {
    return {
      symbol, style, controlling_timeframe: tf,
      firing_signals: [], signal_details: {},
      attention_score: 0, heat_level: 'QUIET',
      direction_lean: 'NEUTRAL', dominant_behavior: 'Insufficient data',
      signal_count: 0,
      last_scanned_at: now.toISOString(),
      expires_at: expires.toISOString(),
    };
  }

  const signals = detectSignals(candles, style);
  const score = computeAttentionScore(signals, style);
  const heat = computeHeatLevel(score, style);
  const lean = computeDirectionLean(signals);
  const dominant = findDominantBehavior(signals);

  const details: Record<string, { direction: DirectionLean; description: string }> = {};
  for (const s of signals) {
    details[s.key] = { direction: s.direction, description: s.description };
  }

  return {
    symbol, style, controlling_timeframe: tf,
    firing_signals: signals.map(s => s.key),
    signal_details: details,
    attention_score: score,
    heat_level: heat,
    direction_lean: lean,
    dominant_behavior: dominant,
    signal_count: signals.length,
    last_scanned_at: now.toISOString(),
    expires_at: expires.toISOString(),
  };
}

export const handler: Handler = async (event) => {
  const startTime = Date.now();
  console.log('[MarketBehaviorScanner] Starting scan...');

  try {
    const styles: TradingStyle[] = ['SCALP', 'MICRO_INTRADAY', 'INTRADAY'];
    const results: ScanResult[] = [];

    for (const symbol of SYMBOLS) {
      for (const style of styles) {
        try {
          const result = await scanSymbolStyle(symbol, style);
          results.push(result);
        } catch (err) {
          console.error(`[MarketBehaviorScanner] Error scanning ${symbol} ${style}:`, err);
        }
      }
    }

    if (results.length > 0) {
      const { error } = await supabase
        .from('market_behavior_signals')
        .upsert(results, { onConflict: 'symbol,style' });

      if (error) {
        console.error('[MarketBehaviorScanner] Upsert error:', error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
      }
    }

    const hotCount = results.filter(r => r.heat_level === 'HOT').length;
    const activeCount = results.filter(r => r.heat_level === 'ACTIVE').length;
    const elapsed = Date.now() - startTime;

    console.log(
      `[MarketBehaviorScanner] Done in ${elapsed}ms. ` +
      `${results.length} rows. HOT: ${hotCount}, ACTIVE: ${activeCount}`
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        scanned: results.length, hot: hotCount, active: activeCount, elapsed_ms: elapsed,
      }),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[MarketBehaviorScanner] Fatal error:', msg);
    return { statusCode: 500, body: JSON.stringify({ error: msg }) };
  }
};
