/**
 * MULTI-TIMEFRAME ANALYSIS SERVICE - SSOT
 *
 * Centralized service for coordinating multi-timeframe market analysis.
 * All MTF analysis in the system should delegate to this service.
 *
 * Responsibilities:
 * - Fetch and cache data across multiple timeframes
 * - Determine trend alignment across timeframes
 * - Provide unified MTF context for LLM analysis
 */

import {
  Timeframe,
  RiskMode,
  getMTFConfig,
  getTimeframeHierarchy,
  getTimeframeMinutes,
  getDisplayLimit,
  isHigherTimeframe,
  ALL_TIMEFRAMES,
  MultiTimeframeConfig,
  TimeframeHierarchy,
} from '@/config/timeframe-hierarchy';
import { fetchPreAggregatedCandles, CandleData } from '@/services/candle-data-service';

export type TrendDirection = 'bullish' | 'bearish' | 'sideways';

export interface TimeframeTrend {
  timeframe: Timeframe;
  direction: TrendDirection;
  strength: number;
  emaSlope: number;
  priceVsEma: 'above' | 'below' | 'at';
  candleCount: number;
}

export interface MTFAlignment {
  aligned: boolean;
  direction: TrendDirection | null;
  confidence: number;
  entryTrend: TimeframeTrend;
  trendTrend: TimeframeTrend;
  contextTrend: TimeframeTrend | null;
  reasoning: string;
}

export interface MTFAnalysisResult {
  symbol: string;
  riskMode: RiskMode;
  config: MultiTimeframeConfig;
  alignment: MTFAlignment;
  timeframeTrends: Map<Timeframe, TimeframeTrend>;
  recommendation: 'trade' | 'wait' | 'avoid';
  analysisTimestamp: number;
}

interface CandleCache {
  symbol: string;
  timeframe: Timeframe;
  candles: CandleData[];
  fetchedAt: number;
}

const CACHE_VALIDITY_MS = 60000;
const candleCache = new Map<string, CandleCache>();

function getCacheKey(symbol: string, timeframe: Timeframe): string {
  return `${symbol}_${timeframe}`;
}

async function fetchCandlesWithCache(
  symbol: string,
  timeframe: Timeframe
): Promise<CandleData[]> {
  const cacheKey = getCacheKey(symbol, timeframe);
  const cached = candleCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.fetchedAt < CACHE_VALIDITY_MS) {
    return cached.candles;
  }

  const limit = getDisplayLimit(timeframe);
  const candles = await fetchPreAggregatedCandles(symbol, timeframe, limit);

  candleCache.set(cacheKey, {
    symbol,
    timeframe,
    candles,
    fetchedAt: now,
  });

  return candles;
}

function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length === 0) return [];

  const ema: number[] = [];
  const multiplier = 2 / (period + 1);

  ema[0] = prices[0];

  for (let i = 1; i < prices.length; i++) {
    ema[i] = (prices[i] - ema[i - 1]) * multiplier + ema[i - 1];
  }

  return ema;
}

function analyzeTrend(candles: CandleData[], timeframe: Timeframe): TimeframeTrend {
  if (candles.length < 20) {
    return {
      timeframe,
      direction: 'sideways',
      strength: 0,
      emaSlope: 0,
      priceVsEma: 'at',
      candleCount: candles.length,
    };
  }

  const closes = candles.map(c => c.close);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, Math.min(50, candles.length));

  const currentPrice = closes[closes.length - 1];
  const currentEma20 = ema20[ema20.length - 1];
  const currentEma50 = ema50[ema50.length - 1];

  const lookbackPeriod = Math.min(10, ema20.length - 1);
  const recentEma20 = ema20.slice(-lookbackPeriod);
  const emaSlope = (recentEma20[recentEma20.length - 1] - recentEma20[0]) / recentEma20[0];

  let direction: TrendDirection = 'sideways';
  let strength = 0;

  const slopeThreshold = 0.001;

  if (emaSlope > slopeThreshold && currentPrice > currentEma20 && currentEma20 > currentEma50) {
    direction = 'bullish';
    strength = Math.min(100, Math.abs(emaSlope) * 10000);
  } else if (emaSlope < -slopeThreshold && currentPrice < currentEma20 && currentEma20 < currentEma50) {
    direction = 'bearish';
    strength = Math.min(100, Math.abs(emaSlope) * 10000);
  } else {
    direction = 'sideways';
    strength = 50 - Math.min(50, Math.abs(emaSlope) * 5000);
  }

  const priceVsEma: 'above' | 'below' | 'at' =
    currentPrice > currentEma20 * 1.001 ? 'above' :
    currentPrice < currentEma20 * 0.999 ? 'below' : 'at';

  return {
    timeframe,
    direction,
    strength,
    emaSlope,
    priceVsEma,
    candleCount: candles.length,
  };
}

function checkAlignment(
  entryTrend: TimeframeTrend,
  trendTrend: TimeframeTrend,
  contextTrend: TimeframeTrend | null
): MTFAlignment {
  const entryDir = entryTrend.direction;
  const trendDir = trendTrend.direction;
  const contextDir = contextTrend?.direction;

  let aligned = false;
  let direction: TrendDirection | null = null;
  let confidence = 0;
  let reasoning = '';

  if (entryDir === 'sideways' || trendDir === 'sideways') {
    aligned = false;
    direction = null;
    confidence = 30;
    reasoning = `No clear trend: Entry=${entryDir}, Trend=${trendDir}`;
  } else if (entryDir === trendDir) {
    aligned = true;
    direction = entryDir;

    if (contextDir === entryDir) {
      confidence = 90;
      reasoning = `Strong alignment: All timeframes ${entryDir}`;
    } else if (contextDir === 'sideways' || !contextDir) {
      confidence = 75;
      reasoning = `Good alignment: Entry and Trend both ${entryDir}`;
    } else {
      confidence = 60;
      reasoning = `Partial alignment: Entry/Trend ${entryDir}, Context ${contextDir}`;
    }
  } else {
    aligned = false;
    direction = null;
    confidence = 20;
    reasoning = `Conflicting trends: Entry=${entryDir}, Trend=${trendDir}`;
  }

  const avgStrength = (entryTrend.strength + trendTrend.strength) / 2;
  confidence = Math.round(confidence * (0.5 + avgStrength / 200));

  return {
    aligned,
    direction,
    confidence,
    entryTrend,
    trendTrend,
    contextTrend,
    reasoning,
  };
}

export async function analyzeMTF(
  symbol: string,
  riskMode: RiskMode
): Promise<MTFAnalysisResult> {
  const config = getMTFConfig(riskMode);
  const timeframeTrends = new Map<Timeframe, TimeframeTrend>();

  const [entryCandles, trendCandles, contextCandles] = await Promise.all([
    fetchCandlesWithCache(symbol, config.entryTimeframe),
    fetchCandlesWithCache(symbol, config.trendTimeframe),
    fetchCandlesWithCache(symbol, config.contextTimeframe),
  ]);

  const entryTrend = analyzeTrend(entryCandles, config.entryTimeframe);
  const trendTrend = analyzeTrend(trendCandles, config.trendTimeframe);
  const contextTrend = analyzeTrend(contextCandles, config.contextTimeframe);

  timeframeTrends.set(config.entryTimeframe, entryTrend);
  timeframeTrends.set(config.trendTimeframe, trendTrend);
  timeframeTrends.set(config.contextTimeframe, contextTrend);

  const alignment = checkAlignment(entryTrend, trendTrend, contextTrend);

  let recommendation: 'trade' | 'wait' | 'avoid';

  if (alignment.aligned && alignment.confidence >= 70) {
    recommendation = 'trade';
  } else if (alignment.confidence >= 50 || alignment.aligned) {
    recommendation = 'wait';
  } else {
    recommendation = 'avoid';
  }

  return {
    symbol,
    riskMode,
    config,
    alignment,
    timeframeTrends,
    recommendation,
    analysisTimestamp: Date.now(),
  };
}

export async function getQuickMTFCheck(
  symbol: string,
  riskMode: RiskMode
): Promise<{ aligned: boolean; direction: TrendDirection | null; confidence: number }> {
  const result = await analyzeMTF(symbol, riskMode);
  return {
    aligned: result.alignment.aligned,
    direction: result.alignment.direction,
    confidence: result.alignment.confidence,
  };
}

export function formatMTFForLLM(result: MTFAnalysisResult): string {
  const { alignment, config, recommendation } = result;

  const lines: string[] = [
    `=== MULTI-TIMEFRAME ANALYSIS ===`,
    `Entry TF (${config.entryTimeframe}): ${alignment.entryTrend.direction.toUpperCase()} (strength: ${alignment.entryTrend.strength.toFixed(0)}%)`,
    `Trend TF (${config.trendTimeframe}): ${alignment.trendTrend.direction.toUpperCase()} (strength: ${alignment.trendTrend.strength.toFixed(0)}%)`,
  ];

  if (alignment.contextTrend) {
    lines.push(
      `Context TF (${config.contextTimeframe}): ${alignment.contextTrend.direction.toUpperCase()} (strength: ${alignment.contextTrend.strength.toFixed(0)}%)`
    );
  }

  lines.push(``, `ALIGNMENT: ${alignment.aligned ? 'YES' : 'NO'} | Confidence: ${alignment.confidence}%`);
  lines.push(`Direction: ${alignment.direction || 'NONE'}`);
  lines.push(`Reasoning: ${alignment.reasoning}`);
  lines.push(`Recommendation: ${recommendation.toUpperCase()}`);

  return lines.join('\n');
}

export async function fetchAllTimeframeData(
  symbol: string,
  timeframes?: Timeframe[]
): Promise<Map<Timeframe, CandleData[]>> {
  const tfsToFetch = timeframes || [...ALL_TIMEFRAMES];
  const result = new Map<Timeframe, CandleData[]>();

  const fetchPromises = tfsToFetch.map(async (tf) => {
    const candles = await fetchCandlesWithCache(symbol, tf);
    return { tf, candles };
  });

  const results = await Promise.all(fetchPromises);

  for (const { tf, candles } of results) {
    result.set(tf, candles);
  }

  return result;
}

export function clearMTFCache(symbol?: string): void {
  if (symbol) {
    for (const key of candleCache.keys()) {
      if (key.startsWith(`${symbol}_`)) {
        candleCache.delete(key);
      }
    }
  } else {
    candleCache.clear();
  }
}

export function getRecommendedTimeframes(riskMode: RiskMode): {
  entry: Timeframe;
  trend: Timeframe;
  context: Timeframe;
} {
  const config = getMTFConfig(riskMode);
  return {
    entry: config.entryTimeframe,
    trend: config.trendTimeframe,
    context: config.contextTimeframe,
  };
}

export function validateTimeframeForRiskMode(
  timeframe: Timeframe,
  riskMode: RiskMode
): { valid: boolean; warning?: string } {
  const hierarchy = getTimeframeHierarchy(riskMode);
  const allowedTimeframes = [hierarchy.primary, hierarchy.secondary];
  if (hierarchy.tertiary) {
    allowedTimeframes.push(hierarchy.tertiary);
  }

  if (allowedTimeframes.includes(timeframe)) {
    return { valid: true };
  }

  const tfMinutes = getTimeframeMinutes(timeframe);
  const primaryMinutes = getTimeframeMinutes(hierarchy.primary);

  if (tfMinutes > primaryMinutes * 4) {
    return {
      valid: false,
      warning: `${timeframe} is too slow for ${riskMode} risk mode. Use ${hierarchy.primary} or ${hierarchy.secondary}.`,
    };
  }

  if (tfMinutes < primaryMinutes / 3) {
    return {
      valid: false,
      warning: `${timeframe} is too fast for ${riskMode} risk mode. Use ${hierarchy.primary} or ${hierarchy.secondary}.`,
    };
  }

  return { valid: true };
}
