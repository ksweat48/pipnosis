/**
 * AI Market Analysis Engine
 * Orchestrates all technical analysis and generates comprehensive market assessments
 */

import {
  Candle,
  calculateRSI,
  getRSIStatus,
  calculateVWAP,
  getVWAPPosition,
  analyzeVolume,
  calculateATR,
  getATRStatus,
  VolumeAnalysis
} from './indicators';

import { detectCandlePattern, isPatternStrong, CandleSignal } from './candlePatterns';
import { analyzeStructure, StructureAnalysis } from './structureAnalysis';
import { calculateEMAs, generateEMASignals, calculateEMALevels, EMASignals, EMAValues, EMALevels } from './emaAnalysis';
import { detectAdvancedPattern, AdvancedPattern } from './advancedPatterns';
import { getATRTooltip } from './indicators';

export interface AiMarketSummary {
  rsi: {
    value: number;
    status: 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL';
    trend: 'rising' | 'falling' | 'neutral';
  };
  vwap: {
    value: number;
    position: 'Above VWAP' | 'Below VWAP' | 'Near VWAP';
  };
  volume: {
    status: 'LOW' | 'STABLE' | 'HIGH';
    delta: string;
    currentVolume: number;
    averageVolume: number;
  };
  atr: {
    value: number;
    status: 'LOW' | 'NORMAL' | 'HIGH';
    tooltip: string;
  };
  candleSignal: {
    type: string;
    strength: 'Weak' | 'Moderate' | 'Strong' | null;
  };
  structure: {
    type: string;
    recent: boolean;
  };
  advancedPattern: AdvancedPattern;
  ema: {
    signals: EMASignals;
    values: EMAValues;
    levels: EMALevels;
  };
  sentiment: {
    status: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    confidence: number;
  };
  tradeSignal: {
    status: 'VALID' | 'INVALID';
    direction?: 'BUY' | 'SELL';
    confidence?: number;
    reason?: string;
  };
  aiCommentary: string;
  metadata: {
    candlesAnalyzed: number;
    timestamp: Date;
  };
}

/**
 * Detect RSI trend direction
 */
function detectRSITrend(candles: Candle[]): 'rising' | 'falling' | 'neutral' {
  if (candles.length < 5) return 'neutral';

  const recentCandles = candles.slice(-5);
  const rsiValues = [];

  for (let i = 0; i < recentCandles.length; i++) {
    const subset = candles.slice(0, candles.length - recentCandles.length + i + 1);
    if (subset.length >= 15) {
      try {
        const rsi = calculateRSI(subset, 14);
        rsiValues.push(rsi);
      } catch {
        continue;
      }
    }
  }

  if (rsiValues.length < 3) return 'neutral';

  let risingCount = 0;
  let fallingCount = 0;

  for (let i = 1; i < rsiValues.length; i++) {
    if (rsiValues[i] > rsiValues[i - 1]) risingCount++;
    if (rsiValues[i] < rsiValues[i - 1]) fallingCount++;
  }

  if (risingCount > fallingCount && risingCount >= 2) return 'rising';
  if (fallingCount > risingCount && fallingCount >= 2) return 'falling';
  return 'neutral';
}

/**
 * Analyze candle body trends
 */
function analyzeCandleBodyTrend(candles: Candle[]): 'bullish' | 'bearish' | 'neutral' {
  if (candles.length < 3) return 'neutral';

  const recentCandles = candles.slice(-5);
  let bullishBodies = 0;
  let bearishBodies = 0;

  for (const candle of recentCandles) {
    const bodySize = Math.abs(candle.close - candle.open);
    const range = candle.high - candle.low;

    if (bodySize > range * 0.5) {
      if (candle.close > candle.open) bullishBodies++;
      else bearishBodies++;
    }
  }

  if (bullishBodies >= 3) return 'bullish';
  if (bearishBodies >= 3) return 'bearish';
  return 'neutral';
}

/**
 * Calculate sentiment score based on multiple factors
 */
function calculateSentiment(
  rsiStatus: string,
  rsiTrend: 'rising' | 'falling' | 'neutral',
  vwapPosition: string,
  volumeStatus: string,
  candleSignal: CandleSignal,
  structure: StructureAnalysis,
  atrStatus: string,
  candleBodyTrend: 'bullish' | 'bearish' | 'neutral',
  advancedPattern: AdvancedPattern,
  emaSignals?: EMASignals
): { status: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; confidence: number } {
  let bullishScore = 0;
  let bearishScore = 0;
  let totalWeight = 0;

  if (rsiStatus === 'OVERSOLD') {
    bullishScore += 20;
    totalWeight += 20;
  } else if (rsiStatus === 'OVERBOUGHT') {
    bearishScore += 20;
    totalWeight += 20;
  } else {
    totalWeight += 10;
  }

  if (rsiTrend === 'rising') {
    bullishScore += 12;
    totalWeight += 12;
  } else if (rsiTrend === 'falling') {
    bearishScore += 12;
    totalWeight += 12;
  } else {
    totalWeight += 5;
  }

  if (candleBodyTrend === 'bullish') {
    bullishScore += 15;
    totalWeight += 15;
  } else if (candleBodyTrend === 'bearish') {
    bearishScore += 15;
    totalWeight += 15;
  } else {
    totalWeight += 5;
  }

  if (advancedPattern.type !== 'None' && advancedPattern.isValid) {
    const weight = Math.floor(advancedPattern.confidence / 5);
    if (advancedPattern.direction === 'bullish') {
      bullishScore += weight;
    } else if (advancedPattern.direction === 'bearish') {
      bearishScore += weight;
    }
    totalWeight += weight;
  }

  if (vwapPosition === 'Above VWAP') {
    bullishScore += 15;
    totalWeight += 15;
  } else if (vwapPosition === 'Below VWAP') {
    bearishScore += 15;
    totalWeight += 15;
  } else {
    totalWeight += 10;
  }

  if (volumeStatus === 'HIGH') {
    bullishScore += 10;
    bearishScore += 10;
    totalWeight += 10;
  } else if (volumeStatus === 'LOW') {
    totalWeight += 5;
  } else {
    totalWeight += 8;
  }

  if (candleSignal.direction === 'bullish' && candleSignal.strength) {
    const weight = candleSignal.strength === 'Strong' ? 25 : candleSignal.strength === 'Moderate' ? 15 : 8;
    bullishScore += weight;
    totalWeight += weight;
  } else if (candleSignal.direction === 'bearish' && candleSignal.strength) {
    const weight = candleSignal.strength === 'Strong' ? 25 : candleSignal.strength === 'Moderate' ? 15 : 8;
    bearishScore += weight;
    totalWeight += weight;
  }

  if (structure.type.includes('Bullish')) {
    const weight = structure.recent ? 20 : 10;
    bullishScore += weight;
    totalWeight += weight;
  } else if (structure.type.includes('Bearish')) {
    const weight = structure.recent ? 20 : 10;
    bearishScore += weight;
    totalWeight += weight;
  } else {
    totalWeight += 5;
  }

  if (atrStatus === 'Elevated') {
    totalWeight += 5;
  }

  if (emaSignals) {
    if (emaSignals.trend.direction === 'BULLISH') {
      const weight = Math.floor(emaSignals.trend.strength / 5);
      bullishScore += weight;
      totalWeight += weight;
    } else if (emaSignals.trend.direction === 'BEARISH') {
      const weight = Math.floor(emaSignals.trend.strength / 5);
      bearishScore += weight;
      totalWeight += weight;
    }

    if (emaSignals.crossover) {
      const isBullish = emaSignals.crossover.type.includes('above') || emaSignals.crossover.type === 'golden_cross';
      const weight = 15;
      if (isBullish) {
        bullishScore += weight;
      } else {
        bearishScore += weight;
      }
      totalWeight += weight;
    }

    if (emaSignals.pullback && emaSignals.trend.direction !== 'NEUTRAL') {
      const weight = 10;
      if (emaSignals.trend.direction === 'BULLISH') {
        bullishScore += weight;
      } else {
        bearishScore += weight;
      }
      totalWeight += weight;
    }

    if (!emaSignals.alignedWithH1) {
      const penalty = 10;
      if (bullishScore > bearishScore) {
        bullishScore -= penalty;
      } else if (bearishScore > bullishScore) {
        bearishScore -= penalty;
      }
    }
  }

  const netScore = bullishScore - bearishScore;
  const maxPossibleScore = totalWeight;

  let status: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let confidence = 50;

  if (maxPossibleScore > 0) {
    const normalizedScore = (netScore / maxPossibleScore) * 100;

    if (normalizedScore > 15) {
      status = 'BULLISH';
      confidence = Math.min(50 + normalizedScore, 95);
    } else if (normalizedScore < -15) {
      status = 'BEARISH';
      confidence = Math.min(50 + Math.abs(normalizedScore), 95);
    } else {
      status = 'NEUTRAL';
      confidence = Math.max(40, 60 - Math.abs(normalizedScore));
    }
  }

  return { status, confidence: Math.round(confidence) };
}

/**
 * Generate AI Commentary
 * Natural language summary of market conditions
 */
function generateAICommentary(
  vwapPosition: string,
  rsiTrend: 'rising' | 'falling' | 'neutral',
  advancedPattern: AdvancedPattern,
  sentiment: { status: string; confidence: number }
): string {
  const parts: string[] = [];

  parts.push(`Price ${vwapPosition.toLowerCase()}`);

  if (rsiTrend === 'rising') {
    parts.push('with RSI rising');
  } else if (rsiTrend === 'falling') {
    parts.push('with RSI falling');
  } else {
    parts.push('with RSI neutral');
  }

  if (advancedPattern.type !== 'None' && advancedPattern.isValid) {
    parts.push(`Pattern detected: ${advancedPattern.type} (${advancedPattern.direction}, ${advancedPattern.confidence}% confidence)`);
  } else {
    parts.push('No clear pattern detected');
  }

  parts.push(`Sentiment: ${sentiment.status} with confidence ${sentiment.confidence}%`);

  return parts.join('. ') + '.';
}

/**
 * Validate trade signal based on multiple confirmations
 */
function validateTradeSignal(
  rsi: { value: number; status: string },
  vwap: { position: string },
  volume: { status: string },
  candleSignal: CandleSignal,
  atr: { value: number; status: string },
  sentiment: { status: string; confidence: number },
  currentPrice: number,
  emaSignals?: EMASignals
): {
  status: 'VALID' | 'INVALID';
  direction?: 'BUY' | 'SELL';
  confidence?: number;
  reason?: string;
} {
  const reasons: string[] = [];
  let confidence = 0;
  let direction: 'BUY' | 'SELL' | undefined;

  if (!isPatternStrong(candleSignal)) {
    return {
      status: 'INVALID',
      reason: 'No strong candle pattern detected'
    };
  }

  if (volume.status === 'LOW') {
    return {
      status: 'INVALID',
      reason: 'Volume too low for reliable signal'
    };
  }

  if (atr.status === 'Low') {
    return {
      status: 'INVALID',
      reason: 'ATR too low - insufficient volatility for trade'
    };
  }

  if (candleSignal.direction === 'bullish') {
    direction = 'BUY';

    if (rsi.status === 'OVERBOUGHT') {
      return {
        status: 'INVALID',
        reason: 'RSI overbought - not suitable for buy signal'
      };
    }

    if (vwap.position === 'Above VWAP' || vwap.position === 'Near VWAP') {
      reasons.push('VWAP support confirmed');
      confidence += 25;
    }

    if (candleSignal.strength === 'Strong') {
      reasons.push(`Strong ${candleSignal.type}`);
      confidence += 30;
    } else {
      reasons.push(`${candleSignal.type}`);
      confidence += 20;
    }

    if (rsi.status === 'OVERSOLD') {
      reasons.push('RSI oversold reversal');
      confidence += 20;
    } else if (rsi.value < 60) {
      reasons.push('RSI rising');
      confidence += 15;
    }

    if (volume.status === 'HIGH') {
      reasons.push('High volume confirmation');
      confidence += 20;
    } else {
      reasons.push('Stable volume');
      confidence += 10;
    }

    if (emaSignals && emaSignals.trend.direction === 'BULLISH') {
      reasons.push('EMA trend aligned');
      confidence += 15;

      if (emaSignals.pullback) {
        reasons.push(`Pullback to EMA${emaSignals.pullback.ema}`);
        confidence += 10;
      }

      if (emaSignals.crossover && emaSignals.crossover.type.includes('above')) {
        reasons.push('EMA crossover bullish');
        confidence += 10;
      }
    }

  } else if (candleSignal.direction === 'bearish') {
    direction = 'SELL';

    if (rsi.status === 'OVERSOLD') {
      return {
        status: 'INVALID',
        reason: 'RSI oversold - not suitable for sell signal'
      };
    }

    if (vwap.position === 'Below VWAP' || vwap.position === 'Near VWAP') {
      reasons.push('VWAP resistance confirmed');
      confidence += 25;
    }

    if (candleSignal.strength === 'Strong') {
      reasons.push(`Strong ${candleSignal.type}`);
      confidence += 30;
    } else {
      reasons.push(`${candleSignal.type}`);
      confidence += 20;
    }

    if (rsi.status === 'OVERBOUGHT') {
      reasons.push('RSI overbought reversal');
      confidence += 20;
    } else if (rsi.value > 40) {
      reasons.push('RSI falling');
      confidence += 15;
    }

    if (volume.status === 'HIGH') {
      reasons.push('High volume confirmation');
      confidence += 20;
    } else {
      reasons.push('Stable volume');
      confidence += 10;
    }

    if (emaSignals && emaSignals.trend.direction === 'BEARISH') {
      reasons.push('EMA trend aligned');
      confidence += 15;

      if (emaSignals.pullback) {
        reasons.push(`Pullback to EMA${emaSignals.pullback.ema}`);
        confidence += 10;
      }

      if (emaSignals.crossover && emaSignals.crossover.type.includes('below')) {
        reasons.push('EMA crossover bearish');
        confidence += 10;
      }
    }
  } else {
    return {
      status: 'INVALID',
      reason: 'Neutral candle pattern - no directional bias'
    };
  }

  if (emaSignals && !emaSignals.alignedWithH1) {
    confidence -= 15;
    reasons.push('(H1 bias misaligned)');
  }

  if (sentiment.confidence < 60) {
    confidence -= 10;
  }

  const minConfidenceThreshold = 75;

  if (confidence >= minConfidenceThreshold) {
    return {
      status: 'VALID',
      direction,
      confidence: Math.min(confidence, 95),
      reason: reasons.join(' + ')
    };
  }

  return {
    status: 'INVALID',
    reason: `Insufficient confirmation (${confidence}% < ${minConfidenceThreshold}% threshold)`
  };
}

/**
 * Main market analysis function
 * Analyzes 50-100 candles and returns comprehensive AI summary
 */
export async function analyzeMarket(candles: Candle[]): Promise<AiMarketSummary> {
  if (!candles || candles.length < 20) {
    throw new Error(`Insufficient candle data. Need at least 20 candles, got ${candles?.length || 0}`);
  }

  if (candles.length < 50) {
    console.warn(`⚠️ Analyzing with ${candles.length} candles. Recommend 50-100 for best accuracy.`);
  }

  const currentPrice = candles[candles.length - 1].close;

  const rsiValue = calculateRSI(candles, 14);
  const rsiStatus = getRSIStatus(rsiValue);
  const rsiTrend = detectRSITrend(candles);

  const vwapValue = calculateVWAP(candles, 50);
  const vwapPosition = getVWAPPosition(currentPrice, vwapValue);

  const volumeAnalysis = analyzeVolume(candles, 20);

  const atrValue = calculateATR(candles, 14);
  const atrStatus = getATRStatus(atrValue);
  const atrTooltip = getATRTooltip();

  const candleSignal = detectCandlePattern(candles);
  const candleBodyTrend = analyzeCandleBodyTrend(candles);

  const structure = analyzeStructure(candles);
  const advancedPattern = detectAdvancedPattern(candles);

  const emaValues = calculateEMAs(candles);
  const emaSignals = generateEMASignals(candles);
  const emaLevels = calculateEMALevels(candles, emaValues, emaSignals);

  const sentiment = calculateSentiment(
    rsiStatus,
    rsiTrend,
    vwapPosition,
    volumeAnalysis.status,
    candleSignal,
    structure,
    atrStatus,
    candleBodyTrend,
    advancedPattern,
    emaSignals
  );

  const aiCommentary = generateAICommentary(vwapPosition, rsiTrend, advancedPattern, sentiment);

  const tradeSignal = validateTradeSignal(
    { value: rsiValue, status: rsiStatus },
    { position: vwapPosition },
    volumeAnalysis,
    candleSignal,
    { value: atrValue, status: atrStatus },
    sentiment,
    currentPrice,
    emaSignals
  );

  return {
    rsi: {
      value: parseFloat(rsiValue.toFixed(2)),
      status: rsiStatus,
      trend: rsiTrend
    },
    vwap: {
      value: parseFloat(vwapValue.toFixed(8)),
      position: vwapPosition
    },
    volume: {
      status: volumeAnalysis.status,
      delta: volumeAnalysis.delta,
      currentVolume: volumeAnalysis.currentVolume,
      averageVolume: volumeAnalysis.averageVolume
    },
    atr: {
      value: parseFloat(atrValue.toFixed(8)),
      status: atrStatus,
      tooltip: atrTooltip
    },
    candleSignal: {
      type: candleSignal.type,
      strength: candleSignal.strength
    },
    structure: {
      type: structure.type,
      recent: structure.recent
    },
    advancedPattern,
    ema: {
      signals: emaSignals,
      values: emaValues,
      levels: emaLevels
    },
    sentiment: {
      status: sentiment.status,
      confidence: sentiment.confidence
    },
    tradeSignal,
    aiCommentary,
    metadata: {
      candlesAnalyzed: candles.length,
      timestamp: new Date()
    }
  };
}
