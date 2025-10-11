/**
 * Market Structure Analysis
 * Identifies support/resistance flips and market structure changes
 */

import { Candle } from './indicators';

export interface StructureAnalysis {
  type: string;
  recent: boolean;
  confidence: number;
  description: string;
}

interface SwingPoint {
  index: number;
  price: number;
  type: 'high' | 'low';
  time: string | Date;
}

/**
 * Detect swing highs and lows
 */
function detectSwingPoints(candles: Candle[], lookback: number = 2): SwingPoint[] {
  const swingPoints: SwingPoint[] = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const current = candles[i];
    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;

      if (candles[j].high >= current.high) {
        isSwingHigh = false;
      }
      if (candles[j].low <= current.low) {
        isSwingLow = false;
      }
    }

    if (isSwingHigh) {
      swingPoints.push({
        index: i,
        price: current.high,
        type: 'high',
        time: current.time
      });
    }

    if (isSwingLow) {
      swingPoints.push({
        index: i,
        price: current.low,
        type: 'low',
        time: current.time
      });
    }
  }

  return swingPoints;
}

/**
 * Check if price has broken through a level
 */
function hasBreakout(candles: Candle[], level: number, direction: 'above' | 'below', fromIndex: number): boolean {
  for (let i = fromIndex; i < candles.length; i++) {
    if (direction === 'above' && candles[i].close > level) {
      return true;
    }
    if (direction === 'below' && candles[i].close < level) {
      return true;
    }
  }
  return false;
}

/**
 * Check if price has retested a level
 */
function hasRetest(candles: Candle[], level: number, afterIndex: number, tolerance: number = 0.002): boolean {
  for (let i = afterIndex; i < candles.length; i++) {
    const candle = candles[i];
    const priceRange = Math.max(candle.high - candle.low, level * 0.0001);
    const touchDistance = Math.min(
      Math.abs(candle.high - level),
      Math.abs(candle.low - level),
      Math.abs(candle.close - level)
    );

    if (touchDistance / level <= tolerance) {
      return true;
    }
  }
  return false;
}

/**
 * Detect bullish structure flip (support broken becomes resistance, then broken again)
 */
function detectBullishStructureFlip(candles: Candle[]): StructureAnalysis | null {
  const swingPoints = detectSwingPoints(candles, 2);

  const recentLows = swingPoints
    .filter(p => p.type === 'low')
    .slice(-3);

  if (recentLows.length < 2) return null;

  for (let i = 0; i < recentLows.length - 1; i++) {
    const supportLevel = recentLows[i].price;
    const supportIndex = recentLows[i].index;

    const breakoutIndex = supportIndex + 1;
    const hasBrokenBelow = hasBreakout(candles, supportLevel, 'below', breakoutIndex);

    if (hasBrokenBelow) {
      const breakIndex = candles.findIndex((c, idx) => idx > supportIndex && c.close < supportLevel);

      if (breakIndex > 0) {
        const retested = hasRetest(candles, supportLevel, breakIndex + 1);

        if (retested) {
          const retestIndex = candles.findIndex((c, idx) => {
            if (idx <= breakIndex) return false;
            const touchDistance = Math.min(
              Math.abs(c.high - supportLevel),
              Math.abs(c.low - supportLevel)
            );
            return touchDistance / supportLevel <= 0.002;
          });

          if (retestIndex > 0) {
            const brokenAgain = hasBreakout(candles, supportLevel, 'above', retestIndex + 1);

            if (brokenAgain) {
              const candlesSinceFlip = candles.length - retestIndex;
              const isRecent = candlesSinceFlip <= 5;

              return {
                type: 'Bullish S&R Flip',
                recent: isRecent,
                confidence: isRecent ? 85 : 70,
                description: `Support turned resistance at ${supportLevel.toFixed(5)}, now broken bullish`
              };
            }
          }
        }
      }
    }
  }

  return null;
}

/**
 * Detect bearish structure flip (resistance broken becomes support, then broken again)
 */
function detectBearishStructureFlip(candles: Candle[]): StructureAnalysis | null {
  const swingPoints = detectSwingPoints(candles, 2);

  const recentHighs = swingPoints
    .filter(p => p.type === 'high')
    .slice(-3);

  if (recentHighs.length < 2) return null;

  for (let i = 0; i < recentHighs.length - 1; i++) {
    const resistanceLevel = recentHighs[i].price;
    const resistanceIndex = recentHighs[i].index;

    const breakoutIndex = resistanceIndex + 1;
    const hasBrokenAbove = hasBreakout(candles, resistanceLevel, 'above', breakoutIndex);

    if (hasBrokenAbove) {
      const breakIndex = candles.findIndex((c, idx) => idx > resistanceIndex && c.close > resistanceLevel);

      if (breakIndex > 0) {
        const retested = hasRetest(candles, resistanceLevel, breakIndex + 1);

        if (retested) {
          const retestIndex = candles.findIndex((c, idx) => {
            if (idx <= breakIndex) return false;
            const touchDistance = Math.min(
              Math.abs(c.high - resistanceLevel),
              Math.abs(c.low - resistanceLevel)
            );
            return touchDistance / resistanceLevel <= 0.002;
          });

          if (retestIndex > 0) {
            const brokenAgain = hasBreakout(candles, resistanceLevel, 'below', retestIndex + 1);

            if (brokenAgain) {
              const candlesSinceFlip = candles.length - retestIndex;
              const isRecent = candlesSinceFlip <= 5;

              return {
                type: 'Bearish S&R Flip',
                recent: isRecent,
                confidence: isRecent ? 85 : 70,
                description: `Resistance turned support at ${resistanceLevel.toFixed(5)}, now broken bearish`
              };
            }
          }
        }
      }
    }
  }

  return null;
}

/**
 * Detect simple breakout structure
 */
function detectBreakoutStructure(candles: Candle[]): StructureAnalysis | null {
  if (candles.length < 20) return null;

  const recentCandles = candles.slice(-10);
  const previousCandles = candles.slice(-30, -10);

  const recentHigh = Math.max(...recentCandles.map(c => c.high));
  const recentLow = Math.min(...recentCandles.map(c => c.low));
  const previousHigh = Math.max(...previousCandles.map(c => c.high));
  const previousLow = Math.min(...previousCandles.map(c => c.low));

  const currentPrice = candles[candles.length - 1].close;

  if (currentPrice > previousHigh && currentPrice > recentHigh * 0.998) {
    return {
      type: 'Bullish Breakout',
      recent: true,
      confidence: 75,
      description: 'Price breaking above recent resistance'
    };
  }

  if (currentPrice < previousLow && currentPrice < recentLow * 1.002) {
    return {
      type: 'Bearish Breakdown',
      recent: true,
      confidence: 75,
      description: 'Price breaking below recent support'
    };
  }

  return null;
}

/**
 * Main structure analysis function
 */
export function analyzeStructure(candles: Candle[]): StructureAnalysis {
  if (candles.length < 15) {
    return {
      type: 'Insufficient Data',
      recent: false,
      confidence: 0,
      description: 'Not enough candles for structure analysis'
    };
  }

  const bullishFlip = detectBullishStructureFlip(candles);
  if (bullishFlip) return bullishFlip;

  const bearishFlip = detectBearishStructureFlip(candles);
  if (bearishFlip) return bearishFlip;

  const breakout = detectBreakoutStructure(candles);
  if (breakout) return breakout;

  return {
    type: 'Consolidation',
    recent: false,
    confidence: 60,
    description: 'Price consolidating without clear structure change'
  };
}
