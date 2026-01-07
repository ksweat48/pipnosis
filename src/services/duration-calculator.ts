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
 * ARCHITECTURAL PRINCIPLE (v2.0):
 * - Duration is a SCORING SIGNAL, not a rejection constraint
 * - NEVER block trades due to duration estimates
 * - Use style upgrades + reward/penalty model instead
 *
 * STYLE TARGET BANDS:
 * - SCALP: 20min - 2hrs (reward band)
 * - MICRO_INTRADAY: 1hr - 6hrs (reward band)
 * - INTRADAY: 2hrs - 10hrs (reward band)
 *
 * Philosophy:
 * - High volatility = Fast fills = Shorter duration
 * - Low volatility = Slow grinds = Longer duration (upgrade style)
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

export type StyleUpgradeType = 'NONE' | 'SCALP_TO_MICRO' | 'MICRO_TO_INTRADAY' | 'APPLY_PENALTY';
export type DurationBand = 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY' | 'EXTENDED';

export interface DurationEstimate {
  expectedHours: number;
  bestCaseHours: number;
  worstCaseHours: number;
  targetMaxHours: number;
  confidence: number;
  warnings: string[];
  recommendation: string;
  durationBand: DurationBand;
  styleUpgradeRecommended: StyleUpgradeType;
  shouldApplyReward: boolean;
  shouldApplyPenalty: boolean;
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

    // Style band thresholds
    const SCALP_MAX = 2.0;
    const MICRO_INTRADAY_MAX = 6.0;
    const INTRADAY_MAX = 10.0;

    // Determine duration band and style upgrade recommendation
    let durationBand: DurationBand;
    let styleUpgradeRecommended: StyleUpgradeType;
    let shouldApplyReward = false;
    let shouldApplyPenalty = false;
    let targetMaxHours: number;

    if (expectedHours <= SCALP_MAX) {
      durationBand = 'SCALP';
      styleUpgradeRecommended = 'NONE';
      shouldApplyReward = true;
      targetMaxHours = SCALP_MAX;
    } else if (expectedHours <= MICRO_INTRADAY_MAX) {
      durationBand = 'MICRO_INTRADAY';
      styleUpgradeRecommended = 'SCALP_TO_MICRO';
      shouldApplyReward = true;
      targetMaxHours = MICRO_INTRADAY_MAX;
    } else if (expectedHours <= INTRADAY_MAX) {
      durationBand = 'INTRADAY';
      styleUpgradeRecommended = 'MICRO_TO_INTRADAY';
      shouldApplyReward = true;
      targetMaxHours = INTRADAY_MAX;
    } else {
      durationBand = 'EXTENDED';
      styleUpgradeRecommended = 'APPLY_PENALTY';
      shouldApplyPenalty = true;
      targetMaxHours = 24; // No hard limit, just tracking
    }

    // Build warnings (advisory only, NOT blocking)
    const warnings: string[] = [];

    if (durationBand === 'EXTENDED') {
      warnings.push(
        `Expected duration ${expectedHours.toFixed(1)}h is extended - penalty applied but trade WILL execute`
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
      targetMaxHours,
      riskRewardRatio,
      volatilityLevel,
      marketRegime,
      styleUpgradeRecommended
    );

    // Calculate confidence score (0-100)
    // No longer applies -40% penalty for exceeding duration
    // Instead, uses style upgrade model with moderate adjustments
    let confidence = 70;

    if (expectedHours < targetMaxHours * 0.5) confidence += 15; // Well within band
    if (regimeMultiplier < 0.9) confidence += 10; // With-trend
    if (sessionMultiplier < 1.0) confidence += 5; // High liquidity

    // Moderate penalties for scoring (NOT blocking)
    if (shouldApplyPenalty) confidence -= 15; // Extended duration penalty (reduced from -40)
    if (regimeMultiplier > 1.5) confidence -= 10; // Fighting market
    if (sessionMultiplier > 1.3) confidence -= 5; // Low liquidity

    confidence = Math.max(30, Math.min(100, confidence)); // Floor at 30%, never 0

    return {
      expectedHours,
      bestCaseHours,
      worstCaseHours,
      targetMaxHours,
      confidence,
      warnings,
      recommendation,
      durationBand,
      styleUpgradeRecommended,
      shouldApplyReward,
      shouldApplyPenalty,
      sessionMultiplier,
      regimeMultiplier,
      volatilityFactor
    };
  }

  /**
   * Build actionable recommendation based on duration analysis
   * NO BLOCKING recommendations - only style upgrade suggestions
   */
  private buildRecommendation(
    expectedHours: number,
    targetHours: number,
    riskReward: number,
    volatilityLevel: string,
    marketRegime: string,
    styleUpgrade: StyleUpgradeType
  ): string {
    if (styleUpgrade === 'APPLY_PENALTY') {
      return `Extended duration (${expectedHours.toFixed(1)}h) - Executing with confidence penalty. Consider tighter TP (${(riskReward * 0.7).toFixed(1)}:1 R:R) for future trades.`;
    }

    if (styleUpgrade === 'MICRO_TO_INTRADAY') {
      return `Auto-upgrading to INTRADAY style (${expectedHours.toFixed(1)}h expected). Trade proceeds normally.`;
    }

    if (styleUpgrade === 'SCALP_TO_MICRO') {
      return `Auto-upgrading to MICRO_INTRADAY style (${expectedHours.toFixed(1)}h expected). Trade proceeds normally.`;
    }

    if (expectedHours < targetHours * 0.3) {
      if (volatilityLevel === 'high' || volatilityLevel === 'extreme') {
        return `Fast fill expected (${expectedHours.toFixed(1)}h) due to high volatility. Reward applied.`;
      }
      return `Excellent timing - Expected fill in ${expectedHours.toFixed(1)}h. Reward applied.`;
    }

    return `Good setup - Expected ${expectedHours.toFixed(1)}h fill time within ${targetHours}h target band.`;
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
