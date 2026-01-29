/**
 * Real-Time Intelligence Calculator - SSOT Authority
 *
 * RESPONSIBILITY: Calculate real-time probability for all watchlist pairs
 * based on weighted indicator alignment RIGHT NOW.
 *
 * CCIP Compliant:
 * - Single source of truth for real-time probability calculations
 * - No duplicate logic elsewhere
 * - Uses session-trade-probability-analyzer indicator methods
 * - Applies intelligent weights from config
 *
 * Governance:
 * - No database business logic
 * - Pure calculation service
 * - Results stored for display only
 */

import { createClient } from '@supabase/supabase-js';
import type {
  Session,
  MarketRegime,
  IndicatorWeights,
} from '../../../src/config/intelligent-indicator-weights';
import {
  getIntelligentWeights,
  getCurrentSession,
} from '../../../src/config/intelligent-indicator-weights';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface IndicatorResult {
  vwap: boolean;
  ema20: boolean;
  ema50: boolean;
  rsi: boolean;
  volumePressure: boolean;
  candlePattern: boolean;
  structure: boolean;
  momentum: boolean;
}

export interface IntelligencePairResult {
  symbol: string;
  confidence: number;
  alignedIndicators: number;
  totalIndicators: number;
  indicatorBreakdown: Record<string, { aligned: boolean; weight: number }>;
  reasoning: string[];
  lastCalculated: string;
}

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export class RealTimeIntelligenceCalculator {
  private readonly MIN_CANDLES = 50;
  private readonly PROBABILITY_THRESHOLD = 70;
  private readonly INDICATOR_COUNT = 8;

  async calculateForAllPairs(symbols: string[]): Promise<{
    pairs: IntelligencePairResult[];
    marketCondition: MarketRegime;
    calculatedAt: string;
  }> {
    console.log(`[RealTimeIntelligence] Calculating for ${symbols.length} symbols...`);

    const session = getCurrentSession();
    const marketCondition = await this.detectMarketRegime(symbols);

    const results: IntelligencePairResult[] = [];

    for (const symbol of symbols) {
      try {
        const result = await this.calculateForSymbol(symbol, session, marketCondition);

        if (result.confidence >= this.PROBABILITY_THRESHOLD) {
          results.push(result);
        }
      } catch (error) {
        console.error(`[RealTimeIntelligence] Error calculating ${symbol}:`, error);
      }
    }

    results.sort((a, b) => b.confidence - a.confidence);

    console.log(
      `[RealTimeIntelligence] Found ${results.length} high-probability pairs (≥${this.PROBABILITY_THRESHOLD}%)`
    );

    return {
      pairs: results,
      marketCondition,
      calculatedAt: new Date().toISOString(),
    };
  }

  async calculateForAllPairsWithAllScores(symbols: string[]): Promise<{
    allPairs: IntelligencePairResult[];
    topPairs: IntelligencePairResult[];
    highConfidencePairs: IntelligencePairResult[];
    heatingPairs: IntelligencePairResult[];
    marketCondition: MarketRegime;
    calculatedAt: string;
  }> {
    console.log(`[RealTimeIntelligence] Calculating ALL pair scores for ${symbols.length} symbols...`);

    const session = getCurrentSession();
    const marketCondition = await this.detectMarketRegime(symbols);

    const allResults: IntelligencePairResult[] = [];

    for (const symbol of symbols) {
      try {
        const result = await this.calculateForSymbol(symbol, session, marketCondition);
        allResults.push(result);
      } catch (error) {
        console.error(`[RealTimeIntelligence] Error calculating ${symbol}:`, error);
      }
    }

    allResults.sort((a, b) => b.confidence - a.confidence);

    const highConfidencePairs = allResults.filter((p) => p.confidence >= this.PROBABILITY_THRESHOLD);
    const heatingPairs = allResults.filter((p) => p.confidence >= 50 && p.confidence < this.PROBABILITY_THRESHOLD);
    const topPairs = allResults.slice(0, 3);

    console.log(
      `[RealTimeIntelligence] All pairs calculated: ${allResults.length} total | ${highConfidencePairs.length} ≥70% | ${heatingPairs.length} heating (50-70%)`
    );

    return {
      allPairs: allResults,
      topPairs,
      highConfidencePairs,
      heatingPairs,
      marketCondition,
      calculatedAt: new Date().toISOString(),
    };
  }

  private async calculateForSymbol(
    symbol: string,
    session: Session,
    regime: MarketRegime
  ): Promise<IntelligencePairResult> {
    const { data: priceData } = await supabase
      .from('realtime_prices')
      .select('mid, created_at')
      .eq('symbol', symbol)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!priceData) {
      throw new Error(`No price data for ${symbol}`);
    }

    const currentPrice = parseFloat(priceData.mid);

    const { data: candlesData } = await supabase
      .from('forex_candles_best')
      .select('timestamp, open, high, low, close, volume')
      .eq('symbol', symbol)
      .eq('timeframe', '15m')
      .order('timestamp', { ascending: false })
      .limit(200);

    if (!candlesData || candlesData.length < this.MIN_CANDLES) {
      throw new Error(`Insufficient candles for ${symbol}: ${candlesData?.length || 0}`);
    }

    const candles: Candle[] = candlesData.reverse().map((c) => ({
      timestamp:
        typeof c.timestamp === 'number' ? c.timestamp : new Date(c.timestamp).getTime() / 1000,
      open: parseFloat(String(c.open)),
      high: parseFloat(String(c.high)),
      low: parseFloat(String(c.low)),
      close: parseFloat(String(c.close)),
      volume: c.volume ? parseFloat(String(c.volume)) : undefined,
    }));

    const direction = this.determineDirection(candles);

    const indicators = this.evaluateIndicators(currentPrice, candles, direction);

    const weights = getIntelligentWeights(symbol, session, regime);

    const { confidence, alignedCount } = this.calculateWeightedConfidence(indicators, weights);

    const indicatorBreakdown = this.buildIndicatorBreakdown(indicators, weights);

    const reasoning = this.generateReasoning(symbol, alignedCount, indicators, confidence);

    return {
      symbol,
      confidence: Math.round(confidence),
      alignedIndicators: alignedCount,
      totalIndicators: this.INDICATOR_COUNT,
      indicatorBreakdown,
      reasoning,
      lastCalculated: new Date().toISOString(),
    };
  }

  private determineDirection(candles: Candle[]): 'buy' | 'sell' {
    if (candles.length < 5) return 'buy';

    const recent = candles.slice(-5);
    const closes = recent.map((c) => c.close);
    const avgClose = closes.reduce((sum, c) => sum + c, 0) / closes.length;
    const currentClose = closes[closes.length - 1];

    return currentClose > avgClose ? 'buy' : 'sell';
  }

  private evaluateIndicators(
    price: number,
    candles: Candle[],
    direction: 'buy' | 'sell'
  ): IndicatorResult {
    return {
      vwap: this.checkVWAP(price, candles, direction),
      ema20: this.checkEMA20(price, candles, direction),
      ema50: this.checkEMA50(price, candles, direction),
      rsi: this.checkRSI(candles, direction),
      volumePressure: this.checkVolume(candles, direction),
      candlePattern: this.checkPattern(candles, direction),
      structure: this.checkStructure(candles, direction),
      momentum: this.checkMomentum(candles, direction),
    };
  }

  private checkVWAP(price: number, candles: Candle[], direction: string): boolean {
    if (candles.length === 0) return false;

    const vwap = this.calculateVWAP(candles.slice(-50));

    if (direction === 'buy') {
      return price >= vwap * 0.995;
    } else {
      return price <= vwap * 1.005;
    }
  }

  private checkEMA20(price: number, candles: Candle[], direction: string): boolean {
    if (candles.length < 20) return false;

    const ema20 = this.calculateEMA(candles, 20);

    if (direction === 'buy') {
      return price >= ema20 * 0.99;
    } else {
      return price <= ema20 * 1.01;
    }
  }

  private checkEMA50(price: number, candles: Candle[], direction: string): boolean {
    if (candles.length < 50) return false;

    const ema50 = this.calculateEMA(candles, 50);

    if (direction === 'buy') {
      return price > ema50;
    } else {
      return price < ema50;
    }
  }

  private checkRSI(candles: Candle[], direction: string): boolean {
    if (candles.length < 14) return false;

    const rsi = this.calculateRSI(candles, 14);

    if (direction === 'buy') {
      return rsi > 40 && rsi < 70;
    } else {
      return rsi > 30 && rsi < 60;
    }
  }

  private checkVolume(candles: Candle[], direction: string): boolean {
    if (candles.length < 5) return false;

    const recentCandles = candles.slice(-5);
    const avgVolume = recentCandles.reduce((sum, c) => sum + (c.volume || 0), 0) / 5;

    let bullishCandles = 0;
    for (const candle of recentCandles) {
      const isBullish = candle.close > candle.open;
      const isHighVolume = (candle.volume || 0) > avgVolume * 0.8;

      if (isBullish && isHighVolume) bullishCandles++;
    }

    if (direction === 'buy') {
      return bullishCandles >= 2;
    } else {
      return recentCandles.length - bullishCandles >= 2;
    }
  }

  private checkPattern(candles: Candle[], direction: string): boolean {
    if (candles.length < 3) return false;

    const recentCandle = candles[candles.length - 1];
    const previousCandle = candles[candles.length - 2];

    const recentIsBullish = recentCandle.close > recentCandle.open;
    const recentIsGrowing = recentCandle.close > previousCandle.close;

    if (direction === 'buy') {
      return recentIsBullish && recentIsGrowing;
    } else {
      return !recentIsBullish && !recentIsGrowing;
    }
  }

  private checkStructure(candles: Candle[], direction: string): boolean {
    if (candles.length < 5) return false;

    const recent = candles.slice(-5);
    const highs = recent.map((c) => c.high);
    const lows = recent.map((c) => c.low);

    const isHigherHighs = highs[4] > highs[2] && highs[2] > highs[0];
    const isHigherLows = lows[4] > lows[2] && lows[2] > lows[0];

    if (direction === 'buy') {
      return isHigherHighs || isHigherLows;
    } else {
      const isLowerHighs = highs[4] < highs[2] && highs[2] < highs[0];
      const isLowerLows = lows[4] < lows[2] && lows[2] < lows[0];
      return isLowerHighs || isLowerLows;
    }
  }

  private checkMomentum(candles: Candle[], direction: string): boolean {
    if (candles.length < 10) return false;

    const recent = candles.slice(-10);
    const change = (recent[9].close - recent[0].close) / recent[0].close;

    if (direction === 'buy') {
      return change > 0.001;
    } else {
      return change < -0.001;
    }
  }

  private calculateVWAP(candles: Candle[]): number {
    let cumPQ = 0;
    let cumQ = 0;

    for (const candle of candles) {
      const tp = (candle.high + candle.low + candle.close) / 3;
      const volume = candle.volume || 1;
      cumPQ += tp * volume;
      cumQ += volume;
    }

    return cumQ > 0 ? cumPQ / cumQ : candles[candles.length - 1].close;
  }

  private calculateEMA(candles: Candle[], period: number): number {
    if (candles.length < period) return candles[candles.length - 1].close;

    const multiplier = 2 / (period + 1);
    let ema = 0;

    for (let i = 0; i < period; i++) {
      ema += candles[i].close;
    }
    ema /= period;

    for (let i = period; i < candles.length; i++) {
      ema = candles[i].close * multiplier + ema * (1 - multiplier);
    }

    return ema;
  }

  private calculateRSI(candles: Candle[], period: number = 14): number {
    if (candles.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i < candles.length; i++) {
      const change = candles[i].close - candles[i - 1].close;
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);

    return rsi;
  }

  private calculateWeightedConfidence(
    indicators: IndicatorResult,
    weights: IndicatorWeights
  ): { confidence: number; alignedCount: number } {
    let weightedSum = 0;
    let totalWeight = 0;
    let alignedCount = 0;

    for (const [key, aligned] of Object.entries(indicators)) {
      const weight = weights[key as keyof IndicatorWeights];
      totalWeight += weight;

      if (aligned) {
        weightedSum += weight;
        alignedCount++;
      }
    }

    const confidence = (weightedSum / totalWeight) * 100;
    return { confidence, alignedCount };
  }

  private buildIndicatorBreakdown(
    indicators: IndicatorResult,
    weights: IndicatorWeights
  ): Record<string, { aligned: boolean; weight: number }> {
    const breakdown: Record<string, { aligned: boolean; weight: number }> = {};

    for (const [key, aligned] of Object.entries(indicators)) {
      breakdown[key] = {
        aligned,
        weight: weights[key as keyof IndicatorWeights],
      };
    }

    return breakdown;
  }

  private generateReasoning(
    symbol: string,
    alignedCount: number,
    indicators: IndicatorResult,
    confidence: number
  ): string[] {
    const reasons: string[] = [];

    if (confidence >= 85) {
      reasons.push('Strong multi-indicator confluence detected');
    } else if (confidence >= 75) {
      reasons.push('Good indicator alignment across multiple timeframes');
    } else if (confidence >= 70) {
      reasons.push('Moderate probability setup forming');
    }

    if (indicators.vwap && indicators.ema20) {
      reasons.push('Price aligned with both VWAP and EMA20');
    }

    if (indicators.structure && indicators.momentum) {
      reasons.push('Market structure and momentum in agreement');
    }

    if (indicators.volumePressure) {
      reasons.push('Volume confirms directional bias');
    }

    if (!indicators.rsi && confidence >= 70) {
      reasons.push('RSI showing caution - monitor closely');
    }

    return reasons.slice(0, 3);
  }

  private async detectMarketRegime(symbols: string[]): Promise<MarketRegime> {
    let trendingCount = 0;
    let volatileCount = 0;
    let quietCount = 0;

    for (const symbol of symbols.slice(0, 5)) {
      try {
        const { data: candles } = await supabase
          .from('forex_candles_best')
          .select('high, low, close')
          .eq('symbol', symbol)
          .eq('timeframe', '1h')
          .order('timestamp', { ascending: false })
          .limit(24);

        if (candles && candles.length >= 20) {
          const ranges = candles.map((c) => parseFloat(String(c.high)) - parseFloat(String(c.low)));
          const avgRange = ranges.reduce((sum, r) => sum + r, 0) / ranges.length;
          const recentRange = ranges[0];

          if (recentRange > avgRange * 1.5) volatileCount++;
          if (recentRange < avgRange * 0.5) quietCount++;

          const closes = candles.map((c) => parseFloat(String(c.close)));
          const trend = Math.abs(closes[0] - closes[closes.length - 1]);
          if (trend > avgRange * 3) trendingCount++;
        }
      } catch (error) {
        console.error(`[RealTimeIntelligence] Error analyzing ${symbol} regime:`, error);
      }
    }

    const total = symbols.slice(0, 5).length;
    if (quietCount / total > 0.6) return 'quiet';
    if (trendingCount / total > 0.5) return 'trending';
    if (volatileCount / total > 0.5) return 'volatile';
    return 'ranging';
  }
}

export const realTimeIntelligenceCalculator = new RealTimeIntelligenceCalculator();
