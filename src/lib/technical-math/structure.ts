/**
 * Market Structure Utilities
 *
 * Pure mathematical functions for structure analysis (HH/HL/LL/LH).
 */

export type StructurePattern = 'HH_HL' | 'LL_LH' | 'HH_LL' | 'LL_HH' | 'RANGE' | 'UNKNOWN';

export interface StructureAnalysis {
  pattern: StructurePattern;
  bias: 'BULL' | 'BEAR' | 'NEUTRAL';
  strength: number;
  lastSwingHigh: number;
  lastSwingLow: number;
}

export interface SwingPoint {
  type: 'HIGH' | 'LOW';
  price: number;
  index: number;
}

export function detectSwingPoints(
  highs: number[],
  lows: number[],
  lookback: number = 5
): SwingPoint[] {
  const swings: SwingPoint[] = [];

  for (let i = lookback; i < highs.length - lookback; i++) {
    const leftHighs = highs.slice(i - lookback, i);
    const rightHighs = highs.slice(i + 1, i + lookback + 1);
    const currentHigh = highs[i];

    if (currentHigh > Math.max(...leftHighs) && currentHigh > Math.max(...rightHighs)) {
      swings.push({ type: 'HIGH', price: currentHigh, index: i });
    }

    const leftLows = lows.slice(i - lookback, i);
    const rightLows = lows.slice(i + 1, i + lookback + 1);
    const currentLow = lows[i];

    if (currentLow < Math.min(...leftLows) && currentLow < Math.min(...rightLows)) {
      swings.push({ type: 'LOW', price: currentLow, index: i });
    }
  }

  return swings.sort((a, b) => a.index - b.index);
}

export function analyzeStructure(swings: SwingPoint[]): StructureAnalysis {
  if (swings.length < 4) {
    return {
      pattern: 'UNKNOWN',
      bias: 'NEUTRAL',
      strength: 0,
      lastSwingHigh: swings.find(s => s.type === 'HIGH')?.price || 0,
      lastSwingLow: swings.find(s => s.type === 'LOW')?.price || 0
    };
  }

  const recentSwings = swings.slice(-4);
  const highs = recentSwings.filter(s => s.type === 'HIGH').map(s => s.price);
  const lows = recentSwings.filter(s => s.type === 'LOW').map(s => s.price);

  const lastSwingHigh = highs.length > 0 ? highs[highs.length - 1] : 0;
  const lastSwingLow = lows.length > 0 ? lows[lows.length - 1] : 0;

  let isHigherHighs = false;
  let isHigherLows = false;
  let isLowerHighs = false;
  let isLowerLows = false;

  if (highs.length >= 2) {
    isHigherHighs = highs[highs.length - 1] > highs[highs.length - 2];
    isLowerHighs = highs[highs.length - 1] < highs[highs.length - 2];
  }

  if (lows.length >= 2) {
    isHigherLows = lows[lows.length - 1] > lows[lows.length - 2];
    isLowerLows = lows[lows.length - 1] < lows[lows.length - 2];
  }

  let pattern: StructurePattern;
  let bias: 'BULL' | 'BEAR' | 'NEUTRAL';
  let strength = 50;

  if (isHigherHighs && isHigherLows) {
    pattern = 'HH_HL';
    bias = 'BULL';
    strength = 80;
  } else if (isLowerHighs && isLowerLows) {
    pattern = 'LL_LH';
    bias = 'BEAR';
    strength = 80;
  } else if (isHigherHighs && isLowerLows) {
    pattern = 'HH_LL';
    bias = 'NEUTRAL';
    strength = 40;
  } else if (isLowerHighs && isHigherLows) {
    pattern = 'RANGE';
    bias = 'NEUTRAL';
    strength = 30;
  } else {
    pattern = 'UNKNOWN';
    bias = 'NEUTRAL';
    strength = 20;
  }

  return {
    pattern,
    bias,
    strength,
    lastSwingHigh,
    lastSwingLow
  };
}

export function formatStructureEvidence(analysis: StructureAnalysis): string {
  return `STRUCTURE=${analysis.pattern}|BIAS=${analysis.bias}|STRENGTH=${analysis.strength}`;
}
