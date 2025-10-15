/**
 * EMA Analysis Module for Pipnosis Intrascalping Assistant
 * Provides comprehensive EMA calculations, signal generation, and trade level calculations
 * Designed for micro/intrascalping strategies on 1m, 5m, and 1h timeframes
 */

import { Candle, calculateEMA } from './indicators';
import { Time, LineData } from 'lightweight-charts';

export const EMA_PERIODS = [5, 9, 21, 50, 200] as const;
export type EMAPeriod = typeof EMA_PERIODS[number];

export interface EMAValues {
  5: number;
  9: number;
  21: number;
  50: number;
  200: number;
}

export interface EMAChartData {
  5: LineData<Time>[];
  9: LineData<Time>[];
  21: LineData<Time>[];
  50: LineData<Time>[];
  200: LineData<Time>[];
}

export interface EMACrossover {
  type: 'golden_cross' | 'death_cross' | 'fast_cross_above' | 'fast_cross_below';
  fastEMA: EMAPeriod;
  slowEMA: EMAPeriod;
  timestamp: Date;
  price: number;
  strength: 'Strong' | 'Moderate' | 'Weak';
}

export interface EMAPullback {
  ema: EMAPeriod;
  price: number;
  distance: number;
  distancePercent: number;
  type: 'touched' | 'near' | 'bounced';
}

export interface EMATrend {
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  strength: number;
  shortTermAlign: boolean;
  mediumTermAlign: boolean;
  longTermAlign: boolean;
}

export interface EMASignals {
  trend: EMATrend;
  crossover: EMACrossover | null;
  pullback: EMAPullback | null;
  alignedWithH1: boolean;
  trendDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  crossoverDescription: string | null;
  pullbackTo: number | null;
  confluenceScore: number;
}

export interface EMALevels {
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  reasoning: string;
}

/**
 * Calculate EMAs for all standard periods
 */
export function calculateEMAs(candles: Candle[]): EMAValues {
  if (candles.length < 200) {
    console.warn(`⚠️ EMA calculation with ${candles.length} candles. Recommend 200+ for EMA200 accuracy.`);
  }

  const closePrices = candles.map(c => c.close);

  return {
    5: calculateEMA(closePrices, 5),
    9: calculateEMA(closePrices, 9),
    21: calculateEMA(closePrices, 21),
    50: calculateEMA(closePrices, 50),
    200: calculateEMA(closePrices, 200)
  };
}

/**
 * Calculate EMA time-series data for chart visualization
 */
export function calculateEMAsForChart(candles: Candle[]): EMAChartData {
  const result: EMAChartData = {
    5: [],
    9: [],
    21: [],
    50: [],
    200: []
  };

  if (candles.length < 5) {
    console.log('[EMA] Insufficient candles for calculation:', candles.length);
    return result;
  }

  console.log('[EMA] Starting calculation for', candles.length, 'candles');

  for (let i = 0; i < candles.length; i++) {
    const subset = candles.slice(0, i + 1);
    const closePrices = subset.map(c => c.close);
    const candle = candles[i];
    const time = (typeof candle.time === 'string'
      ? Math.floor(new Date(candle.time).getTime() / 1000)
      : Math.floor((candle.time as Date).getTime() / 1000)) as Time;

    for (const period of EMA_PERIODS) {
      if (subset.length >= period) {
        try {
          const emaValue = calculateEMA(closePrices, period);
          if (isFinite(emaValue) && emaValue > 0) {
            result[period].push({
              time,
              value: emaValue
            });
          }
        } catch (err) {
          console.error(`[EMA] Error calculating EMA${period} at index ${i}:`, err);
        }
      }
    }
  }

  console.log('[EMA] Calculation complete:', {
    ema5: result[5].length,
    ema9: result[9].length,
    ema21: result[21].length,
    ema50: result[50].length,
    ema200: result[200].length
  });

  return result;
}

/**
 * Detect EMA crossovers in recent candles
 */
export function detectEMACrossovers(candles: Candle[], lookbackPeriods: number = 5): EMACrossover | null {
  if (candles.length < Math.max(...EMA_PERIODS) + lookbackPeriods) {
    return null;
  }

  const recentCandles = candles.slice(-lookbackPeriods);

  for (let i = 1; i < recentCandles.length; i++) {
    const prevCandles = candles.slice(0, candles.length - lookbackPeriods + i - 1);
    const currentCandles = candles.slice(0, candles.length - lookbackPeriods + i);

    const prevEMAs = calculateEMAs(prevCandles);
    const currentEMAs = calculateEMAs(currentCandles);

    if (prevEMAs[5] <= prevEMAs[21] && currentEMAs[5] > currentEMAs[21]) {
      const candle = recentCandles[i];
      return {
        type: 'fast_cross_above',
        fastEMA: 5,
        slowEMA: 21,
        timestamp: new Date(candle.time),
        price: candle.close,
        strength: 'Strong'
      };
    }

    if (prevEMAs[5] >= prevEMAs[21] && currentEMAs[5] < currentEMAs[21]) {
      const candle = recentCandles[i];
      return {
        type: 'fast_cross_below',
        fastEMA: 5,
        slowEMA: 21,
        timestamp: new Date(candle.time),
        price: candle.close,
        strength: 'Strong'
      };
    }

    if (prevEMAs[21] <= prevEMAs[200] && currentEMAs[21] > currentEMAs[200]) {
      const candle = recentCandles[i];
      return {
        type: 'golden_cross',
        fastEMA: 21,
        slowEMA: 200,
        timestamp: new Date(candle.time),
        price: candle.close,
        strength: 'Strong'
      };
    }

    if (prevEMAs[21] >= prevEMAs[200] && currentEMAs[21] < currentEMAs[200]) {
      const candle = recentCandles[i];
      return {
        type: 'death_cross',
        fastEMA: 21,
        slowEMA: 200,
        timestamp: new Date(candle.time),
        price: candle.close,
        strength: 'Strong'
      };
    }
  }

  return null;
}

/**
 * Detect pullbacks to key EMAs
 */
export function detectEMAPullback(candles: Candle[], emaValues: EMAValues): EMAPullback | null {
  if (candles.length < 3) {
    return null;
  }

  const currentPrice = candles[candles.length - 1].close;
  const prevPrice = candles[candles.length - 2].close;

  const checkPullback = (ema: EMAPeriod, emaValue: number): EMAPullback | null => {
    const distance = Math.abs(currentPrice - emaValue);
    const distancePercent = (distance / currentPrice) * 100;

    if (distancePercent < 0.01) {
      return {
        ema,
        price: emaValue,
        distance,
        distancePercent,
        type: 'touched'
      };
    }

    if (distancePercent < 0.05) {
      return {
        ema,
        price: emaValue,
        distance,
        distancePercent,
        type: 'near'
      };
    }

    const prevDistance = Math.abs(prevPrice - emaValue);
    if (prevDistance < distance && distancePercent < 0.1) {
      return {
        ema,
        price: emaValue,
        distance,
        distancePercent,
        type: 'bounced'
      };
    }

    return null;
  };

  for (const period of [21, 50, 9, 200, 5] as EMAPeriod[]) {
    const pullback = checkPullback(period, emaValues[period]);
    if (pullback) {
      return pullback;
    }
  }

  return null;
}

/**
 * Analyze EMA trend alignment
 */
export function analyzeEMATrend(candles: Candle[], emaValues: EMAValues): EMATrend {
  const currentPrice = candles[candles.length - 1].close;

  const shortTermAlign = currentPrice > emaValues[5] && emaValues[5] > emaValues[9] && emaValues[9] > emaValues[21];
  const shortTermBearish = currentPrice < emaValues[5] && emaValues[5] < emaValues[9] && emaValues[9] < emaValues[21];

  const mediumTermAlign = emaValues[21] > emaValues[50];
  const mediumTermBearish = emaValues[21] < emaValues[50];

  const longTermAlign = emaValues[50] > emaValues[200];
  const longTermBearish = emaValues[50] < emaValues[200];

  let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let strength = 0;

  if (shortTermAlign && mediumTermAlign && longTermAlign) {
    direction = 'BULLISH';
    strength = 100;
  } else if (shortTermAlign && mediumTermAlign) {
    direction = 'BULLISH';
    strength = 75;
  } else if (shortTermAlign) {
    direction = 'BULLISH';
    strength = 50;
  } else if (shortTermBearish && mediumTermBearish && longTermBearish) {
    direction = 'BEARISH';
    strength = 100;
  } else if (shortTermBearish && mediumTermBearish) {
    direction = 'BEARISH';
    strength = 75;
  } else if (shortTermBearish) {
    direction = 'BEARISH';
    strength = 50;
  } else {
    direction = 'NEUTRAL';
    strength = 25;
  }

  return {
    direction,
    strength,
    shortTermAlign: shortTermAlign || shortTermBearish,
    mediumTermAlign: mediumTermAlign || mediumTermBearish,
    longTermAlign: longTermAlign || longTermBearish
  };
}

/**
 * Calculate confluence score based on EMA proximity
 */
export function calculateEMAConfluence(emaValues: EMAValues): number {
  const emaArray = [emaValues[5], emaValues[9], emaValues[21], emaValues[50], emaValues[200]];
  let confluenceScore = 0;

  for (let i = 0; i < emaArray.length - 1; i++) {
    for (let j = i + 1; j < emaArray.length; j++) {
      const diff = Math.abs(emaArray[i] - emaArray[j]);
      const percentDiff = (diff / emaArray[i]) * 100;

      if (percentDiff < 0.5) {
        confluenceScore += 20;
      } else if (percentDiff < 1.0) {
        confluenceScore += 10;
      } else if (percentDiff < 2.0) {
        confluenceScore += 5;
      }
    }
  }

  return Math.min(confluenceScore, 100);
}

/**
 * Generate comprehensive EMA signals
 */
export function generateEMASignals(
  candles: Candle[],
  h1Candles?: Candle[]
): EMASignals {
  const emaValues = calculateEMAs(candles);
  const trend = analyzeEMATrend(candles, emaValues);
  const crossover = detectEMACrossovers(candles);
  const pullback = detectEMAPullback(candles, emaValues);
  const confluenceScore = calculateEMAConfluence(emaValues);

  let alignedWithH1 = true;
  if (h1Candles && h1Candles.length >= 200) {
    const h1EMAs = calculateEMAs(h1Candles);
    const h1Trend = analyzeEMATrend(h1Candles, h1EMAs);
    alignedWithH1 = trend.direction === h1Trend.direction || trend.direction === 'NEUTRAL';
  }

  let crossoverDescription: string | null = null;
  if (crossover) {
    const direction = crossover.type.includes('above') || crossover.type === 'golden_cross' ? 'above' : 'below';
    crossoverDescription = `EMA${crossover.fastEMA} crossed ${direction} EMA${crossover.slowEMA}`;
  }

  const pullbackTo = pullback ? pullback.ema : null;

  return {
    trend,
    crossover,
    pullback,
    alignedWithH1,
    trendDirection: trend.direction,
    crossoverDescription,
    pullbackTo,
    confluenceScore
  };
}

/**
 * Calculate EMA-based trade levels
 */
export function calculateEMALevels(
  candles: Candle[],
  emaValues: EMAValues,
  signals: EMASignals
): EMALevels {
  if (candles.length < 50) {
    return {
      entry: null,
      stopLoss: null,
      takeProfit: null,
      reasoning: 'Insufficient data for EMA level calculation'
    };
  }

  const currentPrice = candles[candles.length - 1].close;
  const atr = calculateATRSimple(candles);

  if (signals.trend.direction === 'BULLISH' && signals.pullback) {
    const entry = signals.pullback.price;
    const stopLoss = Math.min(emaValues[50], emaValues[200]) - (atr * 1.5);
    const takeProfit = entry + (Math.abs(entry - stopLoss) * 2);

    return {
      entry,
      stopLoss,
      takeProfit,
      reasoning: `Bullish pullback to EMA${signals.pullback.ema}, stop below EMA cluster, 2:1 RRR`
    };
  }

  if (signals.trend.direction === 'BEARISH' && signals.pullback) {
    const entry = signals.pullback.price;
    const stopLoss = Math.max(emaValues[50], emaValues[200]) + (atr * 1.5);
    const takeProfit = entry - (Math.abs(stopLoss - entry) * 2);

    return {
      entry,
      stopLoss,
      takeProfit,
      reasoning: `Bearish pullback to EMA${signals.pullback.ema}, stop above EMA cluster, 2:1 RRR`
    };
  }

  if (signals.crossover && signals.trend.strength >= 50) {
    const isBullish = signals.crossover.type.includes('above') || signals.crossover.type === 'golden_cross';

    if (isBullish) {
      const entry = currentPrice;
      const stopLoss = emaValues[50] - (atr * 1.5);
      const takeProfit = entry + (Math.abs(entry - stopLoss) * 2.5);

      return {
        entry,
        stopLoss,
        takeProfit,
        reasoning: `Bullish EMA crossover, stop below EMA50, 2.5:1 RRR`
      };
    } else {
      const entry = currentPrice;
      const stopLoss = emaValues[50] + (atr * 1.5);
      const takeProfit = entry - (Math.abs(stopLoss - entry) * 2.5);

      return {
        entry,
        stopLoss,
        takeProfit,
        reasoning: `Bearish EMA crossover, stop above EMA50, 2.5:1 RRR`
      };
    }
  }

  return {
    entry: null,
    stopLoss: null,
    takeProfit: null,
    reasoning: 'No clear EMA setup detected'
  };
}

/**
 * Simple ATR calculation helper
 */
function calculateATRSimple(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) {
    return 0;
  }

  const trueRanges: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    const highLow = current.high - current.low;
    const highClose = Math.abs(current.high - previous.close);
    const lowClose = Math.abs(current.low - previous.close);

    trueRanges.push(Math.max(highLow, highClose, lowClose));
  }

  const recentTRs = trueRanges.slice(-period);
  const atr = recentTRs.reduce((sum, tr) => sum + tr, 0) / period;

  return atr;
}
