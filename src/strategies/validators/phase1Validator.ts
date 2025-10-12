import { Candle } from '../../lib/indicators';
import { Phase1MacroBias } from '../types';

export function validatePhase1MacroBias(h1Candles: Candle[]): Phase1MacroBias {
  if (h1Candles.length < 1) {
    return {
      passed: false,
      bias: 'NEUTRAL',
      h1CandleType: 'neutral',
      confidence: 0,
      reason: 'Insufficient H1 candle data'
    };
  }

  const lastH1Candle = h1Candles[h1Candles.length - 1];
  const isBullish = lastH1Candle.close > lastH1Candle.open;
  const isBearish = lastH1Candle.close < lastH1Candle.open;

  const bodySize = Math.abs(lastH1Candle.close - lastH1Candle.open);
  const totalRange = lastH1Candle.high - lastH1Candle.low;
  const bodyPercentage = totalRange > 0 ? (bodySize / totalRange) * 100 : 0;

  let bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let h1CandleType: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let confidence = 0;
  let reason = '';

  if (isBullish && bodyPercentage > 50) {
    bias = 'BULLISH';
    h1CandleType = 'bullish';
    confidence = Math.min(bodyPercentage, 95);
    reason = `H1 candle is bullish (${bodyPercentage.toFixed(1)}% body). Allow only BUY trades.`;
  } else if (isBearish && bodyPercentage > 50) {
    bias = 'BEARISH';
    h1CandleType = 'bearish';
    confidence = Math.min(bodyPercentage, 95);
    reason = `H1 candle is bearish (${bodyPercentage.toFixed(1)}% body). Allow only SELL trades.`;
  } else if (isBullish) {
    bias = 'BULLISH';
    h1CandleType = 'bullish';
    confidence = Math.min(bodyPercentage + 20, 70);
    reason = `H1 candle is weakly bullish (${bodyPercentage.toFixed(1)}% body). Prefer BUY trades with caution.`;
  } else if (isBearish) {
    bias = 'BEARISH';
    h1CandleType = 'bearish';
    confidence = Math.min(bodyPercentage + 20, 70);
    reason = `H1 candle is weakly bearish (${bodyPercentage.toFixed(1)}% body). Prefer SELL trades with caution.`;
  } else {
    bias = 'NEUTRAL';
    h1CandleType = 'neutral';
    confidence = 30;
    reason = `H1 candle is neutral (${bodyPercentage.toFixed(1)}% body). No clear directional bias.`;
  }

  const passed = bias !== 'NEUTRAL' && confidence >= 50;

  return {
    passed,
    bias,
    h1CandleType,
    confidence: Math.round(confidence),
    reason
  };
}

export function isDirectionAllowedByMacroBias(
  phase1: Phase1MacroBias,
  direction: 'BUY' | 'SELL'
): boolean {
  if (phase1.bias === 'NEUTRAL') {
    return false;
  }

  if (direction === 'BUY' && phase1.bias === 'BULLISH') {
    return true;
  }

  if (direction === 'SELL' && phase1.bias === 'BEARISH') {
    return true;
  }

  return false;
}
