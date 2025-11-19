import { supabase } from '../lib/supabase';

interface EnrichedContext {
  historicalPerformance: {
    symbol: string;
    recentWinRate: number;
    recentProfitFactor: number;
    tradesAnalyzed: number;
    bestSetupType: string;
    worstSetupType: string;
  };
  llmInsights: Array<{
    title: string;
    description: string;
    confidence: number;
    reasoning: string;
    whenToApply: string;
    whenToAvoid: string;
  }>;
  marketScenarioAdvice: {
    currentScenario: string;
    historicalSuccessRate: number;
    optimalConfidence: number;
    keySignals: string[];
    warnings: string[];
  };
  confidenceCalibration: {
    recommendedThreshold: number;
    reasoning: string;
    recentAccuracy: number;
  };
  strategicGuidance: string[];
}

class LLMContextEnricher {
  async enrichDecisionContext(
    userId: string,
    symbol: string,
    currentConfidence: number,
    marketConditions: any
  ): Promise<EnrichedContext> {
    console.log(`[LLM Context Enricher] 📊 Enriching context for ${symbol} decision`);

    try {
      const [
        historicalPerformance,
        llmInsights,
        scenarioAdvice,
        calibration
      ] = await Promise.all([
        this.getHistoricalPerformance(userId, symbol),
        this.getLLMGeneratedInsights(userId, symbol),
        this.getMarketScenarioAdvice(userId, symbol),
        this.getConfidenceCalibration(userId, symbol, currentConfidence)
      ]);

      const strategicGuidance = this.generateStrategicGuidance(
        historicalPerformance,
        llmInsights,
        scenarioAdvice,
        calibration
      );

      return {
        historicalPerformance,
        llmInsights,
        marketScenarioAdvice: scenarioAdvice,
        confidenceCalibration: calibration,
        strategicGuidance
      };
    } catch (error) {
      console.error('[LLM Context Enricher] Error enriching context:', error);
      return this.getDefaultContext(symbol, currentConfidence);
    }
  }

  private async getHistoricalPerformance(userId: string, symbol: string): Promise<any> {
    try {
      const { data: trades } = await supabase
        .from('ai_trade_analysis')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .order('entry_time', { ascending: false })
        .limit(50);

      if (!trades || trades.length < 5) {
        return {
          symbol,
          recentWinRate: 50,
          recentProfitFactor: 1.0,
          tradesAnalyzed: 0,
          bestSetupType: 'Unknown',
          worstSetupType: 'Unknown'
        };
      }

      const wins = trades.filter(t => t.outcome === 'win');
      const winRate = (wins.length / trades.length) * 100;

      const totalWins = wins.reduce((sum, t) => sum + parseFloat(t.pnl.toString()), 0);
      const totalLosses = Math.abs(
        trades.filter(t => t.outcome === 'loss')
          .reduce((sum, t) => sum + parseFloat(t.pnl.toString()), 0)
      );
      const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 0;

      const setupPerformance = this.analyzeSetupPerformance(trades);

      return {
        symbol,
        recentWinRate: winRate,
        recentProfitFactor: profitFactor,
        tradesAnalyzed: trades.length,
        bestSetupType: setupPerformance.best,
        worstSetupType: setupPerformance.worst
      };
    } catch (error) {
      console.error('[LLM Context Enricher] Error getting historical performance:', error);
      return {
        symbol,
        recentWinRate: 50,
        recentProfitFactor: 1.0,
        tradesAnalyzed: 0,
        bestSetupType: 'Unknown',
        worstSetupType: 'Unknown'
      };
    }
  }

  private async getLLMGeneratedInsights(userId: string, symbol: string): Promise<any[]> {
    try {
      const { data: insights } = await supabase
        .from('ai_learning_insights')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .eq('llm_generated', true)
        .gte('confidence_score', 70)
        .order('confidence_score', { ascending: false })
        .limit(5);

      if (!insights || insights.length === 0) {
        return [];
      }

      return insights.map(insight => ({
        title: insight.insight_title,
        description: insight.insight_description,
        confidence: insight.confidence_score,
        reasoning: insight.llm_reasoning || 'No reasoning provided',
        whenToApply: insight.apply_when_conditions?.when || 'General conditions',
        whenToAvoid: insight.avoid_when_conditions?.when || 'No specific avoidance criteria'
      }));
    } catch (error) {
      console.error('[LLM Context Enricher] Error getting LLM insights:', error);
      return [];
    }
  }

  private async getMarketScenarioAdvice(userId: string, symbol: string): Promise<any> {
    try {
      const { data: scenarios } = await supabase
        .from('ai_market_scenario_performance')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .order('win_rate', { ascending: false })
        .limit(3);

      if (!scenarios || scenarios.length === 0) {
        return {
          currentScenario: 'mixed_conditions',
          historicalSuccessRate: 50,
          optimalConfidence: 75,
          keySignals: [],
          warnings: []
        };
      }

      const bestScenario = scenarios[0];

      return {
        currentScenario: bestScenario.scenario_name,
        historicalSuccessRate: bestScenario.win_rate,
        optimalConfidence: bestScenario.optimal_confidence_threshold || 75,
        keySignals: bestScenario.key_signals_to_watch || [],
        warnings: bestScenario.warning_signs || []
      };
    } catch (error) {
      console.error('[LLM Context Enricher] Error getting scenario advice:', error);
      return {
        currentScenario: 'mixed_conditions',
        historicalSuccessRate: 50,
        optimalConfidence: 75,
        keySignals: [],
        warnings: []
      };
    }
  }

  private async getConfidenceCalibration(
    userId: string,
    symbol: string,
    currentConfidence: number
  ): Promise<any> {
    try {
      const { data: recentTrades } = await supabase
        .from('ai_trade_analysis')
        .select('entry_confidence, outcome')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .order('entry_time', { ascending: false })
        .limit(30);

      if (!recentTrades || recentTrades.length < 10) {
        return {
          recommendedThreshold: 75,
          reasoning: 'Insufficient data for calibration. Using default threshold.',
          recentAccuracy: 50
        };
      }

      const confidenceBuckets = this.analyzeConfidenceBuckets(recentTrades);
      const currentBucket = this.getConfidenceBucket(currentConfidence);
      const bucketPerformance = confidenceBuckets[currentBucket];

      let recommendedThreshold = 75;
      let reasoning = '';

      if (bucketPerformance && bucketPerformance.winRate >= 65) {
        recommendedThreshold = Math.max(70, currentConfidence - 5);
        reasoning = `Your ${currentBucket} confidence trades have ${bucketPerformance.winRate.toFixed(1)}% win rate. You can be more aggressive.`;
      } else if (bucketPerformance && bucketPerformance.winRate < 50) {
        recommendedThreshold = Math.min(85, currentConfidence + 10);
        reasoning = `Your ${currentBucket} confidence trades have ${bucketPerformance.winRate.toFixed(1)}% win rate. Increase threshold for better results.`;
      } else {
        reasoning = `Your ${currentBucket} confidence trades have moderate performance. Current threshold is appropriate.`;
      }

      const overallAccuracy = (recentTrades.filter(t => t.outcome === 'win').length / recentTrades.length) * 100;

      return {
        recommendedThreshold,
        reasoning,
        recentAccuracy: overallAccuracy
      };
    } catch (error) {
      console.error('[LLM Context Enricher] Error in confidence calibration:', error);
      return {
        recommendedThreshold: 75,
        reasoning: 'Error during calibration. Using default threshold.',
        recentAccuracy: 50
      };
    }
  }

  private generateStrategicGuidance(
    historical: any,
    insights: any[],
    scenario: any,
    calibration: any
  ): string[] {
    const guidance: string[] = [];

    if (historical.recentWinRate >= 65) {
      guidance.push(`Strong recent performance on ${historical.symbol} (${historical.recentWinRate.toFixed(1)}% WR). Trust your analysis.`);
    } else if (historical.recentWinRate < 50) {
      guidance.push(`Recent struggles on ${historical.symbol} (${historical.recentWinRate.toFixed(1)}% WR). Exercise caution.`);
    }

    if (historical.recentProfitFactor >= 1.5) {
      guidance.push(`Excellent profit factor (${historical.recentProfitFactor.toFixed(2)}). Your winners significantly outweigh losses.`);
    } else if (historical.recentProfitFactor < 1.0) {
      guidance.push(`Profit factor below 1.0 (${historical.recentProfitFactor.toFixed(2)}). Review risk management.`);
    }

    if (insights.length > 0) {
      guidance.push(`${insights.length} LLM-discovered patterns available. Review before trading.`);
    }

    if (scenario.historicalSuccessRate >= 60) {
      guidance.push(`Current market scenario has ${scenario.historicalSuccessRate.toFixed(1)}% historical success. Favorable conditions.`);
    }

    if (calibration.recentAccuracy >= 65) {
      guidance.push(`Recent confidence calibration is strong (${calibration.recentAccuracy.toFixed(1)}% accurate).`);
    } else if (calibration.recentAccuracy < 50) {
      guidance.push(`Recent confidence calibration needs improvement (${calibration.recentAccuracy.toFixed(1)}% accurate).`);
    }

    if (historical.bestSetupType !== 'Unknown') {
      guidance.push(`Best performing setup: ${historical.bestSetupType}. Prioritize similar patterns.`);
    }

    if (guidance.length === 0) {
      guidance.push('Proceed with standard risk management and disciplined execution.');
    }

    return guidance;
  }

  private analyzeSetupPerformance(trades: any[]): { best: string; worst: string } {
    const setupStats: Record<string, { wins: number; total: number }> = {};

    for (const trade of trades) {
      const setup = trade.setup_type || 'Unknown';
      if (!setupStats[setup]) {
        setupStats[setup] = { wins: 0, total: 0 };
      }
      setupStats[setup].total++;
      if (trade.outcome === 'win') {
        setupStats[setup].wins++;
      }
    }

    let bestSetup = 'Unknown';
    let worstSetup = 'Unknown';
    let bestWinRate = 0;
    let worstWinRate = 100;

    for (const [setup, stats] of Object.entries(setupStats)) {
      if (stats.total < 3) continue;
      const winRate = (stats.wins / stats.total) * 100;
      if (winRate > bestWinRate) {
        bestWinRate = winRate;
        bestSetup = setup;
      }
      if (winRate < worstWinRate) {
        worstWinRate = winRate;
        worstSetup = setup;
      }
    }

    return { best: bestSetup, worst: worstSetup };
  }

  private analyzeConfidenceBuckets(trades: any[]): Record<string, { winRate: number; count: number }> {
    const buckets: Record<string, { wins: number; total: number }> = {
      'low': { wins: 0, total: 0 },
      'medium': { wins: 0, total: 0 },
      'high': { wins: 0, total: 0 },
      'very_high': { wins: 0, total: 0 }
    };

    for (const trade of trades) {
      const conf = trade.entry_confidence;
      const bucket = this.getConfidenceBucket(conf);
      buckets[bucket].total++;
      if (trade.outcome === 'win') {
        buckets[bucket].wins++;
      }
    }

    const result: Record<string, { winRate: number; count: number }> = {};
    for (const [bucket, stats] of Object.entries(buckets)) {
      result[bucket] = {
        winRate: stats.total > 0 ? (stats.wins / stats.total) * 100 : 0,
        count: stats.total
      };
    }

    return result;
  }

  private getConfidenceBucket(confidence: number): string {
    if (confidence >= 85) return 'very_high';
    if (confidence >= 75) return 'high';
    if (confidence >= 65) return 'medium';
    return 'low';
  }

  private getDefaultContext(symbol: string, confidence: number): EnrichedContext {
    return {
      historicalPerformance: {
        symbol,
        recentWinRate: 50,
        recentProfitFactor: 1.0,
        tradesAnalyzed: 0,
        bestSetupType: 'Unknown',
        worstSetupType: 'Unknown'
      },
      llmInsights: [],
      marketScenarioAdvice: {
        currentScenario: 'mixed_conditions',
        historicalSuccessRate: 50,
        optimalConfidence: 75,
        keySignals: [],
        warnings: []
      },
      confidenceCalibration: {
        recommendedThreshold: 75,
        reasoning: 'Default threshold - no historical data available',
        recentAccuracy: 50
      },
      strategicGuidance: ['Proceed with standard risk management and disciplined execution.']
    };
  }
}

export const llmContextEnricher = new LLMContextEnricher();
export type { EnrichedContext };
