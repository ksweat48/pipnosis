import { AIAnalysisData, MarketSentiment, OverboughtOversold, VolumeAnalysis, FearGreedIndex } from '../types/ai-analysis';

export function generateSampleAIAnalysis(
  currentPrice: number,
  high: number,
  low: number,
  symbol: string
): AIAnalysisData {
  const priceRange = high - low;
  const vwap = (high + low + currentPrice) / 3;

  const pricePosition = (currentPrice - low) / priceRange;
  const volatility = priceRange / currentPrice;

  const rsi = 30 + (pricePosition * 40);

  let sentimentBias: 'bullish' | 'bearish' | 'neutral';
  let sentimentStrength: number;
  let sentimentDescription: string;

  if (currentPrice > vwap * 1.002) {
    sentimentBias = 'bullish';
    sentimentStrength = Math.min(0.9, (currentPrice - vwap) / vwap * 100);
    sentimentDescription = 'Price trading above VWAP with strong upward momentum';
  } else if (currentPrice < vwap * 0.998) {
    sentimentBias = 'bearish';
    sentimentStrength = Math.min(0.9, (vwap - currentPrice) / vwap * 100);
    sentimentDescription = 'Price trading below VWAP with downward pressure';
  } else {
    sentimentBias = 'neutral';
    sentimentStrength = 0.5;
    sentimentDescription = 'Price consolidating near VWAP, awaiting direction';
  }

  const marketSentiment: MarketSentiment = {
    bias: sentimentBias,
    strength: sentimentStrength,
    confidence: 0.78 + Math.random() * 0.15,
    description: sentimentDescription
  };

  let rsiStatus: 'overbought' | 'oversold' | 'neutral';
  let rsiSignal: string;

  if (rsi > 70) {
    rsiStatus = 'overbought';
    rsiSignal = 'Consider taking profits or waiting for pullback';
  } else if (rsi < 30) {
    rsiStatus = 'oversold';
    rsiSignal = 'Potential buying opportunity on reversal';
  } else {
    rsiStatus = 'neutral';
    rsiSignal = 'Market in equilibrium, monitor for breakout';
  }

  const overboughtOversold: OverboughtOversold = {
    rsi: rsi,
    status: rsiStatus,
    signal: rsiSignal
  };

  const avgVolume = 100000 + Math.random() * 50000;
  const currentVolume = avgVolume * (0.7 + Math.random() * 0.6);
  const volumeRatio = currentVolume / avgVolume;

  let volumeTrend: 'increasing' | 'decreasing' | 'stable';
  let volumeDescription: string;

  if (volumeRatio > 1.15) {
    volumeTrend = 'increasing';
    volumeDescription = 'Above average volume confirms price movement';
  } else if (volumeRatio < 0.85) {
    volumeTrend = 'decreasing';
    volumeDescription = 'Low volume suggests weak conviction';
  } else {
    volumeTrend = 'stable';
    volumeDescription = 'Average volume, market in normal conditions';
  }

  const volumeAnalysis: VolumeAnalysis = {
    currentVolume: Math.round(currentVolume),
    averageVolume: Math.round(avgVolume),
    trend: volumeTrend,
    strength: Math.abs(volumeRatio - 1) * 100,
    description: volumeDescription
  };

  const fearGreedValue = 25 + (pricePosition * 50) + (volatility > 0.02 ? -10 : 10);
  let fearGreedLevel: 'extreme-fear' | 'fear' | 'neutral' | 'greed' | 'extreme-greed';
  let fearGreedDescription: string;

  if (fearGreedValue < 25) {
    fearGreedLevel = 'extreme-fear';
    fearGreedDescription = 'Market in extreme fear, potential bottom forming';
  } else if (fearGreedValue < 45) {
    fearGreedLevel = 'fear';
    fearGreedDescription = 'Fearful sentiment, opportunities emerging';
  } else if (fearGreedValue < 55) {
    fearGreedLevel = 'neutral';
    fearGreedDescription = 'Balanced market sentiment';
  } else if (fearGreedValue < 75) {
    fearGreedLevel = 'greed';
    fearGreedDescription = 'Greedy sentiment, exercise caution';
  } else {
    fearGreedLevel = 'extreme-greed';
    fearGreedDescription = 'Market in extreme greed, potential top forming';
  }

  const fearGreedIndex: FearGreedIndex = {
    value: Math.round(fearGreedValue),
    level: fearGreedLevel,
    description: fearGreedDescription
  };

  return {
    marketSentiment,
    overboughtOversold,
    volumeAnalysis,
    fearGreedIndex,
    vwap: vwap,
    aiConfidence: 0.82,
    analysisTimestamp: new Date(),
    patterns: [
      {
        type: 'triangle',
        startTime: Date.now() - 3600000,
        endTime: Date.now(),
        points: [],
        direction: currentPrice > vwap ? 'bullish' : 'bearish',
        confidence: 0.76
      }
    ],
    trendLines: [
      {
        startTime: Date.now() - 7200000,
        startPrice: low,
        endTime: Date.now(),
        endPrice: currentPrice,
        type: currentPrice > low ? 'bullish' : 'bearish',
        confidence: 0.81
      }
    ]
  };
}
