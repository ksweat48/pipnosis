/**
 * Intelligent Duration Calculator
 *
 * Estimates realistic time-to-TP based on:
 * - ATR and market volatility
 * - Market regime (trending vs ranging)
 * - Trading session (liquidity context)
 * - Historical TP fill rates
 * - Whether trade is with-trend or counter-trend
 *
 * Philosophy:
 * - High volatility = Fast fills = Shorter duration
 * - Low volatility = Slow grinds = Longer duration
 * - Trending markets fill faster than ranging markets
 * - London/NY sessions fill faster than Asian session
 */

import { PIPNOSIS_CORE_RULES } from '../lib/pipnosis-core-rules';
import { supabase } from '../lib/supabase';

export interface DurationEstimateInput {
  entryPrice: number;
  takeProfit: number;
  stopLoss: number;
  symbol: string;
  direction: 'buy' | 'sell';
  currentATR: number;
  volatilityLevel: 'low' | 'medium' | 'high' | 'extreme';
  marketRegime: 'trending_up' | 'trending_down' | 'ranging' | 'mixed';
  currentSession: 'asian' | 'london' | 'newyork' | 'overlap';
  trendStrength?: number;
  timeframe?: string;
}

export interface DurationEstimate {
  expectedHours: number;
  bestCaseHours: number;
  worstCaseHours: number;
  allowedMaxHours: number;
  confidence: number;
  warnings: string[];
  recommendation: string;
  exceedsAllowedDuration: boolean;
  sessionMultiplier: number;
  regimeMultiplier: number;
  volatilityFactor: number;
}

class DurationCalculator {
  /**
   * Get candles per hour for a given timeframe
   */
  private getCandlesPerHour(timeframe: string = 'M15'): number {
    const candlesPerHourMap: Record<string, number> = {
      'M1': 60,
      'M5': 12,
      'M15': 4,
      'M30': 2,
      'H1': 1,
      'H4': 0.25,
      'D1': 0.042
    };
    return candlesPerHourMap[timeframe] || 4;
  }

  /**
   * Get session liquidity multiplier
   * Lower = faster fills, Higher = slower fills
   */
  private getSessionMultiplier(session: string): number {
    const multipliers = PIPNOSIS_CORE_RULES.SESSION_LIQUIDITY_MULTIPLIERS;

    if (session === 'overlap') return multipliers.london_ny_overlap;
    if (session === 'london') return multipliers.london;
    if (session === 'newyork') return multipliers.newyork;
    if (session === 'asian') return multipliers.asian;

    return 1.0; // Default
  }

  /**
   * Get regime-based multiplier
   * Trending markets fill TPs faster, ranging markets slower
   */
  private getRegimeMultiplier(
    regime: string,
    direction: 'buy' | 'sell',
    trendStrength: number = 50
  ): number {
    // With-trend trades fill faster
    const isWithTrend =
      (regime === 'trending_up' && direction === 'buy') ||
      (regime === 'trending_down' && direction === 'sell');

    // Counter-trend trades fill slower (fighting the market)
    const isCounterTrend =
      (regime === 'trending_up' && direction === 'sell') ||
      (regime === 'trending_down' && direction === 'buy');

    if (isWithTrend && trendStrength > 60) {
      return 0.6; // Strong trend helps - 40% faster fills
    } else if (isWithTrend) {
      return 0.8; // Weak trend helps slightly
    } else if (isCounterTrend) {
      return 2.5; // Fighting the trend - much slower fills
    } else if (regime === 'ranging') {
      return 2.0; // Choppy markets take longer
    }

    return 1.0; // Neutral/mixed
  }

  /**
   * Get volatility-based factor
   * CRITICAL: High volatility = FASTER fills (inverted from naive approach)
   */
  private getVolatilityFactor(volatilityLevel: string): number {
    // High volatility = fast price movement = faster TP fills
    // Low volatility = slow price movement = slower TP fills
    if (volatilityLevel === 'extreme') return 0.5; // 50% faster (extreme moves)
    if (volatilityLevel === 'high') return 0.7; // 30% faster
    if (volatilityLevel === 'medium') return 1.0; // Baseline
    if (volatilityLevel === 'low') return 1.8; // 80% slower (grinding markets)

    return 1.0; // Default
  }

  /**
   * Calculate expected time to TP using ATR and market context
   */
  estimateTimeToTP(input: DurationEstimateInput): DurationEstimate {
    const {
      entryPrice,
      takeProfit,
      stopLoss,
      symbol,
      direction,
      currentATR,
      volatilityLevel,
      marketRegime,
      currentSession,
      trendStrength = 50,
      timeframe = 'M15'
    } = input;

    // Calculate price distances
    const tpDistance = Math.abs(takeProfit - entryPrice);
    const slDistance = Math.abs(entryPrice - stopLoss);
    const riskRewardRatio = tpDistance / slDistance;

    // Get candlesPerHour for the timeframe
    const candlesPerHour = this.getCandlesPerHour(timeframe);

    // Calculate ATR per hour (approximation)
    const atrPerHour = currentATR * candlesPerHour;

    // Base calculation: How many hours to cover TP distance at current ATR rate
    // This is a NAIVE estimate - we'll adjust it with multipliers
    let baseHours = atrPerHour > 0 ? tpDistance / atrPerHour : 4.0;

    // Apply session multiplier (liquidity)
    const sessionMultiplier = this.getSessionMultiplier(currentSession);

    // Apply regime multiplier (trend direction)
    const regimeMultiplier = this.getRegimeMultiplier(
      marketRegime,
      direction,
      trendStrength
    );

    // Apply volatility factor
    const volatilityFactor = this.getVolatilityFactor(volatilityLevel);

    // Calculate final expected hours
    let expectedHours = baseHours * sessionMultiplier * regimeMultiplier * volatilityFactor;

    // Apply sanity bounds
    expectedHours = Math.max(0.5, Math.min(24, expectedHours));

    // Calculate confidence bands (±30%)
    const bestCaseHours = expectedHours * 0.7;
    const worstCaseHours = expectedHours * 1.3;

    // Get volatility-adjusted max duration
    const volatilityDurationMap = PIPNOSIS_CORE_RULES.TRADE_DURATION_VOLATILITY_MAP;
    const allowedMaxHours =
      volatilityLevel === 'low'
        ? volatilityDurationMap.low.max
        : volatilityLevel === 'high' || volatilityLevel === 'extreme'
        ? volatilityDurationMap.high.max
        : volatilityDurationMap.medium.max;

    // Check if expected duration exceeds allowed
    const exceedsAllowedDuration = expectedHours > allowedMaxHours;

    // Build warnings
    const warnings: string[] = [];

    if (exceedsAllowedDuration) {
      warnings.push(
        `Expected duration ${expectedHours.toFixed(1)}h exceeds max ${allowedMaxHours}h for ${volatilityLevel} volatility`
      );
    }

    if (regimeMultiplier > 1.5) {
      warnings.push(
        `Counter-trend or ranging market - TP may take ${(regimeMultiplier * 100).toFixed(0)}% longer to fill`
      );
    }

    if (sessionMultiplier > 1.2) {
      warnings.push(
        `Asian session liquidity - expect ${((sessionMultiplier - 1) * 100).toFixed(0)}% longer fill times`
      );
    }

    if (riskRewardRatio > 3.5) {
      warnings.push(`High R:R (${riskRewardRatio.toFixed(1)}:1) may take longer to fill`);
    }

    // Build recommendation
    let recommendation = this.buildRecommendation(
      expectedHours,
      allowedMaxHours,
      riskRewardRatio,
      volatilityLevel,
      marketRegime
    );

    // Calculate confidence score (0-100)
    // Higher confidence when:
    // - Expected duration is well below max
    // - With-trend setups
    // - High liquidity sessions
    let confidence = 70; // Start at 70%

    if (expectedHours < allowedMaxHours * 0.5) confidence += 15; // Well within limits
    if (regimeMultiplier < 0.9) confidence += 10; // With-trend
    if (sessionMultiplier < 1.0) confidence += 5; // High liquidity

    if (exceedsAllowedDuration) confidence -= 40; // Major penalty
    if (regimeMultiplier > 1.5) confidence -= 15; // Fighting market
    if (sessionMultiplier > 1.3) confidence -= 10; // Low liquidity

    confidence = Math.max(0, Math.min(100, confidence));

    return {
      expectedHours,
      bestCaseHours,
      worstCaseHours,
      allowedMaxHours,
      confidence,
      warnings,
      recommendation,
      exceedsAllowedDuration,
      sessionMultiplier,
      regimeMultiplier,
      volatilityFactor
    };
  }

  /**
   * Build actionable recommendation based on duration analysis
   */
  private buildRecommendation(
    expectedHours: number,
    allowedHours: number,
    riskReward: number,
    volatilityLevel: string,
    marketRegime: string
  ): string {
    if (expectedHours > allowedHours) {
      return `⚠️ Tighten TP - Expected ${expectedHours.toFixed(1)}h exceeds ${allowedHours}h limit. Consider ${(riskReward * 0.7).toFixed(1)}:1 R:R instead.`;
    }

    if (expectedHours > allowedHours * 0.8) {
      return `⚠️ Moderate risk - Expected fill time ${expectedHours.toFixed(1)}h is near limit. Monitor closely.`;
    }

    if (expectedHours < allowedHours * 0.3) {
      if (volatilityLevel === 'high' || volatilityLevel === 'extreme') {
        return `✅ Fast fill expected (${expectedHours.toFixed(1)}h) due to high volatility. Can use wider TP if desired.`;
      }
      return `✅ Good setup - Expected fill in ${expectedHours.toFixed(1)}h, well within ${allowedHours}h limit.`;
    }

    return `✅ Acceptable duration - Expected ${expectedHours.toFixed(1)}h fill time within ${allowedHours}h limit.`;
  }

  /**
   * Fetch historical TP fill times for this symbol and regime
   * Used to improve duration estimates over time
   */
  async getHistoricalFillTimes(
    userId: string,
    symbol: string,
    regime: string,
    limit: number = 20
  ): Promise<{ avgHours: number; sampleSize: number } | null> {
    try {
      const { data, error } = await supabase
        .from('goal_session_trades')
        .select('opened_at, closed_at, regime_bucket')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .eq('status', 'closed')
        .eq('close_reason', 'take_profit')
        .ilike('regime_bucket', `%${regime}%`)
        .order('closed_at', { ascending: false })
        .limit(limit);

      if (error || !data || data.length === 0) {
        return null;
      }

      const durations: number[] = [];

      for (const trade of data) {
        if (trade.opened_at && trade.closed_at) {
          const openTime = new Date(trade.opened_at).getTime();
          const closeTime = new Date(trade.closed_at).getTime();
          const durationHours = (closeTime - openTime) / (1000 * 60 * 60);
          durations.push(durationHours);
        }
      }

      if (durations.length === 0) return null;

      const avgHours =
        durations.reduce((sum, d) => sum + d, 0) / durations.length;

      return {
        avgHours,
        sampleSize: durations.length
      };
    } catch (error) {
      console.error('[Duration Calculator] Error fetching historical fill times:', error);
      return null;
    }
  }

  /**
   * Get recommended max TP based on allowed duration
   * Helps Alpha choose realistic TPs
   */
  suggestMaxTPForDuration(
    entryPrice: number,
    stopLoss: number,
    allowedHours: number,
    currentATR: number,
    direction: 'buy' | 'sell',
    candlesPerHour: number = 4
  ): { maxTP: number; maxRR: number; reasoning: string } {
    // Calculate ATR per hour
    const atrPerHour = currentATR * candlesPerHour;

    // Estimate max distance achievable in allowed time
    // Use 80% of allowed time to be conservative
    const conservativeHours = allowedHours * 0.8;
    const maxTPDistance = atrPerHour * conservativeHours;

    // Calculate max TP price
    const maxTP =
      direction === 'buy'
        ? entryPrice + maxTPDistance
        : entryPrice - maxTPDistance;

    // Calculate max R:R ratio
    const slDistance = Math.abs(entryPrice - stopLoss);
    const maxRR = maxTPDistance / slDistance;

    const reasoning = `Based on ${allowedHours}h limit and ${currentATR.toFixed(5)} ATR, max realistic TP distance is ${maxTPDistance.toFixed(5)} (${maxRR.toFixed(1)}:1 R:R)`;

    return {
      maxTP,
      maxRR,
      reasoning
    };
  }
}

export const durationCalculator = new DurationCalculator();
