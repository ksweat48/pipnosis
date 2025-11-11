import { supabase } from '../lib/supabase';
import { marketRegimeDetector, MarketRegime } from './market-regime-detector';

/**
 * Strategy Selector Engine
 *
 * Intelligently selects the best strategy from the arsenal based on:
 * - Current market regime
 * - Historical performance in similar conditions
 * - Strategy confidence levels
 * - Fallback to Flow Trader V2 when uncertain
 */

interface StrategyCandidate {
  id: string;
  name: string;
  type: string;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  totalTrades: number;
  regimeWinRate: number;
  confidenceScore: number;
  matchScore: number;
}

interface SelectionDecision {
  selectedStrategy: StrategyCandidate;
  reason: string;
  alternatives: StrategyCandidate[];
  confidence: number;
  marketRegime: MarketRegime;
}

class StrategySelectorEngine {
  private readonly MIN_SAMPLE_SIZE = 10;
  private readonly REGIME_MATCH_WEIGHT = 0.4;
  private readonly OVERALL_PERF_WEIGHT = 0.3;
  private readonly RECENCY_WEIGHT = 0.3;
  private readonly FALLBACK_STRATEGY = 'Flow Trader V2';

  /**
   * Select best strategy for current market conditions
   */
  async selectOptimalStrategy(
    userId: string,
    symbol: string,
    overrideRegime?: MarketRegime
  ): Promise<SelectionDecision> {
    console.log(`\n[Strategy Selector] 🎯 Selecting optimal strategy for ${symbol}`);

    try {
      // 1. Detect current market regime
      const regime = overrideRegime || await marketRegimeDetector.detectRegime(symbol);

      if (!regime) {
        console.log('[Strategy Selector] Could not detect regime - using fallback');
        return this.createFallbackDecision(userId, symbol, null);
      }

      console.log(`[Strategy Selector] Market: ${regime.regimeType} | Volatility: ${regime.volatilityLevel}`);

      // 2. Get all active strategies from arsenal
      const strategies = await this.getActiveStrategies(userId);

      if (strategies.length === 0) {
        console.log('[Strategy Selector] No active strategies - using fallback');
        return this.createFallbackDecision(userId, symbol, regime);
      }

      // 3. Score each strategy for current regime
      const candidates = await this.scoreStrategiesForRegime(userId, symbol, strategies, regime);

      if (candidates.length === 0) {
        console.log('[Strategy Selector] No suitable candidates - using fallback');
        return this.createFallbackDecision(userId, symbol, regime);
      }

      // 4. Sort by match score (best first)
      candidates.sort((a, b) => b.matchScore - a.matchScore);

      // 5. Check if top strategy is reliable enough
      const bestCandidate = candidates[0];

      if (this.isStrategyReliable(bestCandidate, regime)) {
        const decision: SelectionDecision = {
          selectedStrategy: bestCandidate,
          reason: this.generateSelectionReason(bestCandidate, regime),
          alternatives: candidates.slice(1, 4), // Top 3 alternatives
          confidence: bestCandidate.confidenceScore,
          marketRegime: regime
        };

        // Log selection
        await this.logSelection(userId, symbol, decision);

        console.log(`[Strategy Selector] ✅ Selected: ${bestCandidate.name} (Match: ${bestCandidate.matchScore.toFixed(1)})`);

        return decision;
      } else {
        console.log('[Strategy Selector] Top strategy not reliable enough - using fallback');
        return this.createFallbackDecision(userId, symbol, regime);
      }

    } catch (error) {
      console.error('[Strategy Selector] Error:', error);
      return this.createFallbackDecision(userId, symbol, null);
    }
  }

  /**
   * Get all active strategies from database
   */
  private async getActiveStrategies(userId: string): Promise<any[]> {
    const { data, error } = await supabase
      .from('ai_discovered_strategies')
      .select('*')
      .eq('user_id', userId)
      .eq('validation_status', 'active')
      .gte('win_rate', 55)
      .gte('total_trades', this.MIN_SAMPLE_SIZE)
      .order('expectancy', { ascending: false });

    if (error) {
      console.error('[Strategy Selector] Error fetching strategies:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Score strategies for current regime
   */
  private async scoreStrategiesForRegime(
    userId: string,
    symbol: string,
    strategies: any[],
    regime: MarketRegime
  ): Promise<StrategyCandidate[]> {
    const candidates: StrategyCandidate[] = [];

    for (const strategy of strategies) {
      // Get regime-specific win rate
      const regimeWinRate = this.getRegimeWinRate(strategy, regime);

      // Calculate overall performance score (0-100)
      const perfScore = this.calculatePerformanceScore(strategy);

      // Calculate regime match score (0-100)
      const regimeMatchScore = regimeWinRate > 0 ? regimeWinRate : perfScore * 0.7;

      // Calculate recency score (favor recently successful strategies)
      const recencyScore = this.calculateRecencyScore(strategy);

      // Weighted match score
      const matchScore =
        (regimeMatchScore * this.REGIME_MATCH_WEIGHT) +
        (perfScore * this.OVERALL_PERF_WEIGHT) +
        (recencyScore * this.RECENCY_WEIGHT);

      // Confidence based on sample size and consistency
      const confidenceScore = this.calculateConfidenceScore(strategy, regime);

      candidates.push({
        id: strategy.id,
        name: strategy.strategy_name,
        type: strategy.strategy_type,
        winRate: strategy.win_rate,
        profitFactor: strategy.profit_factor,
        expectancy: strategy.expectancy,
        totalTrades: strategy.total_trades,
        regimeWinRate,
        confidenceScore,
        matchScore
      });
    }

    return candidates;
  }

  /**
   * Get win rate for specific regime
   */
  private getRegimeWinRate(strategy: any, regime: MarketRegime): number {
    const regimeField = this.getRegimeFieldName(regime.regimeType);
    return strategy[regimeField] || 0;
  }

  /**
   * Get database field name for regime type
   */
  private getRegimeFieldName(regimeType: string): string {
    const mapping: Record<string, string> = {
      'trending_up': 'trending_up_win_rate',
      'trending_down': 'trending_down_win_rate',
      'ranging': 'ranging_win_rate',
      'mixed': 'ranging_win_rate'
    };
    return mapping[regimeType] || 'win_rate';
  }

  /**
   * Calculate overall performance score
   */
  private calculatePerformanceScore(strategy: any): number {
    const winRate = strategy.win_rate || 0;
    const profitFactor = strategy.profit_factor || 0;
    const expectancy = strategy.expectancy || 0;

    // Normalized score (0-100)
    return (
      (winRate * 0.4) +
      (Math.min(profitFactor / 3, 1) * 30) +
      (Math.min(expectancy / 2, 1) * 30)
    );
  }

  /**
   * Calculate recency score (favor recently used strategies)
   */
  private calculateRecencyScore(strategy: any): number {
    if (!strategy.last_used_at) return 50; // Neutral score if never used

    const lastUsed = new Date(strategy.last_used_at);
    const hoursSinceUse = (Date.now() - lastUsed.getTime()) / (1000 * 60 * 60);

    // Decay score over time
    if (hoursSinceUse < 24) return 100;
    if (hoursSinceUse < 72) return 80;
    if (hoursSinceUse < 168) return 60;
    return 40;
  }

  /**
   * Calculate confidence in strategy selection
   */
  private calculateConfidenceScore(strategy: any, regime: MarketRegime): number {
    let score = 50; // Base confidence

    // Sample size
    if (strategy.total_trades >= 50) score += 20;
    else if (strategy.total_trades >= 30) score += 15;
    else if (strategy.total_trades >= 20) score += 10;

    // Win rate consistency
    if (strategy.win_rate >= 70) score += 20;
    else if (strategy.win_rate >= 60) score += 10;

    // Regime-specific performance
    const regimeWR = this.getRegimeWinRate(strategy, regime);
    if (regimeWR >= 65) score += 10;
    else if (regimeWR > 0 && regimeWR < 50) score -= 15;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Check if strategy is reliable enough to use
   */
  private isStrategyReliable(candidate: StrategyCandidate, regime: MarketRegime): boolean {
    // Minimum requirements
    if (candidate.totalTrades < this.MIN_SAMPLE_SIZE) return false;
    if (candidate.winRate < 55) return false;
    if (candidate.confidenceScore < 60) return false;

    // If regime-specific data exists, check it
    if (candidate.regimeWinRate > 0 && candidate.regimeWinRate < 50) return false;

    return true;
  }

  /**
   * Generate human-readable selection reason
   */
  private generateSelectionReason(candidate: StrategyCandidate, regime: MarketRegime): string {
    const parts: string[] = [];

    // Main reason
    if (candidate.regimeWinRate > 0) {
      parts.push(`${candidate.regimeWinRate.toFixed(1)}% win rate in ${regime.regimeType} markets`);
    } else {
      parts.push(`${candidate.winRate.toFixed(1)}% overall win rate`);
    }

    // Supporting factors
    if (candidate.profitFactor >= 2.0) {
      parts.push(`excellent profit factor (${candidate.profitFactor.toFixed(2)})`);
    }

    if (candidate.totalTrades >= 30) {
      parts.push(`proven over ${candidate.totalTrades} trades`);
    }

    // Regime context
    parts.push(`optimal for ${regime.volatilityLevel} volatility`);

    return parts.join(', ');
  }

  /**
   * Create fallback decision (use Flow Trader V2)
   */
  private async createFallbackDecision(
    userId: string,
    symbol: string,
    regime: MarketRegime | null
  ): Promise<SelectionDecision> {
    // Get Flow Trader V2 data
    const { data: flowTrader } = await supabase
      .from('ai_discovered_strategies')
      .select('*')
      .eq('user_id', userId)
      .eq('strategy_name', this.FALLBACK_STRATEGY)
      .maybeSingle();

    const fallbackCandidate: StrategyCandidate = {
      id: flowTrader?.id || 'flow_v2',
      name: this.FALLBACK_STRATEGY,
      type: 'baseline',
      winRate: flowTrader?.win_rate || 55,
      profitFactor: flowTrader?.profit_factor || 1.5,
      expectancy: flowTrader?.expectancy || 0.5,
      totalTrades: flowTrader?.total_trades || 0,
      regimeWinRate: 0,
      confidenceScore: 70,
      matchScore: 70
    };

    return {
      selectedStrategy: fallbackCandidate,
      reason: 'Using proven baseline strategy (insufficient data for AI strategies)',
      alternatives: [],
      confidence: 70,
      marketRegime: regime || {
        regimeType: 'mixed',
        volatilityLevel: 'medium',
        trendStrength: 0,
        confidence: 0,
        sessionType: 'newyork',
        characteristics: {
          atr: 0,
          atrPercentile: 50,
          priceLocation: 'middle',
          volumeTrend: 'stable'
        }
      }
    };
  }

  /**
   * Log strategy selection for learning
   */
  private async logSelection(
    userId: string,
    symbol: string,
    decision: SelectionDecision
  ): Promise<void> {
    try {
      await supabase.from('strategy_selection_log').insert({
        user_id: userId,
        selected_strategy_id: decision.selectedStrategy.id,
        selected_strategy_name: decision.selectedStrategy.name,
        selection_reason: decision.reason,
        market_regime: {
          type: decision.marketRegime.regimeType,
          volatility: decision.marketRegime.volatilityLevel,
          trend_strength: decision.marketRegime.trendStrength
        },
        current_volatility: decision.marketRegime.volatilityLevel,
        trend_direction: decision.marketRegime.regimeType,
        session_type: decision.marketRegime.sessionType,
        strategy_confidence: decision.confidence,
        performance_in_regime: decision.selectedStrategy.regimeWinRate,
        alternatives_considered: decision.alternatives.map(alt => ({
          name: alt.name,
          match_score: alt.matchScore,
          win_rate: alt.winRate
        }))
      });

      // Update last_used_at for selected strategy
      await supabase
        .from('ai_discovered_strategies')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', decision.selectedStrategy.id);

    } catch (error) {
      console.error('[Strategy Selector] Error logging selection:', error);
    }
  }

  /**
   * Update selection outcome after trade execution
   */
  async updateSelectionOutcome(
    userId: string,
    selectionLogId: string,
    tradeId: string,
    outcome: 'win' | 'loss' | 'breakeven'
  ): Promise<void> {
    try {
      const wasGoodSelection = outcome === 'win';

      await supabase
        .from('strategy_selection_log')
        .update({
          trade_id: tradeId,
          trade_outcome: outcome,
          was_good_selection: wasGoodSelection
        })
        .eq('id', selectionLogId)
        .eq('user_id', userId);

      console.log(`[Strategy Selector] Updated selection outcome: ${outcome}`);
    } catch (error) {
      console.error('[Strategy Selector] Error updating outcome:', error);
    }
  }

  /**
   * Get strategy selection performance stats
   */
  async getSelectionPerformance(userId: string): Promise<any> {
    try {
      const { data, error } = await supabase
        .from('strategy_selection_log')
        .select('*')
        .eq('user_id', userId)
        .not('trade_outcome', 'is', null)
        .order('selected_at', { ascending: false })
        .limit(100);

      if (error || !data || data.length === 0) {
        return {
          totalSelections: 0,
          goodSelections: 0,
          accuracy: 0,
          byRegime: {}
        };
      }

      const totalSelections = data.length;
      const goodSelections = data.filter(s => s.was_good_selection).length;
      const accuracy = (goodSelections / totalSelections) * 100;

      // Group by regime
      const byRegime: Record<string, any> = {};
      for (const selection of data) {
        const regime = selection.market_regime?.type || 'unknown';
        if (!byRegime[regime]) {
          byRegime[regime] = { total: 0, good: 0, accuracy: 0 };
        }
        byRegime[regime].total++;
        if (selection.was_good_selection) byRegime[regime].good++;
      }

      // Calculate regime accuracy
      for (const regime of Object.keys(byRegime)) {
        byRegime[regime].accuracy = (byRegime[regime].good / byRegime[regime].total) * 100;
      }

      return {
        totalSelections,
        goodSelections,
        accuracy,
        byRegime
      };

    } catch (error) {
      console.error('[Strategy Selector] Error getting performance:', error);
      return null;
    }
  }
}

export const strategySelectorEngine = new StrategySelectorEngine();
export type { StrategyCandidate, SelectionDecision };
