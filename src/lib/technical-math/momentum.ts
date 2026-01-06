/**
 * Momentum Analysis Utilities
 *
 * Pure mathematical functions for momentum-based analysis.
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

export function detectRSIDivergence(
  priceHighs: number[],
  priceLows: number[],
  rsiHighs: number[],
  rsiLows: number[],
  currentRSI: number
): DivergenceAnalysis {
  if (priceHighs.length < 2 || priceLows.length < 2 ||
      rsiHighs.length < 2 || rsiLows.length < 2) {
    return { type: 'NONE', strength: 'WEAK', indicator: 'RSI' };
  }

  const lastPriceHigh = priceHighs[priceHighs.length - 1];
  const prevPriceHigh = priceHighs[priceHighs.length - 2];
  const lastRSIHigh = rsiHighs[rsiHighs.length - 1];
  const prevRSIHigh = rsiHighs[rsiHighs.length - 2];

  if (lastPriceHigh > prevPriceHigh && lastRSIHigh < prevRSIHigh && currentRSI > 60) {
    const priceDiff = (lastPriceHigh - prevPriceHigh) / prevPriceHigh;
    const rsiDiff = prevRSIHigh - lastRSIHigh;
    const strength = priceDiff > 0.02 && rsiDiff > 10 ? 'STRONG' :
                     priceDiff > 0.01 && rsiDiff > 5 ? 'MODERATE' : 'WEAK';
    return { type: 'BEARISH', strength, indicator: 'RSI' };
  }

  const lastPriceLow = priceLows[priceLows.length - 1];
  const prevPriceLow = priceLows[priceLows.length - 2];
  const lastRSILow = rsiLows[rsiLows.length - 1];
  const prevRSILow = rsiLows[rsiLows.length - 2];

  if (lastPriceLow < prevPriceLow && lastRSILow > prevRSILow && currentRSI < 40) {
    const priceDiff = (prevPriceLow - lastPriceLow) / prevPriceLow;
    const rsiDiff = lastRSILow - prevRSILow;
    const strength = priceDiff > 0.02 && rsiDiff > 10 ? 'STRONG' :
                     priceDiff > 0.01 && rsiDiff > 5 ? 'MODERATE' : 'WEAK';
    return { type: 'BULLISH', strength, indicator: 'RSI' };
  }

  return { type: 'NONE', strength: 'WEAK', indicator: 'RSI' };
}

export function formatMomentumEvidence(analysis: MomentumAnalysis): string {
  return `MOM_DIR=${analysis.direction}|MOM_VAL=${analysis.value}|MOM_STR=${analysis.strength}`;
}
