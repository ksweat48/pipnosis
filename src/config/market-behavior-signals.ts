/**
 * Market Behavior Signal Library — SSOT
 *
 * This is the canonical registry of all detectable market behaviors used
 * to alert users that a pair is worth paying attention to right now.
 *
 * Governance:
 * - These are NOT trade signals — they are market attention signals.
 * - Alpha is the sole trade decision authority.
 * - This library only answers: "Is something interesting happening?"
 * - Signal detection is server-side only (market-behavior-scanner Netlify function).
 *
 * Signal categories:
 *   MOMENTUM    — Candle-driven energy and direction
 *   COMPRESSION — Range tightening and breakout potential
 *   EMA         — Price relationship to key EMAs
 *   STRUCTURE   — Market structure shifts readable from raw price
 *   VOLATILITY  — ATR and range expansion events
 */

export type SignalCategory =
  | 'MOMENTUM'
  | 'COMPRESSION'
  | 'EMA'
  | 'STRUCTURE'
  | 'VOLATILITY';

export type SignalKey =
  | 'LARGE_ENGULFING'
  | 'CONSECUTIVE_TREND'
  | 'STRONG_CLOSE'
  | 'MOMENTUM_SPIKE'
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
  | 'RANGE_EXPANSION'
  | 'VELOCITY_CANDLE';

export type HeatLevel = 'QUIET' | 'ACTIVE' | 'HOT';
export type DirectionLean = 'BUY' | 'SELL' | 'NEUTRAL';
export type TradingStyle = 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';

export interface MarketBehaviorSignalDef {
  key: SignalKey;
  label: string;
  description: string;
  category: SignalCategory;
  weight: number;
  styleRelevance: Record<TradingStyle, number>;
  directional: boolean;
}

export const MARKET_BEHAVIOR_SIGNALS: Record<SignalKey, MarketBehaviorSignalDef> = {
  LARGE_ENGULFING: {
    key: 'LARGE_ENGULFING',
    label: 'Large Engulfing',
    description: 'Candle body engulfs prior candle — strong directional intent',
    category: 'MOMENTUM',
    weight: 18,
    styleRelevance: { SCALP: 1.0, MICRO_INTRADAY: 0.9, INTRADAY: 0.8 },
    directional: true,
  },
  CONSECUTIVE_TREND: {
    key: 'CONSECUTIVE_TREND',
    label: 'Consecutive Trend Candles',
    description: '3+ same-direction closes signalling momentum building',
    category: 'MOMENTUM',
    weight: 15,
    styleRelevance: { SCALP: 0.9, MICRO_INTRADAY: 1.0, INTRADAY: 1.0 },
    directional: true,
  },
  STRONG_CLOSE: {
    key: 'STRONG_CLOSE',
    label: 'Strong Directional Close',
    description: 'Candle closed in top/bottom 25% of its range — decisive move',
    category: 'MOMENTUM',
    weight: 14,
    styleRelevance: { SCALP: 1.0, MICRO_INTRADAY: 0.9, INTRADAY: 0.8 },
    directional: true,
  },
  MOMENTUM_SPIKE: {
    key: 'MOMENTUM_SPIKE',
    label: 'Momentum Spike',
    description: 'Current candle body is 2x+ the average — explosive energy',
    category: 'MOMENTUM',
    weight: 16,
    styleRelevance: { SCALP: 1.0, MICRO_INTRADAY: 1.0, INTRADAY: 0.9 },
    directional: true,
  },
  VELOCITY_CANDLE: {
    key: 'VELOCITY_CANDLE',
    label: 'Velocity Candle',
    description: 'Fast-moving candle with small wicks — clean directional pressure',
    category: 'MOMENTUM',
    weight: 13,
    styleRelevance: { SCALP: 1.0, MICRO_INTRADAY: 0.9, INTRADAY: 0.7 },
    directional: true,
  },
  COMPRESSION_FORMING: {
    key: 'COMPRESSION_FORMING',
    label: 'Compression Forming',
    description: 'Range narrowing over last several candles — coiling for a move',
    category: 'COMPRESSION',
    weight: 14,
    styleRelevance: { SCALP: 0.8, MICRO_INTRADAY: 1.0, INTRADAY: 1.0 },
    directional: false,
  },
  COMPRESSION_BREAK: {
    key: 'COMPRESSION_BREAK',
    label: 'Compression Breakout',
    description: 'Price breaking out of a tight consolidation range',
    category: 'COMPRESSION',
    weight: 20,
    styleRelevance: { SCALP: 0.9, MICRO_INTRADAY: 1.0, INTRADAY: 1.0 },
    directional: true,
  },
  INSIDE_BAR_BREAK: {
    key: 'INSIDE_BAR_BREAK',
    label: 'Inside Bar Breakout',
    description: 'Candle breaking out of prior candle range after inside bar pause',
    category: 'COMPRESSION',
    weight: 15,
    styleRelevance: { SCALP: 1.0, MICRO_INTRADAY: 0.9, INTRADAY: 0.8 },
    directional: true,
  },
  CLOSE_ABOVE_20EMA: {
    key: 'CLOSE_ABOVE_20EMA',
    label: 'Close Above 20 EMA',
    description: 'Price closed above 20 EMA — bullish bias shift on this timeframe',
    category: 'EMA',
    weight: 15,
    styleRelevance: { SCALP: 0.8, MICRO_INTRADAY: 1.0, INTRADAY: 1.0 },
    directional: true,
  },
  CLOSE_BELOW_20EMA: {
    key: 'CLOSE_BELOW_20EMA',
    label: 'Close Below 20 EMA',
    description: 'Price closed below 20 EMA — bearish bias shift on this timeframe',
    category: 'EMA',
    weight: 15,
    styleRelevance: { SCALP: 0.8, MICRO_INTRADAY: 1.0, INTRADAY: 1.0 },
    directional: true,
  },
  EMA_SLOPE_CHANGE: {
    key: 'EMA_SLOPE_CHANGE',
    label: 'EMA Slope Change',
    description: '20 EMA direction flipped in last 3 candles — trend may be turning',
    category: 'EMA',
    weight: 16,
    styleRelevance: { SCALP: 0.7, MICRO_INTRADAY: 1.0, INTRADAY: 1.0 },
    directional: true,
  },
  PRICE_EMA_REJECTION: {
    key: 'PRICE_EMA_REJECTION',
    label: 'EMA Rejection',
    description: 'Price tapped the 20 EMA and reversed — dynamic support/resistance reaction',
    category: 'EMA',
    weight: 14,
    styleRelevance: { SCALP: 0.8, MICRO_INTRADAY: 1.0, INTRADAY: 0.9 },
    directional: true,
  },
  SWING_BREAK: {
    key: 'SWING_BREAK',
    label: 'Swing High/Low Break',
    description: 'Price broke a recent swing high or low — structure shift in progress',
    category: 'STRUCTURE',
    weight: 18,
    styleRelevance: { SCALP: 0.8, MICRO_INTRADAY: 1.0, INTRADAY: 1.0 },
    directional: true,
  },
  WICK_REJECTION: {
    key: 'WICK_REJECTION',
    label: 'Wick Rejection',
    description: 'Long wick pierced key level then closed away — strong rejection signal',
    category: 'STRUCTURE',
    weight: 13,
    styleRelevance: { SCALP: 1.0, MICRO_INTRADAY: 0.9, INTRADAY: 0.8 },
    directional: true,
  },
  OUTSIDE_BAR: {
    key: 'OUTSIDE_BAR',
    label: 'Outside Bar',
    description: 'Candle high and low both exceeded prior candle — volatility event',
    category: 'STRUCTURE',
    weight: 12,
    styleRelevance: { SCALP: 1.0, MICRO_INTRADAY: 0.9, INTRADAY: 0.8 },
    directional: false,
  },
  ATR_SPIKE: {
    key: 'ATR_SPIKE',
    label: 'ATR Spike',
    description: 'Volatility jumped significantly above recent average — market waking up',
    category: 'VOLATILITY',
    weight: 14,
    styleRelevance: { SCALP: 0.9, MICRO_INTRADAY: 1.0, INTRADAY: 1.0 },
    directional: false,
  },
  RANGE_EXPANSION: {
    key: 'RANGE_EXPANSION',
    label: 'Range Expansion',
    description: 'Candle range is 1.5x+ the recent average — expanding volatility',
    category: 'VOLATILITY',
    weight: 12,
    styleRelevance: { SCALP: 0.9, MICRO_INTRADAY: 1.0, INTRADAY: 0.9 },
    directional: false,
  },
};

export const HEAT_THRESHOLDS: Record<TradingStyle, { active: number; hot: number }> = {
  SCALP:          { active: 22, hot: 45 },
  MICRO_INTRADAY: { active: 25, hot: 50 },
  INTRADAY:       { active: 28, hot: 55 },
};

export function computeHeatLevel(score: number, style: TradingStyle): HeatLevel {
  const t = HEAT_THRESHOLDS[style];
  if (score >= t.hot) return 'HOT';
  if (score >= t.active) return 'ACTIVE';
  return 'QUIET';
}

export const SIGNAL_DISPLAY_CONFIG: Record<SignalKey, { icon: string; color: string }> = {
  LARGE_ENGULFING:    { icon: 'CandlestickChart', color: 'text-orange-400' },
  CONSECUTIVE_TREND:  { icon: 'TrendingUp',        color: 'text-emerald-400' },
  STRONG_CLOSE:       { icon: 'Zap',               color: 'text-amber-400' },
  MOMENTUM_SPIKE:     { icon: 'Flame',              color: 'text-red-400' },
  VELOCITY_CANDLE:    { icon: 'ArrowRight',         color: 'text-sky-400' },
  COMPRESSION_FORMING:{ icon: 'Minimize2',          color: 'text-slate-400' },
  COMPRESSION_BREAK:  { icon: 'Expand',             color: 'text-orange-400' },
  INSIDE_BAR_BREAK:   { icon: 'SquareArrowOutUpRight', color: 'text-yellow-400' },
  CLOSE_ABOVE_20EMA:  { icon: 'TrendingUp',         color: 'text-emerald-400' },
  CLOSE_BELOW_20EMA:  { icon: 'TrendingDown',       color: 'text-red-400' },
  EMA_SLOPE_CHANGE:   { icon: 'RefreshCw',          color: 'text-cyan-400' },
  PRICE_EMA_REJECTION:{ icon: 'Waypoints',          color: 'text-violet-400' },
  SWING_BREAK:        { icon: 'BarChart2',           color: 'text-orange-400' },
  WICK_REJECTION:     { icon: 'Minus',              color: 'text-rose-400' },
  OUTSIDE_BAR:        { icon: 'AlignVerticalJustifyCenter', color: 'text-slate-400' },
  ATR_SPIKE:          { icon: 'Activity',           color: 'text-amber-400' },
  RANGE_EXPANSION:    { icon: 'Maximize2',          color: 'text-orange-400' },
};
