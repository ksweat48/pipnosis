import { supabase } from '../lib/supabase';
import { enhancedMarketRegimeDetector, type EnhancedMarketRegime } from './enhanced-market-regime-detector';

interface RegimePerformance {
  regime: string;
  symbol: string;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  avgRR: number;
  optimalConfidenceThreshold: number;
  bestStrategy: string;
  bestTimeOfDay: string[];
  worstTimeOfDay: string[];
}

interface OptimizedParameters {
  confidenceThreshold: number;
  positionSizeMultiplier: number;
  stopLossMultiplier: number;
  takeProfitMultiplier: number;
  maxTradesPerSession: number;
  avoidHours: number[];
  preferHours: number[];
  reasoning: string[];
}

class RegimeSpecificStrategyOptimizer {
  async optimizeForRegime(
    userId: string,
    symbol: string,
    currentRegime: EnhancedMarketRegime
  ): Promise<OptimizedParameters> {
    console.log(`[Regime Optimizer] Optimizing for ${currentRegime.regimeType} regime`);

    const performance = await this.getRegimePerformance(userId, symbol, currentRegime.regimeType);

    if (!performance || performance.totalTrades < 10) {
      return this.getDefaultParameters(currentRegime);
    }

    const optimized = this.calculateOptimalParameters(currentRegime, performance);

    await this.saveOptimizedParameters(userId, symbol, currentRegime.regimeType, optimized);

    return optimized;
  }

  private async getRegimePerformance(
    userId: string,
    symbol: string,
    regimeType: string
  ): Promise<RegimePerformance | null> {
    try {
      const { data: trades } = await supabase
        .from('ai_trade_analysis')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .order('entry_time', { ascending: false })
        .limit(200);

      if (!trades || trades.length === 0) return null;

      const regimeTrades = trades.filter(t =>
        t.entry_market_conditions?.regimeType === regimeType
      );

      if (regimeTrades.length < 10) return null;

      const wins = regimeTrades.filter(t => t.outcome === 'win');
      const losses = regimeTrades.filter(t => t.outcome === 'loss');

      const winRate = (wins.length / regimeTrades.length) * 100;

      const totalWins = wins.reduce((sum, t) => sum + parseFloat(t.pnl.toString()), 0);
      const totalLosses = Math.abs(losses.reduce((sum, t) => sum + parseFloat(t.pnl.toString()), 0));
      const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 0;

      const avgRR = regimeTrades.reduce((sum, t) => sum + t.risk_reward_at_entry, 0) / regimeTrades.length;

      const optimalConfidence = this.findOptimalConfidenceThreshold(regimeTrades);

      const bestStrategy = this.identifyBestStrategy(regimeTrades);

      const timeAnalysis = this.analyzeTimeOfDay(regimeTrades);

      return {
        regime: regimeType,
        symbol,
        totalTrades: regimeTrades.length,
        winRate,
        profitFactor,
        avgRR,
        optimalConfidenceThreshold: optimalConfidence,
        bestStrategy,
        bestTimeOfDay: timeAnalysis.best,
        worstTimeOfDay: timeAnalysis.worst
      };
    } catch (error) {
      console.error('[Regime Optimizer] Error getting performance:', error);
      return null;
    }
  }

  private findOptimalConfidenceThreshold(trades: any[]): number {
    const thresholds = [60, 65, 70, 75, 80, 85, 90];
    let bestThreshold = 75;
    let bestScore = 0;

    for (const threshold of thresholds) {
      const filtered = trades.filter(t => t.entry_confidence >= threshold);
      if (filtered.length < 5) continue;

      const wins = filtered.filter(t => t.outcome === 'win').length;
      const winRate = (wins / filtered.length) * 100;

      const score = winRate * Math.log(filtered.length + 1);

      if (score > bestScore && winRate >= 55) {
        bestScore = score;
        bestThreshold = threshold;
      }
    }

    return bestThreshold;
  }

  private identifyBestStrategy(trades: any[]): string {
    const strategyPerformance: Record<string, { wins: number; total: number }> = {};

    for (const trade of trades) {
      const strategy = trade.entry_market_conditions?.optimalStrategy || 'Unknown';
      if (!strategyPerformance[strategy]) {
        strategyPerformance[strategy] = { wins: 0, total: 0 };
      }
      strategyPerformance[strategy].total++;
      if (trade.outcome === 'win') {
        strategyPerformance[strategy].wins++;
      }
    }

    let bestStrategy = 'Unknown';
    let bestWinRate = 0;

    for (const [strategy, stats] of Object.entries(strategyPerformance)) {
      if (stats.total < 3) continue;
      const winRate = (stats.wins / stats.total) * 100;
      if (winRate > bestWinRate) {
        bestWinRate = winRate;
        bestStrategy = strategy;
      }
    }

    return bestStrategy;
  }

  private analyzeTimeOfDay(trades: any[]): { best: string[]; worst: string[] } {
    const hourPerformance: Record<number, { wins: number; total: number }> = {};

    for (const trade of trades) {
      const hour = new Date(trade.entry_time).getUTCHours();
      if (!hourPerformance[hour]) {
        hourPerformance[hour] = { wins: 0, total: 0 };
      }
      hourPerformance[hour].total++;
      if (trade.outcome === 'win') {
        hourPerformance[hour].wins++;
      }
    }

    const hourRanking = Object.entries(hourPerformance)
      .filter(([_, stats]) => stats.total >= 3)
      .map(([hour, stats]) => ({
        hour: parseInt(hour),
        winRate: (stats.wins / stats.total) * 100,
        total: stats.total
      }))
      .sort((a, b) => b.winRate - a.winRate);

    const best = hourRanking.slice(0, 3).map(h => `${h.hour}:00 UTC (${h.winRate.toFixed(0)}% WR)`);
    const worst = hourRanking.slice(-3).map(h => `${h.hour}:00 UTC (${h.winRate.toFixed(0)}% WR)`);

    return { best, worst };
  }

  private calculateOptimalParameters(
    regime: EnhancedMarketRegime,
    performance: RegimePerformance
  ): OptimizedParameters {
    let confidenceThreshold = performance.optimalConfidenceThreshold;
    let positionSizeMultiplier = 1.0;
    let stopLossMultiplier = 1.0;
    let takeProfitMultiplier = 1.0;
    let maxTradesPerSession = 10;
    const avoidHours: number[] = [];
    const preferHours: number[] = [];
    const reasoning: string[] = [];

    if (regime.regimeType === 'trending_up' || regime.regimeType === 'trending_down') {
      if (performance.winRate >= 65) {
        confidenceThreshold = Math.max(65, performance.optimalConfidenceThreshold - 5);
        positionSizeMultiplier = 1.2;
        reasoning.push('Strong trend performance: reducing confidence threshold and increasing position size');
      }

      takeProfitMultiplier = 1.5;
      reasoning.push('Trending market: extending take profit targets');
    }

    if (regime.regimeType === 'ranging') {
      if (performance.profitFactor < 1.2) {
        confidenceThreshold = Math.min(85, performance.optimalConfidenceThreshold + 5);
        reasoning.push('Ranging market with mediocre performance: increasing confidence threshold');
      }

      stopLossMultiplier = 0.8;
      takeProfitMultiplier = 0.9;
      maxTradesPerSession = 15;
      reasoning.push('Ranging market: tighter stops, shorter targets, more trades');
    }

    if (regime.volatilityLevel === 'high' || regime.volatilityLevel === 'extreme') {
      stopLossMultiplier *= 1.3;
      takeProfitMultiplier *= 1.3;
      positionSizeMultiplier *= 0.7;
      maxTradesPerSession = Math.floor(maxTradesPerSession * 0.7);
      reasoning.push('High volatility: wider stops/targets, reduced position size');
    }

    if (regime.volatilityLevel === 'low') {
      stopLossMultiplier *= 0.9;
      takeProfitMultiplier *= 0.9;
      positionSizeMultiplier *= 1.1;
      reasoning.push('Low volatility: tighter stops/targets, slightly larger positions');
    }

    if (performance.winRate >= 70 && performance.profitFactor >= 1.5) {
      confidenceThreshold = Math.max(60, confidenceThreshold - 5);
      positionSizeMultiplier *= 1.2;
      reasoning.push('Exceptional regime performance: aggressive parameters');
    } else if (performance.winRate < 50 || performance.profitFactor < 1.0) {
      confidenceThreshold = Math.min(90, confidenceThreshold + 10);
      positionSizeMultiplier *= 0.7;
      maxTradesPerSession = Math.floor(maxTradesPerSession * 0.6);
      reasoning.push('Poor regime performance: defensive parameters');
    }

    for (const timeStr of performance.worstTimeOfDay) {
      const hour = parseInt(timeStr.split(':')[0]);
      if (!isNaN(hour)) avoidHours.push(hour);
    }

    for (const timeStr of performance.bestTimeOfDay) {
      const hour = parseInt(timeStr.split(':')[0]);
      if (!isNaN(hour)) preferHours.push(hour);
    }

    return {
      confidenceThreshold: Math.round(confidenceThreshold),
      positionSizeMultiplier: Math.round(positionSizeMultiplier * 100) / 100,
      stopLossMultiplier: Math.round(stopLossMultiplier * 100) / 100,
      takeProfitMultiplier: Math.round(takeProfitMultiplier * 100) / 100,
      maxTradesPerSession,
      avoidHours,
      preferHours,
      reasoning
    };
  }

  private getDefaultParameters(regime: EnhancedMarketRegime): OptimizedParameters {
    const reasoning: string[] = ['Insufficient historical data - using conservative defaults'];

    let confidenceThreshold = 75;
    let positionSizeMultiplier = 1.0;
    let stopLossMultiplier = 1.0;
    let takeProfitMultiplier = 1.0;

    if (regime.volatilityLevel === 'high' || regime.volatilityLevel === 'extreme') {
      stopLossMultiplier = 1.3;
      takeProfitMultiplier = 1.3;
      positionSizeMultiplier = 0.8;
      confidenceThreshold = 80;
      reasoning.push('High volatility detected: conservative approach with wider stops');
    }

    if (regime.regimeType === 'trending_up' || regime.regimeType === 'trending_down') {
      takeProfitMultiplier = 1.3;
      reasoning.push('Trending market: extended profit targets');
    }

    return {
      confidenceThreshold,
      positionSizeMultiplier,
      stopLossMultiplier,
      takeProfitMultiplier,
      maxTradesPerSession: 10,
      avoidHours: [],
      preferHours: [],
      reasoning
    };
  }

  private async saveOptimizedParameters(
    userId: string,
    symbol: string,
    regimeType: string,
    params: OptimizedParameters
  ): Promise<void> {
    try {
      await supabase
        .from('regime_optimized_parameters')
        .upsert({
          user_id: userId,
          symbol,
          regime_type: regimeType,
          confidence_threshold: params.confidenceThreshold,
          position_size_multiplier: params.positionSizeMultiplier,
          stop_loss_multiplier: params.stopLossMultiplier,
          take_profit_multiplier: params.takeProfitMultiplier,
          max_trades_per_session: params.maxTradesPerSession,
          avoid_hours: params.avoidHours,
          prefer_hours: params.preferHours,
          reasoning: params.reasoning,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,symbol,regime_type'
        });
    } catch (error) {
      console.error('[Regime Optimizer] Error saving parameters:', error);
    }
  }

  async getOptimizedParameters(
    userId: string,
    symbol: string,
    regimeType: string
  ): Promise<OptimizedParameters | null> {
    try {
      const { data, error } = await supabase
        .from('regime_optimized_parameters')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .eq('regime_type', regimeType)
        .maybeSingle();

      if (error || !data) return null;

      return {
        confidenceThreshold: data.confidence_threshold,
        positionSizeMultiplier: data.position_size_multiplier,
        stopLossMultiplier: data.stop_loss_multiplier,
        takeProfitMultiplier: data.take_profit_multiplier,
        maxTradesPerSession: data.max_trades_per_session,
        avoidHours: data.avoid_hours || [],
        preferHours: data.prefer_hours || [],
        reasoning: data.reasoning || []
      };
    } catch (error) {
      console.error('[Regime Optimizer] Error getting parameters:', error);
      return null;
    }
  }

  async trackRegimePerformance(
    userId: string,
    symbol: string,
    regimeType: string,
    tradeOutcome: 'win' | 'loss' | 'breakeven',
    pnl: number
  ): Promise<void> {
    try {
      const { data: existing } = await supabase
        .from('regime_performance_tracking')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .eq('regime', regimeType)
        .maybeSingle();

      if (existing) {
        const newTotal = existing.trades_count + 1;
        const newWins = existing.wins_count + (tradeOutcome === 'win' ? 1 : 0);
        const newWinRate = (newWins / newTotal) * 100;

        await supabase
          .from('regime_performance_tracking')
          .update({
            trades_count: newTotal,
            wins_count: newWins,
            win_rate: newWinRate,
            last_updated: new Date().toISOString()
          })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('regime_performance_tracking')
          .insert({
            user_id: userId,
            symbol,
            regime: regimeType,
            trades_count: 1,
            wins_count: tradeOutcome === 'win' ? 1 : 0,
            win_rate: tradeOutcome === 'win' ? 100 : 0
          });
      }
    } catch (error) {
      console.error('[Regime Optimizer] Error tracking performance:', error);
    }
  }
}

export const regimeSpecificStrategyOptimizer = new RegimeSpecificStrategyOptimizer();
export type { RegimePerformance, OptimizedParameters };
