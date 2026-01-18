/**
 * Multi-Symbol Ranker
 *
 * Ranks multiple symbols across key dimensions to identify best trading opportunities:
 * 1. Trend Strength (is there clear direction?)
 * 2. Volatility Health (enough movement, not chaotic?)
 * 3. Structure Clarity (clean levels vs choppy?)
 * 4. Manipulation Risk (liquidity sweeps, false breaks?)
 * 5. Intraday Momentum (session velocity)
 *
 * Returns ranked list of symbols from best to worst opportunity
 */

import { supabase } from '../lib/supabase';

export interface SymbolScore {
  symbol: string;
  totalScore: number; // 0-100

  // Individual dimension scores (0-100 each)
  trendStrength: number;
  volatilityHealth: number;
  structureClarity: number;
  manipulationRisk: number;  // Lower is better (inverted for total)
  intradayMomentum: number;

  // Cache-aware bonus (0-15 points max)
  cacheBonus: number;
  hasCachedIntelligence: boolean;
  cachedConsensus?: 'bullish' | 'bearish' | 'mixed' | 'none';

  // Supporting data
  currentPrice: number;
  atr: number;
  dailyRange: number;
  recommendation: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'AVOID';
  reasoning: string;
}

class MultiSymbolRanker {
  private readonly DEFAULT_SYMBOLS = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30'];

  /**
   * Rank symbols and return ordered list (best first)
   */
  async rankSymbols(symbols: string[] = this.DEFAULT_SYMBOLS): Promise<SymbolScore[]> {
    try {
      // Score all symbols in parallel
      const scorePromises = symbols.map(symbol => this.scoreSymbol(symbol));
      const scores = await Promise.all(scorePromises);

      // Filter out nulls (symbols with no data)
      const validScores = scores.filter(s => s !== null) as SymbolScore[];

      // Sort by total score (highest first)
      validScores.sort((a, b) => b.totalScore - a.totalScore);

      return validScores;
    } catch (error) {
      console.error('[Multi-Symbol Ranker] Error ranking symbols:', error);
      return [];
    }
  }

  /**
   * Score a single symbol across all dimensions
   */
  private async scoreSymbol(symbol: string): Promise<SymbolScore | null> {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const { data: candles, error } = await supabase
        .from('forex_candles')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', 'M15')
        .gte('open_time', twentyFourHoursAgo.toISOString())
        .order('open_time', { ascending: false })
        .limit(100);

      if (error || !candles || candles.length < 20) {
        console.warn(`[Multi-Symbol Ranker] Insufficient data for ${symbol}`);
        return null;
      }

      const currentPrice = candles[0].close;
      const pipFactor = symbol.includes('JPY') ? 0.01 : 0.0001;

      const atr = this.calculateATR(candles.slice(0, 20), pipFactor);

      const dailyHigh = Math.max(...candles.map(c => c.high));
      const dailyLow = Math.min(...candles.map(c => c.low));
      const dailyRange = (dailyHigh - dailyLow) / pipFactor;

      const trendStrength = this.scoreTrendStrength(candles);
      const volatilityHealth = this.scoreVolatilityHealth(atr, dailyRange);
      const structureClarity = this.scoreStructureClarity(candles);
      const manipulationRisk = this.scoreManipulationRisk(candles);
      const intradayMomentum = this.scoreIntradayMomentum(candles);

      const cacheResult = await this.getCacheAwareBonus(symbol);

      const weights = {
        trendStrength: 0.22,
        volatilityHealth: 0.18,
        structureClarity: 0.18,
        manipulationRisk: 0.14,
        intradayMomentum: 0.18,
        cacheBonus: 0.10
      };

      const baseScore =
        trendStrength * weights.trendStrength +
        volatilityHealth * weights.volatilityHealth +
        structureClarity * weights.structureClarity +
        (100 - manipulationRisk) * weights.manipulationRisk +
        intradayMomentum * weights.intradayMomentum;

      const totalScore = baseScore + (cacheResult.bonus * weights.cacheBonus * 100);

      const recommendation = this.getRecommendation(totalScore);
      const reasoning = this.generateReasoning({
        symbol,
        trendStrength,
        volatilityHealth,
        structureClarity,
        manipulationRisk,
        intradayMomentum,
        totalScore,
        cacheBonus: cacheResult.bonus,
        cachedConsensus: cacheResult.consensus
      });

      return {
        symbol,
        totalScore: Math.round(Math.min(100, totalScore)),
        trendStrength: Math.round(trendStrength),
        volatilityHealth: Math.round(volatilityHealth),
        structureClarity: Math.round(structureClarity),
        manipulationRisk: Math.round(manipulationRisk),
        intradayMomentum: Math.round(intradayMomentum),
        cacheBonus: Math.round(cacheResult.bonus),
        hasCachedIntelligence: cacheResult.hasCachedIntelligence,
        cachedConsensus: cacheResult.consensus,
        currentPrice,
        atr,
        dailyRange,
        recommendation,
        reasoning
      };
    } catch (error) {
      console.error(`[Multi-Symbol Ranker] Error scoring ${symbol}:`, error);
      return null;
    }
  }

  /**
   * REMOVED: Cache-aware bonus calculation
   *
   * Per SSOT architecture (migration 20260118032110):
   * - omega_market_intelligence table was intentionally dropped
   * - Deterministic Omega analysis doesn't need database caching
   * - Symbol ranking works perfectly without cache bonus
   *
   * Returns zero bonus to maintain interface compatibility.
   */
  private async getCacheAwareBonus(symbol: string): Promise<{
    bonus: number;
    hasCachedIntelligence: boolean;
    consensus: 'bullish' | 'bearish' | 'mixed' | 'none';
  }> {
    // Cache bonus feature removed - all symbols ranked purely on live metrics
    return {
      bonus: 0,
      hasCachedIntelligence: false,
      consensus: 'none'
    };
  }

  /**
   * LEGACY CODE REMOVED (kept for reference):
   * Previous implementation queried omega_market_intelligence for:
   * - Brain consensus (bullish/bearish)
   * - Confidence-weighted voting
   * - Up to 15-point cache bonus
   *
   * This provided minimal value since:
   * - Real-time metrics are always fresher
   * - Symbol scoring is deterministic
   * - Removed table dependency improves reliability
   */

  /**
   * Calculate simplified ATR
   */
  private calculateATR(candles: any[], pipFactor: number): number {
    const ranges = candles.map(c => (c.high - c.low) / pipFactor);
    return ranges.reduce((sum, r) => sum + r, 0) / ranges.length;
  }

  /**
   * Score trend strength (0-100)
   */
  private scoreTrendStrength(candles: any[]): number {
    if (candles.length < 20) return 50;

    // Calculate 20-period EMA slope
    const closes = candles.slice(0, 20).map(c => c.close).reverse();
    const ema = this.calculateEMA(closes, 20);
    const emaSlope = (ema[ema.length - 1] - ema[0]) / ema[0];

    // Calculate consistency (% of closes above/below EMA)
    let aboveEMA = 0;
    let belowEMA = 0;
    for (let i = 0; i < closes.length; i++) {
      if (closes[i] > ema[i]) aboveEMA++;
      else belowEMA++;
    }
    const consistency = Math.max(aboveEMA, belowEMA) / closes.length;

    // Score based on slope strength and consistency
    const slopeScore = Math.min(100, Math.abs(emaSlope) * 10000);
    const consistencyScore = consistency * 100;

    return (slopeScore * 0.6 + consistencyScore * 0.4);
  }

  /**
   * Score volatility health (0-100)
   */
  private scoreVolatilityHealth(atr: number, dailyRange: number): number {
    // Optimal ATR: 15-40 pips for most pairs
    // Optimal daily range: 50-150 pips
    let atrScore = 50;
    if (atr >= 15 && atr <= 40) atrScore = 100;
    else if (atr < 15) atrScore = (atr / 15) * 100;
    else if (atr > 40) atrScore = Math.max(0, 100 - ((atr - 40) * 2));

    let rangeScore = 50;
    if (dailyRange >= 50 && dailyRange <= 150) rangeScore = 100;
    else if (dailyRange < 50) rangeScore = (dailyRange / 50) * 100;
    else if (dailyRange > 150) rangeScore = Math.max(0, 100 - ((dailyRange - 150) / 2));

    return (atrScore * 0.6 + rangeScore * 0.4);
  }

  /**
   * Score structure clarity (0-100)
   */
  private scoreStructureClarity(candles: any[]): number {
    if (candles.length < 10) return 50;

    // Count direction changes (choppiness indicator)
    let changes = 0;
    for (let i = 1; i < Math.min(20, candles.length); i++) {
      const prevDir = candles[i - 1].close > candles[i - 1].open ? 'up' : 'down';
      const currDir = candles[i].close > candles[i].open ? 'up' : 'down';
      if (prevDir !== currDir) changes++;
    }

    // Less changes = more clarity
    const changeRate = changes / Math.min(19, candles.length - 1);
    const clarityScore = (1 - changeRate) * 100;

    return Math.max(0, Math.min(100, clarityScore));
  }

  /**
   * Score manipulation risk (0-100, higher = more risk)
   */
  private scoreManipulationRisk(candles: any[]): number {
    if (candles.length < 10) return 50;

    // Look for wicks that are >50% of candle body (manipulation)
    let manipulationCount = 0;
    for (let i = 0; i < Math.min(20, candles.length); i++) {
      const body = Math.abs(candles[i].close - candles[i].open);
      const upperWick = candles[i].high - Math.max(candles[i].open, candles[i].close);
      const lowerWick = Math.min(candles[i].open, candles[i].close) - candles[i].low;

      if (upperWick > body * 1.5 || lowerWick > body * 1.5) {
        manipulationCount++;
      }
    }

    const manipulationRate = manipulationCount / Math.min(20, candles.length);
    return manipulationRate * 100;
  }

  /**
   * Score intraday momentum (0-100)
   */
  private scoreIntradayMomentum(candles: any[]): number {
    if (candles.length < 10) return 50;

    // Look at last 10 candles - how much net movement?
    const recent = candles.slice(0, 10);
    const netMove = recent[0].close - recent[9].close;
    const totalRange = recent.reduce((sum, c) => sum + (c.high - c.low), 0);

    const efficiency = totalRange > 0 ? Math.abs(netMove) / totalRange : 0;
    return efficiency * 100;
  }

  /**
   * Calculate simple EMA
   */
  private calculateEMA(data: number[], period: number): number[] {
    const k = 2 / (period + 1);
    const ema = [data[0]];

    for (let i = 1; i < data.length; i++) {
      ema.push(data[i] * k + ema[i - 1] * (1 - k));
    }

    return ema;
  }

  /**
   * Get recommendation based on total score
   */
  private getRecommendation(score: number): SymbolScore['recommendation'] {
    if (score >= 80) return 'EXCELLENT';
    if (score >= 65) return 'GOOD';
    if (score >= 50) return 'FAIR';
    if (score >= 35) return 'POOR';
    return 'AVOID';
  }

  /**
   * Generate reasoning string
   */
  private generateReasoning(input: {
    symbol: string;
    trendStrength: number;
    volatilityHealth: number;
    structureClarity: number;
    manipulationRisk: number;
    intradayMomentum: number;
    totalScore: number;
    cacheBonus?: number;
    cachedConsensus?: 'bullish' | 'bearish' | 'mixed' | 'none';
  }): string {
    const strengths = [];
    const weaknesses = [];

    if (input.trendStrength >= 70) strengths.push('strong trend');
    else if (input.trendStrength < 40) weaknesses.push('weak trend');

    if (input.volatilityHealth >= 70) strengths.push('healthy volatility');
    else if (input.volatilityHealth < 40) weaknesses.push('volatility concerns');

    if (input.structureClarity >= 70) strengths.push('clear structure');
    else if (input.structureClarity < 40) weaknesses.push('choppy structure');

    if (input.manipulationRisk < 30) strengths.push('low manipulation');
    else if (input.manipulationRisk > 60) weaknesses.push('high manipulation risk');

    if (input.intradayMomentum >= 70) strengths.push('strong momentum');
    else if (input.intradayMomentum < 40) weaknesses.push('weak momentum');

    if (input.cacheBonus && input.cacheBonus >= 10) {
      strengths.push(`warm cache (${input.cachedConsensus} consensus)`);
    } else if (input.cachedConsensus === 'mixed') {
      weaknesses.push('mixed omega signals');
    }

    const parts = [];
    if (strengths.length > 0) parts.push(`Strengths: ${strengths.join(', ')}`);
    if (weaknesses.length > 0) parts.push(`Weaknesses: ${weaknesses.join(', ')}`);

    return parts.join('. ') || 'Mixed indicators';
  }
}

export const multiSymbolRanker = new MultiSymbolRanker();
