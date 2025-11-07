interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface IndicatorResult {
  time: number;
  value: number;
}

/**
 * Calculate Rolling VWAP - uses a fixed lookback window
 * This makes VWAP responsive to current price action
 * @param candles - Array of candle data
 * @param lookbackPeriod - Number of candles to include in rolling window (default: 200)
 */
export function calculateVWAP(candles: CandleData[], lookbackPeriod: number = 200): IndicatorResult[] {
  if (candles.length === 0) return [];

  const results: IndicatorResult[] = [];

  // Use rolling window VWAP instead of cumulative
  // This makes VWAP responsive to current price action
  for (let i = 0; i < candles.length; i++) {
    // Determine the start index for the rolling window
    const startIdx = Math.max(0, i - lookbackPeriod + 1);
    const windowCandles = candles.slice(startIdx, i + 1);

    // Calculate VWAP for this window
    let cumulativeTPV = 0;
    let cumulativeVolume = 0;

    for (const candle of windowCandles) {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      const volume = candle.volume || 1;

      cumulativeTPV += typicalPrice * volume;
      cumulativeVolume += volume;
    }

    const vwap = cumulativeTPV / cumulativeVolume;

    results.push({
      time: candles[i].time,
      value: vwap
    });
  }

  return results;
}

/**
 * Calculate Session-Based VWAP - resets at the start of each trading day
 * Useful for intraday trading strategies
 * @param candles - Array of candle data
 */
export function calculateSessionVWAP(candles: CandleData[]): IndicatorResult[] {
  if (candles.length === 0) return [];

  const results: IndicatorResult[] = [];
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  let currentDay = '';

  for (const candle of candles) {
    // Get the date in YYYY-MM-DD format (UTC)
    const candleDate = new Date(candle.time * 1000);
    const dateString = candleDate.toISOString().split('T')[0];

    // Reset VWAP at the start of a new trading day
    if (dateString !== currentDay) {
      currentDay = dateString;
      cumulativeTPV = 0;
      cumulativeVolume = 0;
    }

    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    const volume = candle.volume || 1;

    cumulativeTPV += typicalPrice * volume;
    cumulativeVolume += volume;

    const vwap = cumulativeTPV / cumulativeVolume;

    results.push({
      time: candle.time,
      value: vwap
    });
  }

  return results;
}

export function calculateEMA(candles: CandleData[], period: number): IndicatorResult[] {
  if (candles.length < period) return [];

  const results: IndicatorResult[] = [];
  const multiplier = 2 / (period + 1);

  let ema = candles.slice(0, period).reduce((sum, candle) => sum + candle.close, 0) / period;

  results.push({
    time: candles[period - 1].time,
    value: ema
  });

  for (let i = period; i < candles.length; i++) {
    ema = (candles[i].close - ema) * multiplier + ema;
    results.push({
      time: candles[i].time,
      value: ema
    });
  }

  return results;
}

export function calculateRSI(candles: CandleData[], period: number = 14): IndicatorResult[] {
  if (candles.length < period + 1) return [];

  const results: IndicatorResult[] = [];
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    results.push({
      time: candles[i].time,
      value: rsi
    });
  }

  return results;
}

export function calculateATR(candles: CandleData[], period: number = 14): IndicatorResult[] {
  if (candles.length < period + 1) return [];

  const results: IndicatorResult[] = [];
  const trueRanges: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );

    trueRanges.push(tr);
  }

  let atr = trueRanges.slice(0, period).reduce((sum, tr) => sum + tr, 0) / period;

  results.push({
    time: candles[period].time,
    value: atr
  });

  for (let i = period; i < trueRanges.length; i++) {
    atr = ((atr * (period - 1)) + trueRanges[i]) / period;
    results.push({
      time: candles[i + 1].time,
      value: atr
    });
  }

  return results;
}

export interface VolumeData {
  time: number;
  volume: number;
  isAboveAverage: boolean;
}

export function calculateVolumeMetrics(candles: CandleData[]): VolumeData[] {
  if (candles.length === 0) return [];

  const avgVolume = candles.reduce((sum, c) => sum + (c.volume || 1), 0) / candles.length;

  return candles.map(candle => ({
    time: candle.time,
    volume: candle.volume || 1,
    isAboveAverage: (candle.volume || 1) > avgVolume
  }));
}

export enum CandlePattern {
  NONE = 'None',
  HAMMER = 'Hammer',
  INVERTED_HAMMER = 'Inverted Hammer',
  BULLISH_ENGULFING = 'Bullish Engulfing',
  BEARISH_ENGULFING = 'Bearish Engulfing',
  MOMENTUM_BULLISH = 'Momentum Bullish',
  MOMENTUM_BEARISH = 'Momentum Bearish'
}

export interface PatternDetection {
  time: number;
  pattern: CandlePattern;
  confidence: 'low' | 'medium' | 'high';
}

export function detectCandlePatterns(candles: CandleData[], vwapValues?: IndicatorResult[]): PatternDetection[] {
  if (candles.length < 2) return [];

  const results: PatternDetection[] = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    const currentBody = Math.abs(current.close - current.open);
    const currentRange = current.high - current.low;
    const currentUpperWick = current.high - Math.max(current.open, current.close);
    const currentLowerWick = Math.min(current.open, current.close) - current.low;

    const previousBody = Math.abs(previous.close - previous.open);

    const isBullish = current.close > current.open;
    const wasBearish = previous.close < previous.open;
    const wasBullish = previous.close > previous.open;

    let pattern = CandlePattern.NONE;
    let confidence: 'low' | 'medium' | 'high' = 'low';

    const nearVWAP = vwapValues ?
      Math.abs(current.close - (vwapValues[i]?.value || 0)) < (currentRange * 2) :
      false;

    if (isBullish && currentLowerWick > currentBody * 2 && currentUpperWick < currentBody * 0.3) {
      pattern = CandlePattern.HAMMER;
      confidence = nearVWAP ? 'high' : 'medium';
    }
    else if (isBullish && currentUpperWick > currentBody * 2 && currentLowerWick < currentBody * 0.3) {
      pattern = CandlePattern.INVERTED_HAMMER;
      confidence = nearVWAP ? 'high' : 'medium';
    }
    else if (isBullish && wasBearish && current.open < previous.close && current.close > previous.open) {
      pattern = CandlePattern.BULLISH_ENGULFING;
      confidence = nearVWAP ? 'high' : 'medium';
    }
    else if (!isBullish && wasBullish && current.open > previous.close && current.close < previous.open) {
      pattern = CandlePattern.BEARISH_ENGULFING;
      confidence = nearVWAP ? 'high' : 'medium';
    }
    else if (isBullish && currentBody > currentRange * 0.7) {
      pattern = CandlePattern.MOMENTUM_BULLISH;
      confidence = currentBody > previousBody * 1.5 ? 'high' : 'medium';
    }
    else if (!isBullish && currentBody > currentRange * 0.7) {
      pattern = CandlePattern.MOMENTUM_BEARISH;
      confidence = currentBody > previousBody * 1.5 ? 'high' : 'medium';
    }

    if (pattern !== CandlePattern.NONE) {
      results.push({
        time: current.time,
        pattern,
        confidence
      });
    }
  }

  return results;
}
