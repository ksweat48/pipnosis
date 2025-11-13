import { supabase } from '@/lib/supabase';

/**
 * Expected Value (EV) Calculator
 *
 * Calculates the Expected Value for trades and patterns using the formula:
 * EV = (Win Probability × Average Win) − ((1 − Win Probability) × Average Loss)
 *
 * Positive EV = Profitable pattern over time
 * Negative EV = Losing pattern over time
 * Zero EV = Break-even pattern
 */

interface PatternHistoricalData {
  symbol: string;
  patternName: string;
  totalTrades: number;
  wins: number;
  losses: number;
  totalWinAmount: number;
  totalLossAmount: number;
  volatilityRegime?: 'low' | 'medium' | 'high';
}

interface EVCalculationResult {
  expectedValue: number;
  winProbability: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  sampleSize: number;
  confidenceLevel: 'low' | 'medium' | 'high';
  isStatisticallySignificant: boolean;
  recommendation: 'take' | 'avoid' | 'cautious';
}

interface TradeSignalEV {
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  patternName: string;
  volatilityRegime?: 'low' | 'medium' | 'high';
}

class EVCalculator {
  private readonly MIN_SAMPLE_SIZE_LOW = 10;
  private readonly MIN_SAMPLE_SIZE_MEDIUM = 30;
  private readonly MIN_SAMPLE_SIZE_HIGH = 50;
  private readonly POSITIVE_EV_THRESHOLD = 0;

  /**
   * Calculate EV for a specific pattern based on historical data
   */
  async calculatePatternEV(
    userId: string,
    symbol: string,
    patternName: string,
    volatilityRegime?: 'low' | 'medium' | 'high'
  ): Promise<EVCalculationResult | null> {
    try {
      const historicalData = await this.fetchPatternHistory(
        userId,
        symbol,
        patternName,
        volatilityRegime
      );

      if (!historicalData || historicalData.totalTrades === 0) {
        console.log(`[EV Calculator] No historical data for ${patternName} on ${symbol}`);
        return null;
      }

      return this.calculateEVFromData(historicalData);
    } catch (error) {
      console.error('[EV Calculator] Error calculating pattern EV:', error);
      return null;
    }
  }

  /**
   * Calculate EV for an incoming trade signal
   */
  async calculateSignalEV(
    userId: string,
    signal: TradeSignalEV
  ): Promise<EVCalculationResult | null> {
    const patternEV = await this.calculatePatternEV(
      userId,
      signal.symbol,
      signal.patternName,
      signal.volatilityRegime
    );

    if (!patternEV) {
      // No historical data - use signal's R:R to estimate
      return this.estimateEVFromSignal(signal);
    }

    return patternEV;
  }

  /**
   * Core EV calculation from historical data
   */
  private calculateEVFromData(data: PatternHistoricalData): EVCalculationResult {
    const winProbability = data.wins / data.totalTrades;
    const lossProbability = 1 - winProbability;

    const avgWin = data.wins > 0 ? data.totalWinAmount / data.wins : 0;
    const avgLoss = data.losses > 0 ? Math.abs(data.totalLossAmount) / data.losses : 0;

    // Calculate Expected Value
    const expectedValue = (winProbability * avgWin) - (lossProbability * avgLoss);

    // Calculate Profit Factor
    const profitFactor = avgLoss > 0 ? Math.abs(data.totalWinAmount) / Math.abs(data.totalLossAmount) : 0;

    // Determine confidence level based on sample size
    const confidenceLevel = this.getConfidenceLevel(data.totalTrades);
    const isStatisticallySignificant = data.totalTrades >= this.MIN_SAMPLE_SIZE_MEDIUM;

    // Generate recommendation
    const recommendation = this.getRecommendation(
      expectedValue,
      profitFactor,
      data.totalTrades,
      winProbability
    );

    return {
      expectedValue,
      winProbability,
      avgWin,
      avgLoss,
      profitFactor,
      sampleSize: data.totalTrades,
      confidenceLevel,
      isStatisticallySignificant,
      recommendation
    };
  }

  /**
   * Fetch historical pattern data from database
   */
  private async fetchPatternHistory(
    userId: string,
    symbol: string,
    patternName: string,
    volatilityRegime?: 'low' | 'medium' | 'high'
  ): Promise<PatternHistoricalData | null> {
    try {
      // Query ai_trade_analysis for pattern history
      let query = supabase
        .from('ai_trade_analysis')
        .select('outcome, pnl, volatility_regime')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .contains('matching_historical_patterns', [patternName]);

      if (volatilityRegime) {
        query = query.eq('volatility_regime', volatilityRegime);
      }

      const { data: trades, error } = await query;

      if (error || !trades || trades.length === 0) {
        return null;
      }

      // Calculate aggregates
      const wins = trades.filter(t => t.outcome === 'win');
      const losses = trades.filter(t => t.outcome === 'loss');

      const totalWinAmount = wins.reduce((sum, t) => sum + parseFloat(t.pnl.toString()), 0);
      const totalLossAmount = losses.reduce((sum, t) => sum + parseFloat(t.pnl.toString()), 0);

      return {
        symbol,
        patternName,
        totalTrades: trades.length,
        wins: wins.length,
        losses: losses.length,
        totalWinAmount,
        totalLossAmount,
        volatilityRegime
      };
    } catch (error) {
      console.error('[EV Calculator] Error fetching pattern history:', error);
      return null;
    }
  }

  /**
   * Estimate EV when no historical data exists (new pattern)
   */
  private estimateEVFromSignal(signal: TradeSignalEV): EVCalculationResult {
    // Calculate potential R:R from signal
    const riskAmount = Math.abs(signal.entryPrice - signal.stopLoss);
    const rewardAmount = Math.abs(signal.takeProfit - signal.entryPrice);
    const rrRatio = riskAmount > 0 ? rewardAmount / riskAmount : 0;

    // Assume 50% win rate for new patterns (neutral assumption)
    const winProbability = 0.5;
    const lossProbability = 0.5;

    // Estimate based on R:R
    const avgWin = rewardAmount;
    const avgLoss = riskAmount;

    const expectedValue = (winProbability * avgWin) - (lossProbability * avgLoss);
    const profitFactor = rrRatio;

    return {
      expectedValue,
      winProbability,
      avgWin,
      avgLoss,
      profitFactor,
      sampleSize: 0,
      confidenceLevel: 'low',
      isStatisticallySignificant: false,
      recommendation: expectedValue > 0 ? 'cautious' : 'avoid'
    };
  }

  /**
   * Update or create pattern EV tracking record
   */
  async updatePatternEVTracking(
    userId: string,
    symbol: string,
    patternName: string,
    evResult: EVCalculationResult,
    volatilityRegime?: 'low' | 'medium' | 'high'
  ): Promise<void> {
    try {
      const patternStatus = this.determinePatternStatus(evResult);

      const { error } = await supabase
        .from('ai_pattern_ev_tracking')
        .upsert({
          user_id: userId,
          pattern_name: patternName,
          symbol,
          volatility_regime: volatilityRegime || 'medium',
          expected_value: evResult.expectedValue,
          win_probability: evResult.winProbability,
          avg_win_amount: evResult.avgWin,
          avg_loss_amount: evResult.avgLoss,
          sample_size: evResult.sampleSize,
          win_count: Math.round(evResult.sampleSize * evResult.winProbability),
          loss_count: Math.round(evResult.sampleSize * (1 - evResult.winProbability)),
          avg_rr: evResult.profitFactor,
          profit_factor: evResult.profitFactor,
          ev_confidence_level: evResult.confidenceLevel,
          is_statistically_significant: evResult.isStatisticallySignificant,
          pattern_status: patternStatus,
          last_updated_at: new Date().toISOString(),
          last_trade_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,pattern_name,symbol,volatility_regime'
        });

      if (error) {
        console.error('[EV Calculator] Error updating pattern EV tracking:', error);
      } else {
        console.log(`[EV Calculator] Updated EV tracking for ${patternName} on ${symbol}: EV=${evResult.expectedValue.toFixed(2)}`);
      }
    } catch (error) {
      console.error('[EV Calculator] Exception updating pattern EV:', error);
    }
  }

  /**
   * Get all active patterns with positive EV for a user
   */
  async getPositiveEVPatterns(
    userId: string,
    symbol?: string,
    minEV: number = 0
  ): Promise<any[]> {
    try {
      let query = supabase
        .from('ai_pattern_ev_tracking')
        .select('*')
        .eq('user_id', userId)
        .eq('pattern_status', 'active')
        .gte('expected_value', minEV)
        .order('expected_value', { ascending: false });

      if (symbol) {
        query = query.eq('symbol', symbol);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[EV Calculator] Error fetching positive EV patterns:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[EV Calculator] Exception fetching positive EV patterns:', error);
      return [];
    }
  }

  /**
   * Get patterns that need attention (negative or degraded EV)
   */
  async getDegradedPatterns(userId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('ai_pattern_ev_tracking')
        .select('*')
        .eq('user_id', userId)
        .or('pattern_status.eq.degraded,expected_value.lt.0')
        .order('expected_value', { ascending: true });

      if (error) {
        console.error('[EV Calculator] Error fetching degraded patterns:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[EV Calculator] Exception fetching degraded patterns:', error);
      return [];
    }
  }

  /**
   * Calculate EV for a completed trade and learn from it
   */
  async learnFromCompletedTrade(
    userId: string,
    tradeData: {
      symbol: string;
      patternName: string;
      outcome: 'win' | 'loss' | 'breakeven';
      pnl: number;
      volatilityRegime?: 'low' | 'medium' | 'high';
    }
  ): Promise<void> {
    // Recalculate pattern EV with new trade data
    const updatedEV = await this.calculatePatternEV(
      userId,
      tradeData.symbol,
      tradeData.patternName,
      tradeData.volatilityRegime
    );

    if (updatedEV) {
      await this.updatePatternEVTracking(
        userId,
        tradeData.symbol,
        tradeData.patternName,
        updatedEV,
        tradeData.volatilityRegime
      );

      // Only log if pattern has SIGNIFICANTLY degraded (reduced threshold to -10 to avoid spam)
      if (updatedEV.expectedValue < -10 && updatedEV.sampleSize >= this.MIN_SAMPLE_SIZE_MEDIUM) {
        console.warn(`[EV Calculator] ⚠️ Pattern significantly degraded: ${tradeData.patternName} on ${tradeData.symbol} now has EV: ${updatedEV.expectedValue.toFixed(2)}`);
      }
    }
  }

  /**
   * Determine pattern status based on EV result
   */
  private determinePatternStatus(evResult: EVCalculationResult): 'active' | 'degraded' | 'paused' {
    if (evResult.expectedValue < 0 && evResult.isStatisticallySignificant) {
      return 'degraded';
    }

    if (evResult.expectedValue < -5 || (evResult.profitFactor < 0.8 && evResult.sampleSize >= 20)) {
      return 'paused';
    }

    return 'active';
  }

  /**
   * Get confidence level based on sample size
   */
  private getConfidenceLevel(sampleSize: number): 'low' | 'medium' | 'high' {
    if (sampleSize >= this.MIN_SAMPLE_SIZE_HIGH) return 'high';
    if (sampleSize >= this.MIN_SAMPLE_SIZE_MEDIUM) return 'medium';
    return 'low';
  }

  /**
   * Generate recommendation based on EV and other factors
   */
  private getRecommendation(
    ev: number,
    profitFactor: number,
    sampleSize: number,
    winProbability: number
  ): 'take' | 'avoid' | 'cautious' {
    // Strong negative EV - avoid
    if (ev < -5) return 'avoid';

    // Negative EV with sufficient data - avoid
    if (ev < 0 && sampleSize >= this.MIN_SAMPLE_SIZE_MEDIUM) return 'avoid';

    // Strong positive EV with good sample size - take
    if (ev > 10 && sampleSize >= this.MIN_SAMPLE_SIZE_MEDIUM && profitFactor > 1.2) return 'take';

    // Positive EV but limited data - cautious
    if (ev > 0 && sampleSize < this.MIN_SAMPLE_SIZE_MEDIUM) return 'cautious';

    // Positive EV with good data - take
    if (ev > 0 && sampleSize >= this.MIN_SAMPLE_SIZE_MEDIUM) return 'take';

    // Everything else - cautious
    return 'cautious';
  }

  /**
   * Calculate exploration value for new patterns
   * Balances exploitation (known good patterns) with exploration (testing new ones)
   */
  calculateExplorationBonus(sampleSize: number): number {
    // Small bonus for patterns with limited data to encourage exploration
    if (sampleSize < this.MIN_SAMPLE_SIZE_LOW) return 2;
    if (sampleSize < this.MIN_SAMPLE_SIZE_MEDIUM) return 1;
    return 0;
  }

  /**
   * Rank multiple patterns by EV with exploration bonus
   */
  rankPatternsByValue(patterns: any[], explorationWeight: number = 0.15): any[] {
    return patterns.map(pattern => {
      const explorationBonus = this.calculateExplorationBonus(pattern.sample_size) * explorationWeight;
      const totalValue = pattern.expected_value + explorationBonus;

      return {
        ...pattern,
        exploration_bonus: explorationBonus,
        total_value: totalValue
      };
    }).sort((a, b) => b.total_value - a.total_value);
  }
}

export const evCalculator = new EVCalculator();
export type { EVCalculationResult, TradeSignalEV, PatternHistoricalData };
