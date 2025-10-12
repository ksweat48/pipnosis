import { Candle, calculateATR } from '../../lib/indicators';

export interface HalfTrendValue {
  trend: 'GREEN' | 'RED';
  value: number;
  timestamp: Date;
}

export interface HalfTrendSignal {
  current: 'GREEN' | 'RED';
  previous: 'GREEN' | 'RED';
  justFlipped: boolean;
  strength: number;
}

export function calculateHalfTrend(
  candles: Candle[],
  atrPeriod: number = 14,
  atrMultiplier: number = 2
): HalfTrendValue[] {
  if (candles.length < atrPeriod + 1) {
    throw new Error(`Insufficient data for HalfTrend. Need at least ${atrPeriod + 1} candles`);
  }

  const atr = calculateATR(candles, atrPeriod);
  const result: HalfTrendValue[] = [];

  let trend: 'GREEN' | 'RED' = 'GREEN';
  let trendLine = candles[atrPeriod].low;

  for (let i = atrPeriod; i < candles.length; i++) {
    const candle = candles[i];
    const offset = atr * atrMultiplier;

    if (trend === 'GREEN') {
      trendLine = Math.max(trendLine, candle.low - offset);

      if (candle.close < trendLine) {
        trend = 'RED';
        trendLine = candle.high + offset;
      }
    } else {
      trendLine = Math.min(trendLine, candle.high + offset);

      if (candle.close > trendLine) {
        trend = 'GREEN';
        trendLine = candle.low - offset;
      }
    }

    result.push({
      trend,
      value: trendLine,
      timestamp: candle.time instanceof Date ? candle.time : new Date(candle.time)
    });
  }

  return result;
}

export function getHalfTrendSignal(candles: Candle[]): HalfTrendSignal {
  const halfTrendValues = calculateHalfTrend(candles);

  if (halfTrendValues.length < 2) {
    return {
      current: 'GREEN',
      previous: 'GREEN',
      justFlipped: false,
      strength: 0
    };
  }

  const current = halfTrendValues[halfTrendValues.length - 1];
  const previous = halfTrendValues[halfTrendValues.length - 2];

  const justFlipped = current.trend !== previous.trend;

  let strength = 0;
  for (let i = halfTrendValues.length - 1; i >= 0; i--) {
    if (halfTrendValues[i].trend === current.trend) {
      strength++;
    } else {
      break;
    }
  }

  return {
    current: current.trend,
    previous: previous.trend,
    justFlipped,
    strength
  };
}

export function isHalfTrendAlignedForTrade(
  candles: Candle[],
  direction: 'BUY' | 'SELL'
): boolean {
  const signal = getHalfTrendSignal(candles);

  if (direction === 'BUY') {
    return signal.current === 'GREEN';
  } else {
    return signal.current === 'RED';
  }
}

export function getHalfTrendStrength(candles: Candle[]): number {
  const signal = getHalfTrendSignal(candles);
  return signal.strength;
}
