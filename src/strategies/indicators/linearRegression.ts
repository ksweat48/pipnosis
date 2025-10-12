import { Candle } from '../../lib/indicators';

export interface LinearRegressionValue {
  value: number;
  timestamp: Date;
}

export interface SignalLinePosition {
  priceAbove: boolean;
  distance: number;
  distancePercent: number;
}

export function calculateLinearRegression(
  candles: Candle[],
  period: number = 50
): LinearRegressionValue[] {
  if (candles.length < period) {
    throw new Error(`Insufficient data for Linear Regression. Need at least ${period} candles`);
  }

  const result: LinearRegressionValue[] = [];

  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1);
    const prices = slice.map(c => c.close);

    const n = prices.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;

    for (let j = 0; j < n; j++) {
      sumX += j;
      sumY += prices[j];
      sumXY += j * prices[j];
      sumX2 += j * j;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    const lastX = n - 1;
    const regressionValue = slope * lastX + intercept;

    result.push({
      value: regressionValue,
      timestamp: candles[i].time instanceof Date ? candles[i].time : new Date(candles[i].time)
    });
  }

  return result;
}

export function getSignalLinePosition(
  candles: Candle[],
  period: number = 50
): SignalLinePosition {
  if (candles.length < period) {
    return {
      priceAbove: false,
      distance: 0,
      distancePercent: 0
    };
  }

  const regressionValues = calculateLinearRegression(candles, period);
  const currentPrice = candles[candles.length - 1].close;
  const signalLine = regressionValues[regressionValues.length - 1].value;

  const distance = currentPrice - signalLine;
  const distancePercent = (distance / signalLine) * 100;

  return {
    priceAbove: currentPrice > signalLine,
    distance,
    distancePercent
  };
}

export function isSignalLineAlignedForTrade(
  candles: Candle[],
  direction: 'BUY' | 'SELL',
  period: number = 50
): boolean {
  const position = getSignalLinePosition(candles, period);

  if (direction === 'BUY') {
    return position.priceAbove;
  } else {
    return !position.priceAbove;
  }
}

export function hasSignalLineCrossover(
  candles: Candle[],
  period: number = 50
): 'above' | 'below' | 'none' {
  if (candles.length < period + 1) {
    return 'none';
  }

  const currentPosition = getSignalLinePosition(candles, period);
  const previousCandles = candles.slice(0, -1);
  const previousPosition = getSignalLinePosition(previousCandles, period);

  if (!previousPosition.priceAbove && currentPosition.priceAbove) {
    return 'above';
  } else if (previousPosition.priceAbove && !currentPosition.priceAbove) {
    return 'below';
  }

  return 'none';
}

export function getSignalLineValue(
  candles: Candle[],
  period: number = 50
): number | null {
  if (candles.length < period) {
    return null;
  }

  const regressionValues = calculateLinearRegression(candles, period);
  return regressionValues[regressionValues.length - 1].value;
}
