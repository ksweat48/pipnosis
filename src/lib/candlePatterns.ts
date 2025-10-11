/**
 * Candle Pattern Detection System
 * Identifies common candlestick patterns and assigns strength ratings
 */

import { Candle } from './indicators';

export interface CandleSignal {
  type: string;
  strength: 'Weak' | 'Moderate' | 'Strong' | null;
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
}

/**
 * Calculate candle body size
 */
function getBodySize(candle: Candle): number {
  return Math.abs(candle.close - candle.open);
}

/**
 * Calculate upper wick size
 */
function getUpperWickSize(candle: Candle): number {
  return candle.high - Math.max(candle.open, candle.close);
}

/**
 * Calculate lower wick size
 */
function getLowerWickSize(candle: Candle): number {
  return Math.min(candle.open, candle.close) - candle.low;
}

/**
 * Get candle range
 */
function getCandleRange(candle: Candle): number {
  return candle.high - candle.low;
}

/**
 * Check if candle is bullish
 */
function isBullish(candle: Candle): boolean {
  return candle.close > candle.open;
}

/**
 * Check if candle is bearish
 */
function isBearish(candle: Candle): boolean {
  return candle.close < candle.open;
}

/**
 * Detect Bullish Engulfing Pattern
 */
function detectBullishEngulfing(candles: Candle[]): CandleSignal | null {
  if (candles.length < 2) return null;

  const current = candles[candles.length - 1];
  const previous = candles[candles.length - 2];

  if (!isBearish(previous) || !isBullish(current)) return null;

  const currentBody = getBodySize(current);
  const previousBody = getBodySize(previous);

  if (current.open <= previous.close && current.close > previous.open) {
    const engulfRatio = currentBody / previousBody;
    const volumeRatio = current.volume > 0 && previous.volume > 0
      ? current.volume / previous.volume
      : 1;

    let strength: 'Weak' | 'Moderate' | 'Strong' = 'Weak';
    let confidence = 60;

    if (engulfRatio >= 1.5 && volumeRatio >= 1.2) {
      strength = 'Strong';
      confidence = 85;
    } else if (engulfRatio >= 1.2 && volumeRatio >= 1.0) {
      strength = 'Moderate';
      confidence = 75;
    }

    return {
      type: 'Bullish Engulfing',
      strength,
      direction: 'bullish',
      confidence
    };
  }

  return null;
}

/**
 * Detect Bearish Engulfing Pattern
 */
function detectBearishEngulfing(candles: Candle[]): CandleSignal | null {
  if (candles.length < 2) return null;

  const current = candles[candles.length - 1];
  const previous = candles[candles.length - 2];

  if (!isBullish(previous) || !isBearish(current)) return null;

  const currentBody = getBodySize(current);
  const previousBody = getBodySize(previous);

  if (current.open >= previous.close && current.close < previous.open) {
    const engulfRatio = currentBody / previousBody;
    const volumeRatio = current.volume > 0 && previous.volume > 0
      ? current.volume / previous.volume
      : 1;

    let strength: 'Weak' | 'Moderate' | 'Strong' = 'Weak';
    let confidence = 60;

    if (engulfRatio >= 1.5 && volumeRatio >= 1.2) {
      strength = 'Strong';
      confidence = 85;
    } else if (engulfRatio >= 1.2 && volumeRatio >= 1.0) {
      strength = 'Moderate';
      confidence = 75;
    }

    return {
      type: 'Bearish Engulfing',
      strength,
      direction: 'bearish',
      confidence
    };
  }

  return null;
}

/**
 * Detect Hammer Pattern (Bullish Reversal)
 */
function detectHammer(candle: Candle): CandleSignal | null {
  const body = getBodySize(candle);
  const lowerWick = getLowerWickSize(candle);
  const upperWick = getUpperWickSize(candle);
  const range = getCandleRange(candle);

  if (range === 0) return null;

  const bodyRatio = body / range;
  const lowerWickRatio = lowerWick / range;
  const upperWickRatio = upperWick / range;

  if (bodyRatio <= 0.3 && lowerWickRatio >= 0.6 && upperWickRatio <= 0.1) {
    let strength: 'Weak' | 'Moderate' | 'Strong' = 'Weak';
    let confidence = 65;

    if (lowerWickRatio >= 0.7 && bodyRatio <= 0.2) {
      strength = 'Strong';
      confidence = 85;
    } else if (lowerWickRatio >= 0.65) {
      strength = 'Moderate';
      confidence = 75;
    }

    return {
      type: 'Hammer',
      strength,
      direction: 'bullish',
      confidence
    };
  }

  return null;
}

/**
 * Detect Shooting Star Pattern (Bearish Reversal)
 */
function detectShootingStar(candle: Candle): CandleSignal | null {
  const body = getBodySize(candle);
  const lowerWick = getLowerWickSize(candle);
  const upperWick = getUpperWickSize(candle);
  const range = getCandleRange(candle);

  if (range === 0) return null;

  const bodyRatio = body / range;
  const lowerWickRatio = lowerWick / range;
  const upperWickRatio = upperWick / range;

  if (bodyRatio <= 0.3 && upperWickRatio >= 0.6 && lowerWickRatio <= 0.1) {
    let strength: 'Weak' | 'Moderate' | 'Strong' = 'Weak';
    let confidence = 65;

    if (upperWickRatio >= 0.7 && bodyRatio <= 0.2) {
      strength = 'Strong';
      confidence = 85;
    } else if (upperWickRatio >= 0.65) {
      strength = 'Moderate';
      confidence = 75;
    }

    return {
      type: 'Shooting Star',
      strength,
      direction: 'bearish',
      confidence
    };
  }

  return null;
}

/**
 * Detect Doji Pattern (Indecision)
 */
function detectDoji(candle: Candle): CandleSignal | null {
  const body = getBodySize(candle);
  const range = getCandleRange(candle);

  if (range === 0) return null;

  const bodyRatio = body / range;

  if (bodyRatio <= 0.1) {
    let strength: 'Weak' | 'Moderate' | 'Strong' = 'Moderate';
    let confidence = 70;

    if (bodyRatio <= 0.05) {
      strength = 'Strong';
      confidence = 80;
    }

    return {
      type: 'Doji',
      strength,
      direction: 'neutral',
      confidence
    };
  }

  return null;
}

/**
 * Detect Pin Bar Pattern
 */
function detectPinBar(candle: Candle): CandleSignal | null {
  const body = getBodySize(candle);
  const lowerWick = getLowerWickSize(candle);
  const upperWick = getUpperWickSize(candle);
  const range = getCandleRange(candle);

  if (range === 0) return null;

  const bodyRatio = body / range;

  if (bodyRatio <= 0.35) {
    if (lowerWick / range >= 0.6 && upperWick / range <= 0.2) {
      return {
        type: 'Bullish Pin Bar',
        strength: lowerWick / range >= 0.7 ? 'Strong' : 'Moderate',
        direction: 'bullish',
        confidence: 75
      };
    }

    if (upperWick / range >= 0.6 && lowerWick / range <= 0.2) {
      return {
        type: 'Bearish Pin Bar',
        strength: upperWick / range >= 0.7 ? 'Strong' : 'Moderate',
        direction: 'bearish',
        confidence: 75
      };
    }
  }

  return null;
}

/**
 * Main pattern detection function
 * Analyzes last 3-5 candles for patterns
 */
export function detectCandlePattern(candles: Candle[]): CandleSignal {
  if (candles.length < 2) {
    return {
      type: 'None',
      strength: null,
      direction: 'neutral',
      confidence: 0
    };
  }

  const recentCandles = candles.slice(-5);
  const lastCandle = candles[candles.length - 1];

  const patterns: CandleSignal[] = [];

  const bullishEngulfing = detectBullishEngulfing(recentCandles);
  if (bullishEngulfing) patterns.push(bullishEngulfing);

  const bearishEngulfing = detectBearishEngulfing(recentCandles);
  if (bearishEngulfing) patterns.push(bearishEngulfing);

  const hammer = detectHammer(lastCandle);
  if (hammer) patterns.push(hammer);

  const shootingStar = detectShootingStar(lastCandle);
  if (shootingStar) patterns.push(shootingStar);

  const doji = detectDoji(lastCandle);
  if (doji) patterns.push(doji);

  const pinBar = detectPinBar(lastCandle);
  if (pinBar) patterns.push(pinBar);

  if (patterns.length === 0) {
    return {
      type: 'None',
      strength: null,
      direction: 'neutral',
      confidence: 0
    };
  }

  patterns.sort((a, b) => b.confidence - a.confidence);

  return patterns[0];
}

/**
 * Check if pattern strength is sufficient for trading
 */
export function isPatternStrong(signal: CandleSignal): boolean {
  return signal.strength === 'Strong' || signal.strength === 'Moderate';
}
