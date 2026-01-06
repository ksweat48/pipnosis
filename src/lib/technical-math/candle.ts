/**
 * Candle Analysis Utilities
 *
 * Pure mathematical functions for candlestick analysis.
 */

export interface CandleMetrics {
  bodySize: number;
  upperWick: number;
  lowerWick: number;
  totalRange: number;
  bodyRatio: number;
  isBullish: boolean;
}

export interface ExhaustionScore {
  score: number;
  level: 'NONE' | 'MILD' | 'MODERATE' | 'STRONG';
  signals: string[];
}

export function analyzeCandleMetrics(
  open: number,
  high: number,
  low: number,
  close: number
): CandleMetrics {
  const bodySize = Math.abs(close - open);
  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;
  const totalRange = high - low;
  const bodyRatio = totalRange > 0 ? bodySize / totalRange : 0;
  const isBullish = close > open;

  return {
    bodySize,
    upperWick,
    lowerWick,
    totalRange,
    bodyRatio,
    isBullish
  };
}

export function calculateExhaustion(
  candles: Array<{ open: number; high: number; low: number; close: number }>,
  rsi: number
): ExhaustionScore {
  if (candles.length < 3) {
    return { score: 0, level: 'NONE', signals: [] };
  }

  const signals: string[] = [];
  let score = 0;

  const recent = candles.slice(-3);
  const avgWickRatio = recent.reduce((sum, c) => {
    const metrics = analyzeCandleMetrics(c.open, c.high, c.low, c.close);
    const wickRatio = metrics.totalRange > 0
      ? (metrics.upperWick + metrics.lowerWick) / metrics.totalRange
      : 0;
    return sum + wickRatio;
  }, 0) / recent.length;

  if (avgWickRatio > 0.5) {
    score += 25;
    signals.push('HIGH_WICK_RATIO');
  }

  if (rsi > 75) {
    score += 25;
    signals.push('RSI_OVERBOUGHT');
  } else if (rsi < 25) {
    score += 25;
    signals.push('RSI_OVERSOLD');
  }

  const lastCandle = analyzeCandleMetrics(
    recent[2].open,
    recent[2].high,
    recent[2].low,
    recent[2].close
  );

  if (lastCandle.bodyRatio < 0.3) {
    score += 20;
    signals.push('DOJI_PATTERN');
  }

  const consecutiveSameDirection = recent.every(c => c.close > c.open) ||
                                    recent.every(c => c.close < c.open);
  if (consecutiveSameDirection) {
    score += 15;
    signals.push('CONSECUTIVE_DIRECTION');
  }

  let level: 'NONE' | 'MILD' | 'MODERATE' | 'STRONG';
  if (score >= 60) {
    level = 'STRONG';
  } else if (score >= 40) {
    level = 'MODERATE';
  } else if (score >= 20) {
    level = 'MILD';
  } else {
    level = 'NONE';
  }

  return { score, level, signals };
}

export function detectMomentumBar(
  candle: { open: number; high: number; low: number; close: number },
  atr: number
): boolean {
  const metrics = analyzeCandleMetrics(candle.open, candle.high, candle.low, candle.close);
  return metrics.bodyRatio > 0.7 && metrics.totalRange > atr * 0.8;
}

export function formatCandleEvidence(metrics: CandleMetrics, exhaustion: ExhaustionScore): string {
  const dir = metrics.isBullish ? 'BULL' : 'BEAR';
  return `CANDLE=${dir}|BODY_RATIO=${metrics.bodyRatio.toFixed(2)}|EXHAUSTION=${exhaustion.level}`;
}
