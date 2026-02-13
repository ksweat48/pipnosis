/**
 * Momentum Analysis Utilities
 *
 * Pure mathematical functions for momentum-based analysis.
 *
 * TIER 4 FIX: Added real swing-point detection for accurate divergence analysis
 * - Identifies actual swing highs/lows using pivot comparison
 * - Replaces crude "last 2 values" approach
 * - Compares indicator values at swing points for true divergence
 */

export interface MomentumAnalysis {
  value: number;
  direction: 'STRONG_BULL' | 'BULL' | 'NEUTRAL' | 'BEAR' | 'STRONG_BEAR';
  strength: number;
}

export interface DivergenceAnalysis {
  type: 'BULLISH' | 'BEARISH' | 'NONE';
  strength: 'WEAK' | 'MODERATE' | 'STRONG';
  indicator: string;
  swingPointsUsed?: number; // How many swing points were compared
}

export interface SwingPoint {
  index: number;
  price: number;
  indicatorValue: number;
  type: 'HIGH' | 'LOW';
}

/**
 * Detect swing highs - price points where the candle is higher than N bars on each side
 * TIER 4 FIX: Real swing-point detection using pivot comparison
 */
export function detectSwingHighs(
  prices: number[],
  indicatorValues: number[],
  lookback: number = 2
): SwingPoint[] {
  const swingHighs: SwingPoint[] = [];

  // Need at least lookback bars on each side
  for (let i = lookback; i < prices.length - lookback; i++) {
    const currentPrice = prices[i];
    let isSwingHigh = true;

    // Check left side
    for (let j = 1; j <= lookback; j++) {
      if (prices[i - j] >= currentPrice) {
        isSwingHigh = false;
        break;
      }
    }

    // Check right side
    if (isSwingHigh) {
      for (let j = 1; j <= lookback; j++) {
        if (prices[i + j] >= currentPrice) {
          isSwingHigh = false;
          break;
        }
      }
    }

    if (isSwingHigh) {
      swingHighs.push({
        index: i,
        price: currentPrice,
        indicatorValue: indicatorValues[i] || 0,
        type: 'HIGH'
      });
    }
  }

  return swingHighs;
}

/**
 * Detect swing lows - price points where the candle is lower than N bars on each side
 * TIER 4 FIX: Real swing-point detection using pivot comparison
 */
export function detectSwingLows(
  prices: number[],
  indicatorValues: number[],
  lookback: number = 2
): SwingPoint[] {
  const swingLows: SwingPoint[] = [];

  // Need at least lookback bars on each side
  for (let i = lookback; i < prices.length - lookback; i++) {
    const currentPrice = prices[i];
    let isSwingLow = true;

    // Check left side
    for (let j = 1; j <= lookback; j++) {
      if (prices[i - j] <= currentPrice) {
        isSwingLow = false;
        break;
      }
    }

    // Check right side
    if (isSwingLow) {
      for (let j = 1; j <= lookback; j++) {
        if (prices[i + j] <= currentPrice) {
          isSwingLow = false;
          break;
        }
      }
    }

    if (isSwingLow) {
      swingLows.push({
        index: i,
        price: currentPrice,
        indicatorValue: indicatorValues[i] || 0,
        type: 'LOW'
      });
    }
  }

  return swingLows;
}

export function analyzeMomentum(momentum: number): MomentumAnalysis {
  let direction: 'STRONG_BULL' | 'BULL' | 'NEUTRAL' | 'BEAR' | 'STRONG_BEAR';
  let strength: number;

  if (momentum >= 60) {
    direction = 'STRONG_BULL';
    strength = Math.min(100, 70 + (momentum - 60));
  } else if (momentum >= 20) {
    direction = 'BULL';
    strength = 50 + momentum * 0.5;
  } else if (momentum >= -20) {
    direction = 'NEUTRAL';
    strength = 30 + Math.abs(momentum);
  } else if (momentum >= -60) {
    direction = 'BEAR';
    strength = 50 + Math.abs(momentum) * 0.5;
  } else {
    direction = 'STRONG_BEAR';
    strength = Math.min(100, 70 + Math.abs(momentum + 60));
  }

  return {
    value: momentum,
    direction,
    strength: Math.round(strength)
  };
}

/**
 * Detect RSI divergence using real swing-point comparison
 * TIER 4 FIX: Uses actual swing highs/lows instead of crude last-2-values approach
 *
 * Bearish Divergence: Price makes higher high, RSI makes lower high
 * Bullish Divergence: Price makes lower low, RSI makes higher low
 */
export function detectRSIDivergence(
  prices: number[],
  rsiValues: number[],
  currentRSI: number,
  lookback: number = 2
): DivergenceAnalysis {
  if (prices.length < 10 || rsiValues.length < 10) {
    return { type: 'NONE', strength: 'WEAK', indicator: 'RSI', swingPointsUsed: 0 };
  }

  // Detect actual swing points
  const swingHighs = detectSwingHighs(prices, rsiValues, lookback);
  const swingLows = detectSwingLows(prices, rsiValues, lookback);

  // Check for bearish divergence (price higher high, RSI lower high)
  if (swingHighs.length >= 2 && currentRSI > 60) {
    const lastHigh = swingHighs[swingHighs.length - 1];
    const prevHigh = swingHighs[swingHighs.length - 2];

    // Price making higher high, RSI making lower high = bearish divergence
    if (lastHigh.price > prevHigh.price && lastHigh.indicatorValue < prevHigh.indicatorValue) {
      const priceDiff = (lastHigh.price - prevHigh.price) / prevHigh.price;
      const rsiDiff = prevHigh.indicatorValue - lastHigh.indicatorValue;

      const strength = priceDiff > 0.02 && rsiDiff > 10 ? 'STRONG' :
                       priceDiff > 0.01 && rsiDiff > 5 ? 'MODERATE' : 'WEAK';

      return {
        type: 'BEARISH',
        strength,
        indicator: 'RSI',
        swingPointsUsed: swingHighs.length
      };
    }
  }

  // Check for bullish divergence (price lower low, RSI higher low)
  if (swingLows.length >= 2 && currentRSI < 40) {
    const lastLow = swingLows[swingLows.length - 1];
    const prevLow = swingLows[swingLows.length - 2];

    // Price making lower low, RSI making higher low = bullish divergence
    if (lastLow.price < prevLow.price && lastLow.indicatorValue > prevLow.indicatorValue) {
      const priceDiff = (prevLow.price - lastLow.price) / prevLow.price;
      const rsiDiff = lastLow.indicatorValue - prevLow.indicatorValue;

      const strength = priceDiff > 0.02 && rsiDiff > 10 ? 'STRONG' :
                       priceDiff > 0.01 && rsiDiff > 5 ? 'MODERATE' : 'WEAK';

      return {
        type: 'BULLISH',
        strength,
        indicator: 'RSI',
        swingPointsUsed: swingLows.length
      };
    }
  }

  return {
    type: 'NONE',
    strength: 'WEAK',
    indicator: 'RSI',
    swingPointsUsed: Math.max(swingHighs.length, swingLows.length)
  };
}

/**
 * Legacy wrapper for backward compatibility
 * DEPRECATED: Use detectRSIDivergence(prices, rsiValues, currentRSI) instead
 */
export function detectRSIDivergenceLegacy(
  priceHighs: number[],
  priceLows: number[],
  rsiHighs: number[],
  rsiLows: number[],
  currentRSI: number
): DivergenceAnalysis {
  // Reconstruct price array from highs and lows (imperfect but maintains compatibility)
  const prices = [...priceHighs, ...priceLows].sort((a, b) => a - b);
  const rsiValues = [...rsiHighs, ...rsiLows].sort((a, b) => a - b);

  return detectRSIDivergence(prices, rsiValues, currentRSI);
}

export function formatMomentumEvidence(analysis: MomentumAnalysis): string {
  return `MOM_DIR=${analysis.direction}|MOM_VAL=${analysis.value}|MOM_STR=${analysis.strength}`;
}
