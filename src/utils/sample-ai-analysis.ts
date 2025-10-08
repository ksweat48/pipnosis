import { AIAnalysisData, SupportResistanceLevel } from '../types/ai-analysis';

export function generateSampleAIAnalysis(
  currentPrice: number,
  high: number,
  low: number,
  symbol: string
): AIAnalysisData {
  const priceRange = high - low;
  const supportLevels: SupportResistanceLevel[] = [];
  const resistanceLevels: SupportResistanceLevel[] = [];

  const s1 = low + priceRange * 0.15;
  const s2 = low + priceRange * 0.05;
  const r1 = high - priceRange * 0.15;
  const r2 = high - priceRange * 0.05;

  if (s1 < currentPrice) {
    supportLevels.push({
      price: s1,
      type: 'support',
      strength: 0.8,
      confidence: 0.85
    });
  }

  if (s2 < currentPrice) {
    supportLevels.push({
      price: s2,
      type: 'support',
      strength: 0.6,
      confidence: 0.72
    });
  }

  if (r1 > currentPrice) {
    resistanceLevels.push({
      price: r1,
      type: 'resistance',
      strength: 0.8,
      confidence: 0.88
    });
  }

  if (r2 > currentPrice) {
    resistanceLevels.push({
      price: r2,
      type: 'resistance',
      strength: 0.6,
      confidence: 0.75
    });
  }

  const vwap = (high + low + currentPrice) / 3;

  return {
    supportResistanceLevels: [...supportLevels, ...resistanceLevels],
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
