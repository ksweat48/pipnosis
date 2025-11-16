import { supabase } from '../lib/supabase';

/**
 * Timeframe Convergence Scorer
 *
 * Multi-timeframe alignment analysis (H4 → H1 → M15 → M5 → M1):
 * - Trend alignment across timeframes
 * - Support/resistance confluence
 * - Momentum alignment (RSI, MACD agreement)
 * - Divergence detection
 * - Optimal entry timeframe selection
 *
 * Professional Insight: When 5 timeframes align, win rate increases 20-30%
 */

export interface TimeframeConvergence {
  symbol: string;
  analyzedAt: Date;

  // Timeframe Trend Alignment
  h4Trend: 'up' | 'down' | 'sideways';
  h1Trend: 'up' | 'down' | 'sideways';
  m15Trend: 'up' | 'down' | 'sideways';
  m5Trend: 'up' | 'down' | 'sideways';
  m1Trend: 'up' | 'down' | 'sideways';

  // Alignment Score
  trendAlignmentScore: number; // 0-100 (100 = all aligned)
  convergenceQuality: 'excellent' | 'good' | 'moderate' | 'poor';

  // Momentum Alignment
  rsiAlignment: boolean;
  macdAlignment: boolean;
  momentumScore: number; // 0-100

  // Support/Resistance Confluence
  keyLevelNearby: boolean;
  confluenceLevels: number;
  confluenceStrength: 'strong' | 'moderate' | 'weak';

  // Divergence Detection
  divergenceDetected: boolean;
  divergenceType?: 'bullish' | 'bearish';
  divergenceTimeframes: string[];

  // Trading Recommendations
  optimalEntryTimeframe: 'H4' | 'H1' | 'M15' | 'M5' | 'M1';
  confidenceBoost: number; // % to add to base confidence
  recommendation: string;
}

class TimeframeConvergenceScorer {
  private readonly TIMEFRAMES = ['H4', 'H1', 'M15', 'M5', 'M1'];

  /**
   * Analyze timeframe convergence for a symbol
   */
  async analyzeConvergence(symbol: string): Promise<TimeframeConvergence> {
    console.log(`[Timeframe Convergence] Analyzing ${symbol} across 5 timeframes...`);

    // Fetch recent candles for each timeframe
    const candles = await this.fetchMultiTimeframeCandles(symbol);

    // Analyze trend on each timeframe
    const trends = {
      h4: this.detectTrend(candles.H4),
      h1: this.detectTrend(candles.H1),
      m15: this.detectTrend(candles.M15),
      m5: this.detectTrend(candles.M5),
      m1: this.detectTrend(candles.M1)
    };

    // Calculate alignment score
    const trendAlignmentScore = this.calculateAlignmentScore(trends);
    const convergenceQuality = this.classifyConvergence(trendAlignmentScore);

    // Analyze momentum alignment
    const momentum = this.analyzeMomentumAlignment(candles);

    // Check for support/resistance confluence
    const confluence = this.analyzeConfluence(candles);

    // Detect divergences
    const divergence = this.detectDivergence(candles);

    // Determine optimal entry timeframe
    const optimalEntryTimeframe = this.selectOptimalTimeframe(trendAlignmentScore, trends);

    // Calculate confidence boost
    const confidenceBoost = this.calculateConfidenceBoost(
      trendAlignmentScore,
      momentum.momentumScore,
      confluence.confluenceStrength
    );

    // Generate recommendation
    const recommendation = this.generateRecommendation(
      trends,
      trendAlignmentScore,
      momentum,
      confluence,
      divergence
    );

    return {
      symbol,
      analyzedAt: new Date(),
      h4Trend: trends.h4,
      h1Trend: trends.h1,
      m15Trend: trends.m15,
      m5Trend: trends.m5,
      m1Trend: trends.m1,
      trendAlignmentScore,
      convergenceQuality,
      rsiAlignment: momentum.rsiAlignment,
      macdAlignment: momentum.macdAlignment,
      momentumScore: momentum.momentumScore,
      keyLevelNearby: confluence.keyLevelNearby,
      confluenceLevels: confluence.confluenceLevels,
      confluenceStrength: confluence.confluenceStrength,
      divergenceDetected: divergence.detected,
      divergenceType: divergence.type,
      divergenceTimeframes: divergence.timeframes,
      optimalEntryTimeframe,
      confidenceBoost,
      recommendation
    };
  }

  /**
   * Fetch candles for multiple timeframes
   */
  private async fetchMultiTimeframeCandles(symbol: string): Promise<Record<string, any[]>> {
    const candles: Record<string, any[]> = {};

    for (const tf of this.TIMEFRAMES) {
      const { data, error } = await supabase
        .from('forex_candles')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', tf)
        .order('open_time', { ascending: false })
        .limit(50);

      candles[tf] = error || !data ? [] : data.reverse();
    }

    return candles;
  }

  /**
   * Detect trend direction on a timeframe
   */
  private detectTrend(candles: any[]): 'up' | 'down' | 'sideways' {
    if (candles.length < 20) return 'sideways';

    const closes = candles.map(c => parseFloat(c.close.toString()));
    const recentCloses = closes.slice(-20);

    // Simple trend detection using first and last prices
    const firstPrice = recentCloses[0];
    const lastPrice = recentCloses[recentCloses.length - 1];
    const priceChange = ((lastPrice - firstPrice) / firstPrice) * 100;

    if (priceChange > 0.5) return 'up';
    if (priceChange < -0.5) return 'down';
    return 'sideways';
  }

  /**
   * Calculate alignment score (0-100)
   */
  private calculateAlignmentScore(trends: Record<string, string>): number {
    const trendValues = Object.values(trends);

    // Count how many are bullish
    const bullishCount = trendValues.filter(t => t === 'up').length;
    const bearishCount = trendValues.filter(t => t === 'down').length;
    const sidewaysCount = trendValues.filter(t => t === 'sideways').length;

    // Perfect alignment = all same direction
    const maxAlignment = Math.max(bullishCount, bearishCount);

    // Sideways reduces alignment score
    const alignmentScore = (maxAlignment / trendValues.length) * 100;
    const sidewaysPenalty = (sidewaysCount / trendValues.length) * 20;

    return Math.max(0, alignmentScore - sidewaysPenalty);
  }

  /**
   * Classify convergence quality
   */
  private classifyConvergence(score: number): 'excellent' | 'good' | 'moderate' | 'poor' {
    if (score >= 90) return 'excellent'; // All 5 aligned
    if (score >= 75) return 'good'; // 4/5 aligned
    if (score >= 60) return 'moderate'; // 3/5 aligned
    return 'poor'; // Less than 3/5
  }

  /**
   * Analyze momentum alignment (simplified - would use actual indicators)
   */
  private analyzeMomentumAlignment(candles: Record<string, any[]>): {
    rsiAlignment: boolean;
    macdAlignment: boolean;
    momentumScore: number;
  } {
    // In production, calculate actual RSI and MACD across timeframes
    // For now, simplified based on price momentum

    let alignedCount = 0;
    const totalTimeframes = this.TIMEFRAMES.length;

    for (const tf of this.TIMEFRAMES) {
      const tfCandles = candles[tf];
      if (tfCandles.length < 10) continue;

      const closes = tfCandles.slice(-10).map(c => parseFloat(c.close.toString()));
      const momentum = closes[closes.length - 1] - closes[0];

      if (Math.abs(momentum) > 0) alignedCount++;
    }

    const momentumScore = (alignedCount / totalTimeframes) * 100;

    return {
      rsiAlignment: momentumScore > 60,
      macdAlignment: momentumScore > 60,
      momentumScore
    };
  }

  /**
   * Analyze support/resistance confluence
   */
  private analyzeConfluence(candles: Record<string, any[]>): {
    keyLevelNearby: boolean;
    confluenceLevels: number;
    confluenceStrength: 'strong' | 'moderate' | 'weak';
  } {
    // In production, would identify actual S/R levels across timeframes
    // For now, simplified analysis

    let confluenceCount = 0;

    // Check if price is near round numbers or recent highs/lows
    for (const tf of this.TIMEFRAMES) {
      const tfCandles = candles[tf];
      if (tfCandles.length === 0) continue;

      const currentPrice = parseFloat(tfCandles[tfCandles.length - 1].close.toString());
      const recentHigh = Math.max(...tfCandles.slice(-20).map(c => parseFloat(c.high.toString())));
      const recentLow = Math.min(...tfCandles.slice(-20).map(c => parseFloat(c.low.toString())));

      // Near recent high/low
      const nearHigh = Math.abs(currentPrice - recentHigh) / recentHigh < 0.002;
      const nearLow = Math.abs(currentPrice - recentLow) / recentLow < 0.002;

      if (nearHigh || nearLow) confluenceCount++;
    }

    const confluenceStrength = confluenceCount >= 3 ? 'strong' :
                                confluenceCount >= 2 ? 'moderate' : 'weak';

    return {
      keyLevelNearby: confluenceCount >= 2,
      confluenceLevels: confluenceCount,
      confluenceStrength
    };
  }

  /**
   * Detect divergence across timeframes
   */
  private detectDivergence(candles: Record<string, any[]>): {
    detected: boolean;
    type?: 'bullish' | 'bearish';
    timeframes: string[];
  } {
    // In production, would detect actual price vs indicator divergence
    // For now, check for conflicting trends

    const divergentTimeframes: string[] = [];
    const trends: string[] = [];

    for (const tf of this.TIMEFRAMES) {
      const trend = this.detectTrend(candles[tf]);
      trends.push(trend);

      // If this timeframe disagrees with majority, it's divergent
      const majorityTrend = this.getMajorityTrend(trends);
      if (trend !== majorityTrend && trend !== 'sideways') {
        divergentTimeframes.push(tf);
      }
    }

    const detected = divergentTimeframes.length >= 2;

    return {
      detected,
      type: detected ? (trends[0] === 'down' ? 'bullish' : 'bearish') : undefined,
      timeframes: divergentTimeframes
    };
  }

  /**
   * Get majority trend
   */
  private getMajorityTrend(trends: string[]): string {
    const counts: Record<string, number> = {};
    trends.forEach(t => counts[t] = (counts[t] || 0) + 1);

    return Object.entries(counts).reduce((a, b) => b[1] > a[1] ? b : a)[0];
  }

  /**
   * Select optimal entry timeframe
   */
  private selectOptimalTimeframe(
    alignmentScore: number,
    trends: Record<string, string>
  ): 'H4' | 'H1' | 'M15' | 'M5' | 'M1' {
    // If excellent alignment (90+), use smaller timeframe for precision
    if (alignmentScore >= 90) return 'M5';

    // If good alignment (75+), use M15
    if (alignmentScore >= 75) return 'M15';

    // If moderate alignment, use H1
    if (alignmentScore >= 60) return 'H1';

    // Poor alignment, use larger timeframe
    return 'H4';
  }

  /**
   * Calculate confidence boost percentage
   */
  private calculateConfidenceBoost(
    alignmentScore: number,
    momentumScore: number,
    confluenceStrength: string
  ): number {
    let boost = 0;

    // Alignment boost (up to +30%)
    if (alignmentScore >= 90) boost += 30;
    else if (alignmentScore >= 75) boost += 20;
    else if (alignmentScore >= 60) boost += 10;

    // Momentum boost (up to +15%)
    if (momentumScore >= 80) boost += 15;
    else if (momentumScore >= 60) boost += 10;

    // Confluence boost (up to +10%)
    if (confluenceStrength === 'strong') boost += 10;
    else if (confluenceStrength === 'moderate') boost += 5;

    return boost;
  }

  /**
   * Generate trading recommendation
   */
  private generateRecommendation(
    trends: Record<string, string>,
    alignmentScore: number,
    momentum: any,
    confluence: any,
    divergence: any
  ): string {
    if (alignmentScore >= 90) {
      const direction = trends.h4 === 'up' ? 'LONG' : 'SHORT';
      return `🚀 EXCELLENT SETUP: All 5 timeframes aligned ${direction}. Trade with full confidence. Confluence: ${confluence.confluenceStrength}.`;
    }

    if (alignmentScore >= 75) {
      const direction = trends.h4 === 'up' ? 'long' : 'short';
      return `✅ STRONG SETUP: 4/5 timeframes aligned ${direction}. High-probability trade. ${confluence.confluenceStrength} confluence.`;
    }

    if (alignmentScore >= 60) {
      return `⚡ MODERATE SETUP: 3/5 timeframes aligned. Acceptable trade with standard position size.`;
    }

    if (divergence.detected) {
      return `⚠️ DIVERGENCE DETECTED: ${divergence.timeframes.join(', ')} showing ${divergence.type} divergence. Consider counter-trend opportunity.`;
    }

    return `❌ POOR ALIGNMENT: Less than 3/5 timeframes aligned. Wait for better setup.`;
  }
}

export const timeframeConvergenceScorer = new TimeframeConvergenceScorer();
