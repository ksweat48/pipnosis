export interface HeikinAshiCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export function convertToHeikinAshi(candles: Candle[]): HeikinAshiCandle[] {
  const haCandles: HeikinAshiCandle[] = [];

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];

    let haOpen: number;
    let haClose: number;
    let haHigh: number;
    let haLow: number;

    haClose = (candle.open + candle.high + candle.low + candle.close) / 4;

    if (i === 0) {
      haOpen = (candle.open + candle.close) / 2;
    } else {
      haOpen = (haCandles[i - 1].open + haCandles[i - 1].close) / 2;
    }

    haHigh = Math.max(candle.high, haOpen, haClose);
    haLow = Math.min(candle.low, haOpen, haClose);

    haCandles.push({
      timestamp: candle.timestamp,
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose
    });
  }

  return haCandles;
}

export function calculateHalfTrend(
  highs: number[],
  lows: number[],
  closes: number[],
  amplitude: number = 2,
  channelDeviation: number = 2
): { trend: 'green' | 'red'; value: number } {
  if (highs.length < 10) {
    return { trend: 'green', value: closes[closes.length - 1] };
  }

  const atr = calculateATRFromArrays(highs, lows, closes, 14);
  const maxLowPrice = Math.max(...lows.slice(-amplitude));
  const minHighPrice = Math.min(...highs.slice(-amplitude));

  const currentClose = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2];

  let trend: 'green' | 'red' = currentClose > prevClose ? 'green' : 'red';

  const highMa = calculateSMA(highs, 10);
  const lowMa = calculateSMA(lows, 10);

  const upperBand = highMa + (channelDeviation * atr);
  const lowerBand = lowMa - (channelDeviation * atr);

  if (currentClose > upperBand) {
    trend = 'green';
  } else if (currentClose < lowerBand) {
    trend = 'red';
  }

  const value = trend === 'green' ? lowerBand : upperBand;

  return { trend, value };
}

export function calculateStochRSI(
  closes: number[],
  rsiPeriod: number = 14,
  stochPeriod: number = 14,
  kSmooth: number = 3,
  dSmooth: number = 3
): { k: number[]; d: number[] } {
  if (closes.length < rsiPeriod + stochPeriod) {
    return { k: [50], d: [50] };
  }

  const rsiValues = [];
  for (let i = rsiPeriod; i < closes.length; i++) {
    const slice = closes.slice(i - rsiPeriod, i + 1);
    const rsi = calculateRSIFromSlice(slice);
    rsiValues.push(rsi);
  }

  const stochValues = [];
  for (let i = stochPeriod - 1; i < rsiValues.length; i++) {
    const rsiSlice = rsiValues.slice(i - stochPeriod + 1, i + 1);
    const maxRSI = Math.max(...rsiSlice);
    const minRSI = Math.min(...rsiSlice);

    let stoch = 0;
    if (maxRSI !== minRSI) {
      stoch = ((rsiValues[i] - minRSI) / (maxRSI - minRSI)) * 100;
    }

    stochValues.push(stoch);
  }

  const k = calculateSMAArray(stochValues, kSmooth);
  const d = calculateSMAArray(k, dSmooth);

  return { k, d };
}

export function calculateLinearRegression(prices: number[], period: number): number {
  if (prices.length < period) {
    return prices[prices.length - 1] || 0;
  }

  const slice = prices.slice(-period);
  const n = slice.length;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += slice[i];
    sumXY += i * slice[i];
    sumX2 += i * i;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  return slope * (n - 1) + intercept;
}

function calculateRSIFromSlice(prices: number[]): number {
  if (prices.length < 2) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  const avgGain = gains / (prices.length - 1);
  const avgLoss = losses / (prices.length - 1);

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateATRFromArrays(highs: number[], lows: number[], closes: number[], period: number): number {
  if (highs.length < period + 1) return 0.001;

  const trs = [];
  for (let i = 1; i < Math.min(highs.length, period + 10); i++) {
    const high = highs[i];
    const low = lows[i];
    const prevClose = closes[i - 1];

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trs.push(tr);
  }

  return trs.slice(-period).reduce((sum, tr) => sum + tr, 0) / Math.min(trs.length, period);
}

function calculateSMA(values: number[], period: number): number {
  if (values.length < period) {
    return values[values.length - 1] || 0;
  }

  const slice = values.slice(-period);
  return slice.reduce((sum, val) => sum + val, 0) / period;
}

function calculateSMAArray(values: number[], period: number): number[] {
  const result: number[] = [];

  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const sma = slice.reduce((sum, val) => sum + val, 0) / period;
    result.push(sma);
  }

  return result;
}

export function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) {
    return prices[prices.length - 1] || 0;
  }

  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;

  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }

  return ema;
}

export function calculateMACD(
  prices: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macd: number; signal: number; histogram: number } {
  if (prices.length < slowPeriod + signalPeriod) {
    return { macd: 0, signal: 0, histogram: 0 };
  }

  const fastEMA = calculateEMA(prices, fastPeriod);
  const slowEMA = calculateEMA(prices, slowPeriod);
  const macd = fastEMA - slowEMA;

  const macdLine: number[] = [];
  for (let i = slowPeriod; i <= prices.length; i++) {
    const slice = prices.slice(0, i);
    const fast = calculateEMA(slice, fastPeriod);
    const slow = calculateEMA(slice, slowPeriod);
    macdLine.push(fast - slow);
  }

  const signal = calculateEMA(macdLine, signalPeriod);
  const histogram = macd - signal;

  return { macd, signal, histogram };
}
