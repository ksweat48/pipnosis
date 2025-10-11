/**
 * Technical Indicators Library
 * Pure calculation functions for RSI, VWAP, Volume Analysis, and ATR
 */

export interface Candle {
  time: string | Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Calculate Simple Moving Average
 */
export function calculateSMA(values: number[], period: number): number {
  if (values.length < period) {
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }
  const slice = values.slice(-period);
  return slice.reduce((sum, val) => sum + val, 0) / period;
}

/**
 * Calculate Exponential Moving Average
 */
export function calculateEMA(values: number[], period: number): number {
  if (values.length === 0) return 0;
  if (values.length < period) {
    return calculateSMA(values, values.length);
  }

  const multiplier = 2 / (period + 1);
  let ema = calculateSMA(values.slice(0, period), period);

  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
  }

  return ema;
}

/**
 * Calculate RSI (Relative Strength Index)
 * Uses 14-period by default
 */
export function calculateRSI(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) {
    throw new Error(`Insufficient data for RSI calculation. Need at least ${period + 1} candles, got ${candles.length}`);
  }

  const changes: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    changes.push(candles[i].close - candles[i - 1].close);
  }

  const gains: number[] = changes.map(change => change > 0 ? change : 0);
  const losses: number[] = changes.map(change => change < 0 ? Math.abs(change) : 0);

  let avgGain = calculateSMA(gains.slice(0, period), period);
  let avgLoss = calculateSMA(losses.slice(0, period), period);

  for (let i = period; i < changes.length; i++) {
    avgGain = ((avgGain * (period - 1)) + gains[i]) / period;
    avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;
  }

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  return rsi;
}

/**
 * Get RSI Status
 */
export function getRSIStatus(rsi: number): 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL' {
  if (rsi > 70) return 'OVERBOUGHT';
  if (rsi < 30) return 'OVERSOLD';
  return 'NEUTRAL';
}

/**
 * Calculate VWAP (Volume-Weighted Average Price)
 * Uses all provided candles or last N candles
 */
export function calculateVWAP(candles: Candle[], maxCandles: number = 50): number {
  if (candles.length === 0) {
    throw new Error('Cannot calculate VWAP with no candles');
  }

  const candlesToUse = candles.slice(-maxCandles);
  let totalVolumePrice = 0;
  let totalVolume = 0;

  for (const candle of candlesToUse) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    const volume = candle.volume || 1;
    totalVolumePrice += typicalPrice * volume;
    totalVolume += volume;
  }

  if (totalVolume === 0) {
    const avgPrice = candlesToUse.reduce((sum, c) => sum + c.close, 0) / candlesToUse.length;
    return avgPrice;
  }

  return totalVolumePrice / totalVolume;
}

/**
 * Get VWAP Position relative to current price
 */
export function getVWAPPosition(currentPrice: number, vwap: number): 'Above VWAP' | 'Below VWAP' | 'Near VWAP' {
  const threshold = 0.001;
  const diff = Math.abs(currentPrice - vwap) / vwap;

  if (diff <= threshold) return 'Near VWAP';
  if (currentPrice > vwap) return 'Above VWAP';
  return 'Below VWAP';
}

/**
 * Analyze Volume
 * Compares current volume to 20-period average
 */
export interface VolumeAnalysis {
  status: 'LOW' | 'STABLE' | 'HIGH';
  delta: string;
  currentVolume: number;
  averageVolume: number;
}

export function analyzeVolume(candles: Candle[], period: number = 20): VolumeAnalysis {
  if (candles.length < 2) {
    return {
      status: 'STABLE',
      delta: '0%',
      currentVolume: candles[0]?.volume || 0,
      averageVolume: candles[0]?.volume || 0
    };
  }

  const currentVolume = candles[candles.length - 1].volume || 0;
  const volumes = candles.slice(-period).map(c => c.volume || 0);
  const averageVolume = calculateSMA(volumes, Math.min(period, volumes.length));

  let status: 'LOW' | 'STABLE' | 'HIGH' = 'STABLE';
  const percentChange = averageVolume > 0 ? ((currentVolume - averageVolume) / averageVolume) * 100 : 0;

  if (percentChange > 20) {
    status = 'HIGH';
  } else if (percentChange < -20) {
    status = 'LOW';
  }

  const delta = `${percentChange >= 0 ? '+' : ''}${percentChange.toFixed(1)}%`;

  return {
    status,
    delta,
    currentVolume,
    averageVolume
  };
}

/**
 * Calculate True Range for a single candle
 */
function calculateTrueRange(current: Candle, previous: Candle | null): number {
  if (!previous) {
    return current.high - current.low;
  }

  const highLow = current.high - current.low;
  const highClose = Math.abs(current.high - previous.close);
  const lowClose = Math.abs(current.low - previous.close);

  return Math.max(highLow, highClose, lowClose);
}

/**
 * Calculate ATR (Average True Range)
 * Uses 14-period by default
 */
export function calculateATR(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) {
    throw new Error(`Insufficient data for ATR calculation. Need at least ${period + 1} candles, got ${candles.length}`);
  }

  const trueRanges: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const tr = calculateTrueRange(candles[i], candles[i - 1]);
    trueRanges.push(tr);
  }

  let atr = calculateSMA(trueRanges.slice(0, period), period);

  for (let i = period; i < trueRanges.length; i++) {
    atr = ((atr * (period - 1)) + trueRanges[i]) / period;
  }

  return atr;
}

/**
 * Get ATR Status based on volatility
 */
export function getATRStatus(atr: number, candles: Candle[]): 'Low' | 'Normal' | 'Elevated' {
  const recentCandles = candles.slice(-20);
  const ranges = recentCandles.map(c => c.high - c.low);
  const medianRange = calculateSMA(ranges, ranges.length);

  const ratio = atr / medianRange;

  if (ratio < 0.8) return 'Low';
  if (ratio > 1.3) return 'Elevated';
  return 'Normal';
}

/**
 * Calculate Standard Deviation
 */
export function calculateStdDev(values: number[]): number {
  if (values.length === 0) return 0;

  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
  const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;

  return Math.sqrt(variance);
}
