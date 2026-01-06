/**
 * EMA (Exponential Moving Average) Utilities
 *
 * Pure mathematical functions for EMA-based analysis.
 */

export interface EMAAlignment {
  stack: 'BULL' | 'BEAR' | 'MIXED';
  strength: number;
  e20_above_e50: boolean;
  e50_above_e200: boolean;
  e20_above_e200: boolean;
}

export interface EMASlope {
  ema20: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  magnitude: number;
}

export function calculateEMAAlignment(
  price: number,
  ema20: number,
  ema50: number,
  ema200: number
): EMAAlignment {
  const e20_above_e50 = ema20 > ema50;
  const e50_above_e200 = ema50 > ema200;
  const e20_above_e200 = ema20 > ema200;

  let stack: 'BULL' | 'BEAR' | 'MIXED';
  let strength = 0;

  if (e20_above_e50 && e50_above_e200 && e20_above_e200) {
    stack = 'BULL';
    const priceAbove20 = price > ema20;
    const separation = Math.abs(ema20 - ema200) / ema200;
    strength = priceAbove20 ? Math.min(100, 60 + separation * 200) : Math.min(80, 40 + separation * 200);
  } else if (!e20_above_e50 && !e50_above_e200 && !e20_above_e200) {
    stack = 'BEAR';
    const priceBelow20 = price < ema20;
    const separation = Math.abs(ema200 - ema20) / ema200;
    strength = priceBelow20 ? Math.min(100, 60 + separation * 200) : Math.min(80, 40 + separation * 200);
  } else {
    stack = 'MIXED';
    const alignCount = [e20_above_e50, e50_above_e200, e20_above_e200].filter(Boolean).length;
    strength = alignCount === 2 ? 40 : 20;
  }

  return {
    stack,
    strength: Math.round(strength),
    e20_above_e50,
    e50_above_e200,
    e20_above_e200
  };
}

export function calculateEMASlope(
  currentEma20: number,
  previousEma20: number,
  atr: number
): EMASlope {
  const change = currentEma20 - previousEma20;
  const normalizedChange = atr > 0 ? change / atr : 0;

  let direction: 'UP' | 'DOWN' | 'FLAT';
  if (normalizedChange > 0.05) {
    direction = 'UP';
  } else if (normalizedChange < -0.05) {
    direction = 'DOWN';
  } else {
    direction = 'FLAT';
  }

  return {
    ema20: currentEma20,
    direction,
    magnitude: Math.abs(normalizedChange)
  };
}

export function formatEMAEvidence(alignment: EMAAlignment, slope: EMASlope): string {
  const parts = [
    `EMA_STACK=${alignment.stack}`,
    `STRENGTH=${alignment.strength}`,
    `SLOPE_20=${slope.direction}(${slope.magnitude.toFixed(2)})`
  ];
  return parts.join('|');
}
