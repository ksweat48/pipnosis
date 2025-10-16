/**
 * Advanced Pattern Detection System
 * Detects triangles, flags, channels, and breakouts
 */

import { Candle } from './indicators';

export interface AdvancedPattern {
  type: 'Triangle' | 'Flag' | 'Channel' | 'Breakout' | 'None';
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  description: string;
  startIndex: number;
  endIndex: number;
  supportLevel?: number;
  resistanceLevel?: number;
  isValid: boolean;
}

/**
 * Detect Triangle Pattern
 * Requires at least 3 candles with converging highs and lows
 */
export function detectTriangle(candles: Candle[]): AdvancedPattern | null {
  if (candles.length < 5) return null;

  const recentCandles = candles.slice(-15);
  const highs = recentCandles.map(c => c.high);
  const lows = recentCandles.map(c => c.low);

  let highTrend = 0;
  let lowTrend = 0;

  for (let i = 1; i < Math.min(5, highs.length); i++) {
    if (highs[highs.length - i] < highs[highs.length - i - 1]) highTrend--;
    if (highs[highs.length - i] > highs[highs.length - i - 1]) highTrend++;

    if (lows[lows.length - i] < lows[lows.length - i - 1]) lowTrend--;
    if (lows[lows.length - i] > lows[lows.length - i - 1]) lowTrend++;
  }

  const isConverging = Math.abs(highTrend + lowTrend) <= 2;

  if (isConverging) {
    let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 60;

    if (lowTrend > 0 && highTrend < 0) {
      direction = 'bullish';
      confidence = 75;
    } else if (lowTrend < 0 && highTrend > 0) {
      direction = 'bearish';
      confidence = 75;
    }

    const rangeStart = Math.max(0, recentCandles.length - 10);
    const supportLevel = Math.min(...recentCandles.slice(rangeStart).map(c => c.low));
    const resistanceLevel = Math.max(...recentCandles.slice(rangeStart).map(c => c.high));

    return {
      type: 'Triangle',
      direction,
      confidence,
      description: `${direction === 'bullish' ? 'Ascending' : direction === 'bearish' ? 'Descending' : 'Symmetrical'} triangle pattern forming`,
      startIndex: candles.length - recentCandles.length,
      endIndex: candles.length - 1,
      supportLevel,
      resistanceLevel,
      isValid: true
    };
  }

  return null;
}

/**
 * Detect Flag Pattern
 * Sharp price movement followed by rectangular consolidation
 */
export function detectFlag(candles: Candle[]): AdvancedPattern | null {
  if (candles.length < 8) return null;

  const recentCandles = candles.slice(-12);

  const poleStart = recentCandles[0];
  const poleEnd = recentCandles[Math.floor(recentCandles.length / 3)];
  const flagCandles = recentCandles.slice(Math.floor(recentCandles.length / 3));

  const poleMove = Math.abs(poleEnd.close - poleStart.close);
  const poleRange = Math.max(...recentCandles.slice(0, Math.floor(recentCandles.length / 3)).map(c => c.high)) -
                    Math.min(...recentCandles.slice(0, Math.floor(recentCandles.length / 3)).map(c => c.low));

  if (poleMove < poleRange * 0.6) return null;

  const flagHigh = Math.max(...flagCandles.map(c => c.high));
  const flagLow = Math.min(...flagCandles.map(c => c.low));
  const flagRange = flagHigh - flagLow;

  const isConsolidation = flagRange < poleRange * 0.5;

  if (isConsolidation) {
    const isBullish = poleEnd.close > poleStart.close;
    const direction = isBullish ? 'bullish' : 'bearish';
    const confidence = 70;

    return {
      type: 'Flag',
      direction,
      confidence,
      description: `${isBullish ? 'Bullish' : 'Bearish'} flag pattern - continuation expected`,
      startIndex: candles.length - recentCandles.length,
      endIndex: candles.length - 1,
      supportLevel: flagLow,
      resistanceLevel: flagHigh,
      isValid: true
    };
  }

  return null;
}

/**
 * Detect Channel Pattern
 * Parallel support and resistance lines
 */
export function detectChannel(candles: Candle[]): AdvancedPattern | null {
  if (candles.length < 10) return null;

  const recentCandles = candles.slice(-20);
  const highs = recentCandles.map(c => c.high);
  const lows = recentCandles.map(c => c.low);

  const highPeaks: number[] = [];
  const lowTroughs: number[] = [];

  for (let i = 2; i < recentCandles.length - 2; i++) {
    if (highs[i] > highs[i - 1] && highs[i] > highs[i + 1] && highs[i] > highs[i - 2] && highs[i] > highs[i + 2]) {
      highPeaks.push(highs[i]);
    }
    if (lows[i] < lows[i - 1] && lows[i] < lows[i + 1] && lows[i] < lows[i - 2] && lows[i] < lows[i + 2]) {
      lowTroughs.push(lows[i]);
    }
  }

  if (highPeaks.length >= 2 && lowTroughs.length >= 2) {
    const avgHigh = highPeaks.reduce((sum, h) => sum + h, 0) / highPeaks.length;
    const avgLow = lowTroughs.reduce((sum, l) => sum + l, 0) / lowTroughs.length;
    const channelWidth = avgHigh - avgLow;

    const highVariance = Math.max(...highPeaks) - Math.min(...highPeaks);
    const lowVariance = Math.max(...lowTroughs) - Math.min(...lowTroughs);

    const isParallel = highVariance < channelWidth * 0.3 && lowVariance < channelWidth * 0.3;

    if (isParallel) {
      const latestClose = recentCandles[recentCandles.length - 1].close;
      const positionInChannel = (latestClose - avgLow) / channelWidth;

      let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral';
      let confidence = 65;

      if (positionInChannel < 0.3) {
        direction = 'bullish';
        confidence = 70;
      } else if (positionInChannel > 0.7) {
        direction = 'bearish';
        confidence = 70;
      }

      return {
        type: 'Channel',
        direction,
        confidence,
        description: `Price trading in parallel channel, currently at ${(positionInChannel * 100).toFixed(0)}% of range`,
        startIndex: candles.length - recentCandles.length,
        endIndex: candles.length - 1,
        supportLevel: avgLow,
        resistanceLevel: avgHigh,
        isValid: true
      };
    }
  }

  return null;
}

/**
 * Detect Breakout Pattern
 * Price breaks beyond established range
 */
export function detectBreakout(candles: Candle[], existingPattern?: AdvancedPattern): AdvancedPattern | null {
  if (candles.length < 5) return null;

  const recentCandles = candles.slice(-10);
  const olderCandles = candles.slice(-20, -5);

  const oldHigh = Math.max(...olderCandles.map(c => c.high));
  const oldLow = Math.min(...olderCandles.map(c => c.low));
  const currentPrice = recentCandles[recentCandles.length - 1].close;
  const previousPrice = recentCandles[recentCandles.length - 2].close;

  const breakoutThreshold = (oldHigh - oldLow) * 0.05;

  let breakoutDetected = false;
  let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let confidence = 60;

  if (previousPrice <= oldHigh && currentPrice > oldHigh + breakoutThreshold) {
    breakoutDetected = true;
    direction = 'bullish';
    confidence = 80;
  } else if (previousPrice >= oldLow && currentPrice < oldLow - breakoutThreshold) {
    breakoutDetected = true;
    direction = 'bearish';
    confidence = 80;
  }

  if (breakoutDetected) {
    const volumeIndex = recentCandles.length - 1;
    const currentVolume = recentCandles[volumeIndex].volume || 0;
    const avgVolume = recentCandles.slice(0, -1).reduce((sum, c) => sum + (c.volume || 0), 0) / (recentCandles.length - 1);

    if (currentVolume > avgVolume * 1.3) {
      confidence = Math.min(confidence + 10, 95);
    }

    return {
      type: 'Breakout',
      direction,
      confidence,
      description: `${direction === 'bullish' ? 'Bullish' : 'Bearish'} breakout detected with ${currentVolume > avgVolume * 1.3 ? 'strong' : 'moderate'} volume`,
      startIndex: candles.length - recentCandles.length,
      endIndex: candles.length - 1,
      supportLevel: direction === 'bullish' ? oldHigh : oldLow,
      resistanceLevel: direction === 'bullish' ? currentPrice : oldLow,
      isValid: true
    };
  }

  return null;
}

/**
 * Main pattern detection function
 * Analyzes candles and returns the most significant pattern
 */
export function detectAdvancedPattern(candles: Candle[]): AdvancedPattern {
  if (candles.length < 3) {
    return {
      type: 'None',
      direction: 'neutral',
      confidence: 0,
      description: 'Insufficient data for pattern detection',
      startIndex: 0,
      endIndex: 0,
      isValid: false
    };
  }

  const breakout = detectBreakout(candles);
  if (breakout && breakout.confidence >= 75) return breakout;

  const flag = detectFlag(candles);
  if (flag && flag.confidence >= 70) return flag;

  const triangle = detectTriangle(candles);
  if (triangle && triangle.confidence >= 65) return triangle;

  const channel = detectChannel(candles);
  if (channel) return channel;

  const checkBreakoutAgain = detectBreakout(candles, triangle || flag || channel || undefined);
  if (checkBreakoutAgain) return checkBreakoutAgain;

  return {
    type: 'None',
    direction: 'neutral',
    confidence: 0,
    description: 'No clear pattern detected',
    startIndex: 0,
    endIndex: 0,
    isValid: false
  };
}

/**
 * Validate if pattern is still valid
 * Returns false if price has invalidated the pattern
 */
export function isPatternStillValid(pattern: AdvancedPattern, currentCandle: Candle): boolean {
  if (!pattern.isValid || pattern.type === 'None') return false;

  if (pattern.type === 'Breakout') {
    return true;
  }

  if (pattern.supportLevel && currentCandle.close < pattern.supportLevel * 0.995) {
    return false;
  }

  if (pattern.resistanceLevel && currentCandle.close > pattern.resistanceLevel * 1.005) {
    return false;
  }

  return true;
}
