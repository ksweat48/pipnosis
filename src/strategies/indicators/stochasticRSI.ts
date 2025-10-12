import { Candle, calculateRSI } from '../../lib/indicators';

export interface StochRSIValue {
  k: number;
  d: number;
  rsi: number;
  timestamp: Date;
}

export interface StochRSISignal {
  value: number;
  zone: 'oversold' | 'overbought' | 'neutral';
  crossing: 'up' | 'down' | 'none';
  k: number;
  d: number;
}

export function calculateStochasticRSI(
  candles: Candle[],
  rsiPeriod: number = 14,
  stochPeriod: number = 14,
  kSmooth: number = 3,
  dSmooth: number = 3
): StochRSIValue[] {
  if (candles.length < rsiPeriod + stochPeriod) {
    throw new Error(`Insufficient data for Stochastic RSI. Need at least ${rsiPeriod + stochPeriod} candles`);
  }

  const rsiValues: number[] = [];

  for (let i = rsiPeriod; i < candles.length; i++) {
    const candleSlice = candles.slice(i - rsiPeriod, i + 1);
    const rsi = calculateRSI(candleSlice, rsiPeriod);
    rsiValues.push(rsi);
  }

  const stochRSIValues: number[] = [];

  for (let i = stochPeriod - 1; i < rsiValues.length; i++) {
    const rsiSlice = rsiValues.slice(i - stochPeriod + 1, i + 1);
    const minRSI = Math.min(...rsiSlice);
    const maxRSI = Math.max(...rsiSlice);

    const stochRSI = maxRSI - minRSI === 0
      ? 0
      : ((rsiValues[i] - minRSI) / (maxRSI - minRSI)) * 100;

    stochRSIValues.push(stochRSI);
  }

  const kValues: number[] = [];
  for (let i = kSmooth - 1; i < stochRSIValues.length; i++) {
    const kSlice = stochRSIValues.slice(i - kSmooth + 1, i + 1);
    const kValue = kSlice.reduce((sum, val) => sum + val, 0) / kSmooth;
    kValues.push(kValue);
  }

  const result: StochRSIValue[] = [];
  for (let i = dSmooth - 1; i < kValues.length; i++) {
    const dSlice = kValues.slice(i - dSmooth + 1, i + 1);
    const dValue = dSlice.reduce((sum, val) => sum + val, 0) / dSmooth;

    const candleIndex = rsiPeriod + stochPeriod + i;

    result.push({
      k: kValues[i],
      d: dValue,
      rsi: rsiValues[stochPeriod - 1 + i] || 50,
      timestamp: candles[candleIndex]?.time instanceof Date
        ? candles[candleIndex].time as Date
        : new Date(candles[candleIndex]?.time || Date.now())
    });
  }

  return result;
}

export function getStochRSISignal(
  candles: Candle[],
  direction: 'BUY' | 'SELL'
): StochRSISignal {
  const stochValues = calculateStochasticRSI(candles);

  if (stochValues.length < 2) {
    return {
      value: 50,
      zone: 'neutral',
      crossing: 'none',
      k: 50,
      d: 50
    };
  }

  const current = stochValues[stochValues.length - 1];
  const previous = stochValues[stochValues.length - 2];

  let zone: 'oversold' | 'overbought' | 'neutral' = 'neutral';
  if (current.k < 20) {
    zone = 'oversold';
  } else if (current.k > 80) {
    zone = 'overbought';
  }

  let crossing: 'up' | 'down' | 'none' = 'none';
  if (previous.k < previous.d && current.k > current.d) {
    crossing = 'up';
  } else if (previous.k > previous.d && current.k < current.d) {
    crossing = 'down';
  }

  return {
    value: current.k,
    zone,
    crossing,
    k: current.k,
    d: current.d
  };
}

export function isStochRSIAlignedForTrade(
  candles: Candle[],
  direction: 'BUY' | 'SELL'
): boolean {
  const signal = getStochRSISignal(candles, direction);

  if (direction === 'BUY') {
    return signal.zone === 'oversold' && signal.crossing === 'up';
  } else {
    return signal.zone === 'overbought' && signal.crossing === 'down';
  }
}
