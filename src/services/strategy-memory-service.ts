/**
 * Strategy Memory Service
 *
 * Enables Pipnosis Alpha Brain to remember and learn from past strategies.
 * This is the missing piece that transforms Alpha from session-scoped to continuously evolving.
 *
 * Key Functions:
 * - Load past strategy performance
 * - Save new strategy plans
 * - Update strategies with trade outcomes
 * - Generate memory summaries for LLM prompts
 * - Query best/worst patterns by regime
 */

import { supabase } from '../lib/supabase';
import type { StrategyPlan } from './llm-strategy-brain';

export interface StrategyMemoryRecord {
  id: string;
  strategy_mode: string;
  conditions: string[];
  entry_logic: string;
  market_regime: string;
  volatility: string;
  trades_executed: number;
  win_rate: number;
  total_pnl: number;
  performance_rating: string;
  what_worked?: string;
  what_failed?: string;
  key_lesson?: string;
  planned_confidence: number;
  confidence_accuracy?: number;
}

export interface StrategyMemory {
  recentStrategies: StrategyMemoryRecord[];
  bestInCurrentRegime: StrategyMemoryRecord[];
  worstPatterns: StrategyMemoryRecord[];
  regimeInsights: RegimeInsights;
  memorySummary: string;
}

export interface RegimeInsights {
  currentRegime: string;
  bestStrategyMode: string | null;
  bestWinRate: number;
  totalExperience: number;
  recommendedApproach: string;
}

export interface MarketContext {
  symbol: string;
  timeframe: string;
  regime: string;
  volatility: string;
  price: number;
  ema50: number;
  ema200: number;
  rsi: number;
  atr: number;
  trend_strength?: number;
  indicators?: any;
}

class StrategyMemoryService {
  /**
   * Load strategy memory for LLM planning
   */
  async loadMemory(
    userId: string,
    symbol: string,
    currentRegime: string,
    currentVolatility: string
  ): Promise<StrategyMemory> {
    // Get recent strategies (last 10)
    const { data: recentStrategies } = await supabase
      .from('alpha_strategy_memory')
      .select('*')
      .eq('user_id', userId)
      .eq('symbol', symbol)
      .order('planned_at', { ascending: false })
      .limit(10);

    // Get best performers in current regime
    const { data: bestInRegime } = await supabase
      .from('alpha_strategy_memory')
      .select('*')
      .eq('user_id', userId)
      .eq('symbol', symbol)
      .eq('market_regime', currentRegime)
      .eq('volatility', currentVolatility)
      .gte('trades_executed', 3) // Minimum sample size
      .gte('win_rate', 0.65)
      .order('win_rate', { ascending: false })
      .limit(3);

    // Get worst patterns to avoid
    const { data: worstPatterns } = await supabase
      .from('alpha_strategy_memory')
      .select('*')
      .eq('user_id', userId)
      .eq('symbol', symbol)
      .gte('trades_executed', 3)
      .lte('win_rate', 0.40)
      .order('win_rate', { ascending: true })
      .limit(3);

    // Generate regime insights
    const regimeInsights = this.analyzeRegimePerformance(
      recentStrategies || [],
      currentRegime,
      currentVolatility
    );

    // Generate memory summary for LLM
    const memorySummary = this.generateMemorySummary(
      recentStrategies || [],
      bestInRegime || [],
      worstPatterns || [],
      regimeInsights
    );

    return {
      recentStrategies: recentStrategies || [],
      bestInCurrentRegime: bestInRegime || [],
      worstPatterns: worstPatterns || [],
      regimeInsights,
      memorySummary
    };
  }

  /**
   * Save new strategy plan to memory
   */
  async saveStrategyPlan(
    userId: string,
    plan: StrategyPlan,
    marketContext: MarketContext,
    sessionId?: string,
    goalSessionId?: string
  ): Promise<string> {
    const { data, error } = await supabase
      .from('alpha_strategy_memory')
      .insert({
        user_id: userId,
        session_id: sessionId,
        goal_session_id: goalSessionId,

        // Strategy definition
        strategy_mode: plan.mode,
        conditions: plan.conditions,
        entry_logic: plan.entry_logic,
        sl_calculation: plan.sl_calculation,
        tp_calculation: plan.tp_calculation,
        risk_pct: plan.riskLevel,
        planned_confidence: plan.confidence,
        rationale: plan.rationale,
        watch_indicators: plan.watch_indicators,

        // Market context
        symbol: marketContext.symbol,
        timeframe: marketContext.timeframe,
        market_regime: marketContext.regime,
        volatility: marketContext.volatility,
        trend_strength: marketContext.trend_strength,
        price_at_plan: marketContext.price,
        ema50_at_plan: marketContext.ema50,
        ema200_at_plan: marketContext.ema200,
        rsi_at_plan: marketContext.rsi,
        atr_at_plan: marketContext.atr,
        market_indicators: marketContext.indicators,

        // Lifecycle
        active_from: new Date().toISOString(),
        status: 'active'
      })
      .select('id')
      .single();

    if (error) {
      console.error('[Strategy Memory] Error saving strategy:', error);
      throw error;
    }

    console.log(`[Strategy Memory] ✅ Saved strategy: ${plan.mode} (ID: ${data.id})`);
    return data.id;
  }

  /**
   * Update strategy with trade outcome
   */
  async updateWithTradeOutcome(
    strategyId: string,
    tradeOutcome: {
      pnl: number;
      outcome: 'win' | 'loss' | 'breakeven';
      holdTimeMinutes: number;
    }
  ): Promise<void> {
    // Load current strategy
    const { data: strategy, error: loadError } = await supabase
      .from('alpha_strategy_memory')
      .select('*')
      .eq('id', strategyId)
      .single();

    if (loadError || !strategy) {
      console.warn('[Strategy Memory] Strategy not found:', strategyId);
      return;
    }

    // Calculate new stats
    const newTradesExecuted = strategy.trades_executed + 1;
    const newWins = tradeOutcome.outcome === 'win' ? strategy.trades_won + 1 : strategy.trades_won;
    const newLosses = tradeOutcome.outcome === 'loss' ? strategy.trades_lost + 1 : strategy.trades_lost;
    const newBreakeven = tradeOutcome.outcome === 'breakeven' ? strategy.trades_breakeven + 1 : strategy.trades_breakeven;
    const newWinRate = newWins / newTradesExecuted;
    const newTotalPnL = strategy.total_pnl + tradeOutcome.pnl;
    const newAvgPnL = newTotalPnL / newTradesExecuted;
    const newMaxPnL = Math.max(strategy.max_pnl || tradeOutcome.pnl, tradeOutcome.pnl);
    const newMinPnL = Math.min(strategy.min_pnl || tradeOutcome.pnl, tradeOutcome.pnl);

    const totalHoldTime = (strategy.avg_hold_time_minutes || 0) * strategy.trades_executed + tradeOutcome.holdTimeMinutes;
    const newAvgHoldTime = totalHoldTime / newTradesExecuted;

    // Determine performance rating
    const performanceRating = this.calculatePerformanceRating(newWinRate, newTotalPnL, newTradesExecuted);

    // Calculate confidence accuracy (how close was the planned confidence to actual win rate)
    const confidenceAccuracy = strategy.planned_confidence > 0
      ? 100 - Math.abs(strategy.planned_confidence - (newWinRate * 100))
      : null;

    // Update strategy
    const { error: updateError } = await supabase
      .from('alpha_strategy_memory')
      .update({
        trades_executed: newTradesExecuted,
        trades_won: newWins,
        trades_lost: newLosses,
        trades_breakeven: newBreakeven,
        win_rate: newWinRate,
        avg_pnl: newAvgPnL,
        total_pnl: newTotalPnL,
        max_pnl: newMaxPnL,
        min_pnl: newMinPnL,
        avg_hold_time_minutes: newAvgHoldTime,
        performance_rating: performanceRating,
        confidence_accuracy: confidenceAccuracy,
        updated_at: new Date().toISOString()
      })
      .eq('id', strategyId);

    if (updateError) {
      console.error('[Strategy Memory] Error updating strategy:', updateError);
      return;
    }

    console.log(`[Strategy Memory] ✅ Updated strategy ${strategyId}: ${newWinRate.toFixed(1)}% WR (${newTradesExecuted} trades)`);
  }

  /**
   * Complete a strategy (mark as finished)
   */
  async completeStrategy(
    strategyId: string,
    outcomeSummary?: string,
    whatWorked?: string,
    whatFailed?: string,
    keyLesson?: string
  ): Promise<void> {
    await supabase
      .from('alpha_strategy_memory')
      .update({
        status: 'completed',
        active_until: new Date().toISOString(),
        outcome_summary: outcomeSummary,
        what_worked: whatWorked,
        what_failed: whatFailed,
        key_lesson: keyLesson
      })
      .eq('id', strategyId);

    console.log(`[Strategy Memory] ✅ Completed strategy ${strategyId}`);
  }

  /**
   * Analyze regime-specific performance
   */
  private analyzeRegimePerformance(
    strategies: any[],
    currentRegime: string,
    currentVolatility: string
  ): RegimeInsights {
    const regimeStrategies = strategies.filter(
      s => s.market_regime === currentRegime &&
           s.volatility === currentVolatility &&
           s.trades_executed >= 3
    );

    if (regimeStrategies.length === 0) {
      return {
        currentRegime: `${currentRegime} / ${currentVolatility} vol`,
        bestStrategyMode: null,
        bestWinRate: 0,
        totalExperience: 0,
        recommendedApproach: 'No experience in this regime - explore cautiously'
      };
    }

    // Find best performing strategy mode
    const modePerformance = new Map<string, { winRate: number; trades: number }>();

    for (const strategy of regimeStrategies) {
      const existing = modePerformance.get(strategy.strategy_mode);
      if (existing) {
        const totalTrades = existing.trades + strategy.trades_executed;
        const combinedWinRate =
          (existing.winRate * existing.trades + strategy.win_rate * strategy.trades_executed) / totalTrades;
        modePerformance.set(strategy.strategy_mode, {
          winRate: combinedWinRate,
          trades: totalTrades
        });
      } else {
        modePerformance.set(strategy.strategy_mode, {
          winRate: strategy.win_rate,
          trades: strategy.trades_executed
        });
      }
    }

    let bestMode = null;
    let bestWinRate = 0;

    for (const [mode, stats] of modePerformance.entries()) {
      if (stats.winRate > bestWinRate) {
        bestWinRate = stats.winRate;
        bestMode = mode;
      }
    }

    const totalTrades = regimeStrategies.reduce((sum, s) => sum + s.trades_executed, 0);

    return {
      currentRegime: `${currentRegime} / ${currentVolatility} vol`,
      bestStrategyMode: bestMode,
      bestWinRate,
      totalExperience: totalTrades,
      recommendedApproach: this.generateRecommendation(bestMode, bestWinRate, totalTrades)
    };
  }

  /**
   * Generate memory summary for LLM prompt
   */
  private generateMemorySummary(
    recent: any[],
    best: any[],
    worst: any[],
    insights: RegimeInsights
  ): string {
    const parts: string[] = [];

    // Regime insights
    parts.push(`REGIME: ${insights.currentRegime}`);
    if (insights.totalExperience > 0) {
      parts.push(`Experience: ${insights.totalExperience} trades`);
      if (insights.bestStrategyMode) {
        parts.push(`Best approach: ${insights.bestStrategyMode} (${(insights.bestWinRate * 100).toFixed(0)}% WR)`);
      }
    } else {
      parts.push('Experience: NEW REGIME - explore cautiously');
    }

    // Best patterns
    if (best.length > 0) {
      parts.push('\nSUCCESSFUL PATTERNS:');
      best.slice(0, 2).forEach(s => {
        parts.push(`- ${s.strategy_mode}: ${s.conditions.join(', ')} → ${(s.win_rate * 100).toFixed(0)}% WR`);
        if (s.what_worked) parts.push(`  ✓ ${s.what_worked}`);
      });
    }

    // Patterns to avoid
    if (worst.length > 0) {
      parts.push('\nAVOID:');
      worst.slice(0, 2).forEach(s => {
        parts.push(`- ${s.strategy_mode} in this regime: ${(s.win_rate * 100).toFixed(0)}% WR`);
        if (s.what_failed) parts.push(`  ✗ ${s.what_failed}`);
      });
    }

    // Recent learnings
    if (recent.length > 0) {
      const recentWithLessons = recent.filter(s => s.key_lesson);
      if (recentWithLessons.length > 0) {
        parts.push('\nRECENT LESSONS:');
        recentWithLessons.slice(0, 2).forEach(s => {
          parts.push(`- ${s.key_lesson}`);
        });
      }
    }

    return parts.join('\n');
  }

  /**
   * Calculate performance rating
   */
  private calculatePerformanceRating(winRate: number, totalPnL: number, trades: number): string {
    if (trades < 3) return 'pending';

    if (winRate >= 0.75 && totalPnL > 100) return 'excellent';
    if (winRate >= 0.65 && totalPnL > 50) return 'good';
    if (winRate >= 0.50 && totalPnL > 0) return 'fair';
    if (winRate >= 0.35) return 'poor';
    return 'terrible';
  }

  /**
   * Generate recommendation based on regime performance
   */
  private generateRecommendation(bestMode: string | null, winRate: number, trades: number): string {
    if (trades === 0) return 'No experience - explore carefully';
    if (trades < 10) return `Limited data (${trades} trades) - continue exploring`;

    if (bestMode && winRate >= 0.70) {
      return `Strong: Use ${bestMode} strategy (proven ${(winRate * 100).toFixed(0)}% WR)`;
    }
    if (bestMode && winRate >= 0.55) {
      return `Moderate: ${bestMode} working (${(winRate * 100).toFixed(0)}% WR), refine execution`;
    }
    return 'Struggling in this regime - consider new approach';
  }
}

export const strategyMemoryService = new StrategyMemoryService();
