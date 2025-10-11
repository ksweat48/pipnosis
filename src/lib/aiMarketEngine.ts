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

export interface AiMarketSummary {
  rsi: {
    value: number;
    status: 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL';
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
    status: 'Low' | 'Normal' | 'Elevated';
  };
  candleSignal: {
    type: string;
    strength: 'Weak' | 'Moderate' | 'Strong' | null;
  };
  structure: {
    type: string;
    recent: boolean;
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
  metadata: {
    candlesAnalyzed: number;
    timestamp: Date;
  };
}

/**
 * Calculate sentiment score based on multiple factors
 */
function calculateSentiment(
  rsiStatus: string,
  vwapPosition: string,
  volumeStatus: string,
  candleSignal: CandleSignal,
  structure: StructureAnalysis,
  atrStatus: string
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
 * Validate trade signal based on multiple confirmations
 */
function validateTradeSignal(
  rsi: { value: number; status: string },
  vwap: { position: string },
  volume: { status: string },
  candleSignal: CandleSignal,
  atr: { value: number; status: string },
  sentiment: { status: string; confidence: number },
  currentPrice: number
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
  } else {
    return {
      status: 'INVALID',
      reason: 'Neutral candle pattern - no directional bias'
    };
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

  const vwapValue = calculateVWAP(candles, 50);
  const vwapPosition = getVWAPPosition(currentPrice, vwapValue);

  const volumeAnalysis = analyzeVolume(candles, 20);

  const atrValue = calculateATR(candles, 14);
  const atrStatus = getATRStatus(atrValue, candles);

  const candleSignal = detectCandlePattern(candles);

  const structure = analyzeStructure(candles);

  const sentiment = calculateSentiment(
    rsiStatus,
    vwapPosition,
    volumeAnalysis.status,
    candleSignal,
    structure,
    atrStatus
  );

  const tradeSignal = validateTradeSignal(
    { value: rsiValue, status: rsiStatus },
    { position: vwapPosition },
    volumeAnalysis,
    candleSignal,
    { value: atrValue, status: atrStatus },
    sentiment,
    currentPrice
  );

  return {
    rsi: {
      value: parseFloat(rsiValue.toFixed(2)),
      status: rsiStatus
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
      status: atrStatus
    },
    candleSignal: {
      type: candleSignal.type,
      strength: candleSignal.strength
    },
    structure: {
      type: structure.type,
      recent: structure.recent
    },
    sentiment: {
      status: sentiment.status,
      confidence: sentiment.confidence
    },
    tradeSignal,
    metadata: {
      candlesAnalyzed: candles.length,
      timestamp: new Date()
    }
  };
}
