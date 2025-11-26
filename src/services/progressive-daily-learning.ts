import { supabase } from '../lib/supabase';
import { llmPostSessionAnalyzer } from './llm-post-session-analyzer';

interface DailyLearningAggregation {
  date: string;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  topPatterns: Array<{ name: string; winRate: number; confidence: number }>;
  keyInsights: string[];
  recommendedAdjustments: string[];
  estimatedImprovementPotential: string;
}

interface DailyMetaAnalysis {
  date: string;
  todayWinRate: number;
  yesterdayWinRate: number | null;
  winRateDelta: number | null;
  performanceTrend: 'improving' | 'declining' | 'stable';
  todayProfitFactor: number;
  yesterdayProfitFactor: number | null;
  profitFactorDelta: number | null;
  todayTotalTrades: number;
  yesterdayTotalTrades: number | null;
  strategicRecommendations: string[];
  patternsToEmphasize: string[];
  patternsToAvoid: string[];
  confidenceCalibration: {
    currentAccuracy: number;
    recommendedThreshold: number;
    adjustmentReasoning: string;
    overconfidentSessions: number;
    underconfidentSessions: number;
  };
  recommendedPairs: Array<{ symbol: string; confidence: number; reasoning: string }>;
  pairsToAvoid: string[];
  keyDiscoveries: string[];
  improvementFocus: string[];
  estimatedImprovementPotential: string;
}

class ProgressiveDailyLearning {
  async aggregateDailyLearnings(userId: string, date?: Date): Promise<DailyLearningAggregation | null> {
    const targetDate = date || new Date();
    const dateStr = targetDate.toISOString().split('T')[0];

    console.log(`[Progressive Daily Learning] 📊 Aggregating learnings for ${dateStr}`);

    try {
      const trades = await this.getDailyTrades(userId, targetDate);

      if (trades.length === 0) {
        console.log('[Progressive Daily Learning] No trades for this date');
        return null;
      }

      const insights = await this.getDailyInsights(userId, targetDate);
      const llmAnalyses = await this.getDailyLLMAnalyses(userId, targetDate);

      const aggregation = this.buildDailyAggregation(
        dateStr,
        trades,
        insights,
        llmAnalyses
      );

      await this.storeDailyAggregation(userId, aggregation);

      console.log(`[Progressive Daily Learning] ✅ Daily aggregation complete`);
      console.log(`  Trades: ${aggregation.totalTrades}`);
      console.log(`  Win Rate: ${aggregation.winRate.toFixed(1)}%`);
      console.log(`  Top Patterns: ${aggregation.topPatterns.length}`);

      return aggregation;
    } catch (error) {
      console.error('[Progressive Daily Learning] Error in daily aggregation:', error);
      return null;
    }
  }

  async processDailySession(userId: string, todaySession: any): Promise<void> {
    console.log('[Progressive Daily Learning] 📊 Processing daily session...');

    try {
      const today = new Date(todaySession.date || todaySession.created_at);
      const aggregation = await this.aggregateDailyLearnings(userId, today);

      if (aggregation) {
        const metaAnalysis = await this.generateDailyMetaAnalysis(userId, today);
        console.log('[Progressive Daily Learning] ✅ Daily session processed');
      }
    } catch (error) {
      console.error('[Progressive Daily Learning] Error processing daily session:', error);
    }
  }

  async generateDailyMetaAnalysis(userId: string, date?: Date): Promise<DailyMetaAnalysis | null> {
    const today = date || new Date();
    const dateStr = today.toISOString().split('T')[0];

    console.log(`[Progressive Daily Learning] 🧠 Generating daily meta-analysis for ${dateStr}`);

    try {
      const todayAgg = await this.getDailyAggregation(userId, today);
      if (!todayAgg) {
        console.log('[Progressive Daily Learning] No aggregation found for today');
        return null;
      }

      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayAgg = await this.getDailyAggregation(userId, yesterday);

      const metaAnalysis = await this.buildDailyMetaAnalysis(userId, todayAgg, yesterdayAgg);

      await this.storeDailyMetaAnalysis(userId, metaAnalysis);

      console.log('[Progressive Daily Learning] ✅ Daily meta-analysis complete');
      console.log(`  Performance Trend: ${metaAnalysis.performanceTrend}`);
      console.log(`  Win Rate: ${metaAnalysis.todayWinRate.toFixed(1)}% (${metaAnalysis.winRateDelta ? (metaAnalysis.winRateDelta > 0 ? '+' : '') + metaAnalysis.winRateDelta.toFixed(1) : 'N/A'}%)`);
      console.log(`  Strategic Recommendations: ${metaAnalysis.strategicRecommendations.length}`);

      return metaAnalysis;
    } catch (error) {
      console.error('[Progressive Daily Learning] Error in daily meta-analysis:', error);
      return null;
    }
  }

  private async getDailyTrades(userId: string, date: Date): Promise<any[]> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const { data: trades, error } = await supabase
      .from('trade_history')
      .select('*')
      .eq('user_id', userId)
      .gte('closed_at', startOfDay.toISOString())
      .lte('closed_at', endOfDay.toISOString())
      .order('closed_at', { ascending: true });

    if (error) {
      console.error('[Progressive Daily Learning] Error fetching daily trades:', error);
      return [];
    }

    return trades || [];
  }

  private async getDailyInsights(userId: string, date: Date): Promise<any[]> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const { data: insights, error } = await supabase
      .from('ai_learning_insights')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', startOfDay.toISOString())
      .lte('created_at', endOfDay.toISOString())
      .order('confidence_score', { ascending: false });

    if (error) {
      console.error('[Progressive Daily Learning] Error fetching insights:', error);
      return [];
    }

    return insights || [];
  }

  private async getDailyLLMAnalyses(userId: string, date: Date): Promise<any[]> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const { data: sessions, error } = await supabase
      .from('daily_session_results')
      .select('session_id, llm_deep_analysis, created_at')
      .eq('user_id', userId)
      .gte('created_at', startOfDay.toISOString())
      .lte('created_at', endOfDay.toISOString())
      .not('llm_deep_analysis', 'is', null)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Progressive Daily Learning] Error fetching LLM analyses:', error);
      return [];
    }

    // Transform to legacy format for compatibility
    return (sessions || []).map(s => ({
      ...s.llm_deep_analysis,
      session_id: s.session_id,
      created_at: s.created_at
    }));
  }

  private buildDailyAggregation(
    date: string,
    trades: any[],
    insights: any[],
    llmAnalyses: any[]
  ): DailyLearningAggregation {
    const wins = trades.filter(t => parseFloat(t.profit_loss) > 0);
    const losses = trades.filter(t => parseFloat(t.profit_loss) < 0);
    const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;

    const totalWins = wins.reduce((sum, t) => sum + parseFloat(t.profit_loss), 0);
    const totalLosses = Math.abs(losses.reduce((sum, t) => sum + parseFloat(t.profit_loss), 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 0;

    const topPatterns = insights
      .filter(i => i.insight_type === 'winning_pattern')
      .slice(0, 5)
      .map(i => ({
        name: i.insight_title,
        winRate: i.win_rate,
        confidence: i.confidence_score
      }));

    const keyInsights: string[] = [];
    const recommendedAdjustments: string[] = [];

    if (winRate >= 70) {
      keyInsights.push(`Excellent day with ${winRate.toFixed(1)}% win rate`);
      recommendedAdjustments.push('Maintain current approach and increase position size slightly');
    } else if (winRate < 50) {
      keyInsights.push(`Challenging day with ${winRate.toFixed(1)}% win rate`);
      recommendedAdjustments.push('Review losing trades and reduce position size until performance improves');
    }

    if (profitFactor >= 2.0) {
      keyInsights.push(`Strong profit factor of ${profitFactor.toFixed(2)}`);
    } else if (profitFactor < 1.0) {
      keyInsights.push(`Profit factor below 1.0 (${profitFactor.toFixed(2)}) - losses exceeded wins`);
      recommendedAdjustments.push('Focus on capital preservation and higher quality setups');
    }

    if (llmAnalyses.length > 0) {
      const latestAnalysis = llmAnalyses[0];
      keyInsights.push(...latestAnalysis.strengths_identified.slice(0, 2));
      recommendedAdjustments.push(...latestAnalysis.strategic_recommendations.slice(0, 2));
    }

    const estimatedImprovementPotential = this.calculateImprovementPotential(winRate, profitFactor);

    return {
      date,
      totalTrades: trades.length,
      winRate,
      profitFactor,
      topPatterns,
      keyInsights,
      recommendedAdjustments,
      estimatedImprovementPotential
    };
  }

  private calculateImprovementPotential(winRate: number, profitFactor: number): string {
    if (winRate >= 75 && profitFactor >= 2.0) {
      return 'Minimal - Already performing at elite level';
    } else if (winRate >= 65 && profitFactor >= 1.5) {
      return 'Moderate - 3-5% win rate improvement possible';
    } else if (winRate >= 55) {
      return 'Significant - 5-10% win rate improvement possible';
    } else {
      return 'High - 10-15% win rate improvement possible with adjustments';
    }
  }

  private async storeDailyAggregation(userId: string, aggregation: DailyLearningAggregation): Promise<void> {
    try {
      await supabase
        .from('daily_learning_aggregations')
        .upsert({
          user_id: userId,
          date: aggregation.date,
          total_trades: aggregation.totalTrades,
          win_rate: aggregation.winRate,
          profit_factor: aggregation.profitFactor,
          top_patterns: aggregation.topPatterns,
          key_insights: aggregation.keyInsights,
          recommended_adjustments: aggregation.recommendedAdjustments,
          estimated_improvement_potential: aggregation.estimatedImprovementPotential,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,date'
        });
    } catch (error) {
      console.error('[Progressive Daily Learning] Error storing daily aggregation:', error);
    }
  }

  private async buildDailyMetaAnalysis(
    userId: string,
    todayAgg: DailyLearningAggregation,
    yesterdayAgg: DailyLearningAggregation | null
  ): Promise<DailyMetaAnalysis> {
    const winRateDelta = yesterdayAgg ? todayAgg.winRate - yesterdayAgg.winRate : null;
    const profitFactorDelta = yesterdayAgg ? todayAgg.profitFactor - yesterdayAgg.profitFactor : null;

    let performanceTrend: 'improving' | 'declining' | 'stable' = 'stable';
    if (winRateDelta !== null) {
      if (winRateDelta > 3) performanceTrend = 'improving';
      else if (winRateDelta < -3) performanceTrend = 'declining';
    }

    const strategicRecommendations: string[] = [];
    const patternsToEmphasize: string[] = [];
    const patternsToAvoid: string[] = [];
    const keyDiscoveries: string[] = [];
    const improvementFocus: string[] = [];

    if (performanceTrend === 'improving') {
      strategicRecommendations.push(`Continue current approach - ${winRateDelta?.toFixed(1)}% win rate improvement`);
      keyDiscoveries.push('Positive momentum detected - maintain strategy');
    } else if (performanceTrend === 'declining') {
      strategicRecommendations.push(`Review and adjust - ${Math.abs(winRateDelta || 0).toFixed(1)}% win rate decline`);
      improvementFocus.push('Analyze losing patterns from today');
      improvementFocus.push('Return to yesterday\'s successful approach');
    }

    if (todayAgg.winRate >= 70) {
      strategicRecommendations.push('Strong performance - consider slight position size increase');
      patternsToEmphasize.push(...todayAgg.topPatterns.slice(0, 3).map(p => p.name));
    } else if (todayAgg.winRate < 50) {
      strategicRecommendations.push('Reduce position size until performance improves');
      improvementFocus.push('Focus on quality over quantity');
    }

    if (todayAgg.profitFactor >= 2.0) {
      keyDiscoveries.push(`Excellent profit factor of ${todayAgg.profitFactor.toFixed(2)}`);
    } else if (todayAgg.profitFactor < 1.0) {
      strategicRecommendations.push('Tighten stop losses and improve R:R ratio');
      improvementFocus.push('Capital preservation is priority');
    }

    const recommendedPairs = this.generatePairRecommendations(todayAgg, yesterdayAgg);
    const pairsToAvoid = this.identifyPairsToAvoid(userId, todayAgg);

    const confidenceCalibration = await this.calculateConfidenceCalibration(userId);

    return {
      date: todayAgg.date,
      todayWinRate: todayAgg.winRate,
      yesterdayWinRate: yesterdayAgg?.winRate || null,
      winRateDelta,
      performanceTrend,
      todayProfitFactor: todayAgg.profitFactor,
      yesterdayProfitFactor: yesterdayAgg?.profitFactor || null,
      profitFactorDelta,
      todayTotalTrades: todayAgg.totalTrades,
      yesterdayTotalTrades: yesterdayAgg?.totalTrades || null,
      strategicRecommendations,
      patternsToEmphasize,
      patternsToAvoid,
      confidenceCalibration,
      recommendedPairs,
      pairsToAvoid,
      keyDiscoveries,
      improvementFocus,
      estimatedImprovementPotential: todayAgg.estimatedImprovementPotential
    };
  }

  private generatePairRecommendations(
    todayAgg: DailyLearningAggregation,
    yesterdayAgg: DailyLearningAggregation | null
  ): Array<{ symbol: string; confidence: number; reasoning: string }> {
    const recommendations: Array<{ symbol: string; confidence: number; reasoning: string }> = [];

    const availablePairs = ['EURUSD', 'XAUUSD', 'GBPUSD', 'USDJPY'];

    for (const pair of availablePairs) {
      const pairPatterns = todayAgg.topPatterns.filter(p =>
        p.name.toLowerCase().includes(pair.toLowerCase().substring(0, 3))
      );

      if (pairPatterns.length > 0 && pairPatterns[0].winRate >= 65) {
        recommendations.push({
          symbol: pair,
          confidence: pairPatterns[0].confidence,
          reasoning: `Strong ${pairPatterns[0].winRate.toFixed(1)}% win rate with ${pairPatterns[0].name}`
        });
      }
    }

    recommendations.sort((a, b) => b.confidence - a.confidence);
    return recommendations.slice(0, 3);
  }

  private identifyPairsToAvoid(userId: string, todayAgg: DailyLearningAggregation): string[] {
    const pairsToAvoid: string[] = [];

    const poorPatterns = todayAgg.topPatterns.filter(p => p.winRate < 45);
    for (const pattern of poorPatterns) {
      const pairMatch = pattern.name.match(/(EURUSD|XAUUSD|GBPUSD|USDJPY)/i);
      if (pairMatch && !pairsToAvoid.includes(pairMatch[0])) {
        pairsToAvoid.push(pairMatch[0]);
      }
    }

    return pairsToAvoid;
  }

  private async calculateConfidenceCalibration(userId: string): Promise<{
    currentAccuracy: number;
    recommendedThreshold: number;
    adjustmentReasoning: string;
    overconfidentSessions: number;
    underconfidentSessions: number;
  }> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: recentTrades } = await supabase
      .from('synthetic_backtest_trades')
      .select('confidence, outcome')
      .gte('entry_time', thirtyDaysAgo.toISOString())
      .order('entry_time', { ascending: false })
      .limit(100);

    if (!recentTrades || recentTrades.length === 0) {
      return {
        currentAccuracy: 70,
        recommendedThreshold: 75,
        adjustmentReasoning: 'Insufficient data for calibration',
        overconfidentSessions: 0,
        underconfidentSessions: 0
      };
    }

    const highConfTrades = recentTrades.filter(t => (t.confidence || 0) >= 75);
    const highConfWins = highConfTrades.filter(t => t.outcome === 'win');
    const currentAccuracy = highConfTrades.length > 0
      ? (highConfWins.length / highConfTrades.length) * 100
      : 70;

    let recommendedThreshold = 75;
    let adjustmentReasoning = 'Calibration optimal';

    if (currentAccuracy >= 75) {
      recommendedThreshold = 70;
      adjustmentReasoning = 'High accuracy - can lower confidence threshold';
    } else if (currentAccuracy < 65) {
      recommendedThreshold = 80;
      adjustmentReasoning = 'Low accuracy - increase confidence threshold';
    }

    return {
      currentAccuracy,
      recommendedThreshold,
      adjustmentReasoning,
      overconfidentSessions: 0,
      underconfidentSessions: 0
    };
  }

  private async storeDailyMetaAnalysis(userId: string, analysis: DailyMetaAnalysis): Promise<void> {
    try {
      await supabase
        .from('daily_meta_analysis')
        .upsert({
          user_id: userId,
          date: analysis.date,
          today_win_rate: analysis.todayWinRate,
          yesterday_win_rate: analysis.yesterdayWinRate,
          win_rate_delta: analysis.winRateDelta,
          performance_trend: analysis.performanceTrend,
          today_profit_factor: analysis.todayProfitFactor,
          yesterday_profit_factor: analysis.yesterdayProfitFactor,
          profit_factor_delta: analysis.profitFactorDelta,
          today_total_trades: analysis.todayTotalTrades,
          yesterday_total_trades: analysis.yesterdayTotalTrades,
          strategic_recommendations: analysis.strategicRecommendations,
          patterns_to_emphasize: analysis.patternsToEmphasize,
          patterns_to_avoid: analysis.patternsToAvoid,
          confidence_calibration: analysis.confidenceCalibration,
          recommended_pairs: analysis.recommendedPairs,
          pairs_to_avoid: analysis.pairsToAvoid,
          key_discoveries: analysis.keyDiscoveries,
          improvement_focus: analysis.improvementFocus,
          estimated_improvement_potential: analysis.estimatedImprovementPotential,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,date'
        });
    } catch (error) {
      console.error('[Progressive Daily Learning] Error storing daily meta-analysis:', error);
    }
  }

  async getDailyAggregation(userId: string, date: Date): Promise<DailyLearningAggregation | null> {
    const dateStr = date.toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('daily_learning_aggregations')
      .select('*')
      .eq('user_id', userId)
      .eq('date', dateStr)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      date: data.date,
      totalTrades: data.total_trades,
      winRate: data.win_rate,
      profitFactor: data.profit_factor,
      topPatterns: data.top_patterns,
      keyInsights: data.key_insights,
      recommendedAdjustments: data.recommended_adjustments,
      estimatedImprovementPotential: data.estimated_improvement_potential
    };
  }

  async getYesterdayMetaAnalysis(userId: string): Promise<DailyMetaAnalysis | null> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('daily_meta_analysis')
      .select('*')
      .eq('user_id', userId)
      .eq('date', dateStr)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return {
      date: data.date,
      todayWinRate: data.today_win_rate,
      yesterdayWinRate: data.yesterday_win_rate,
      winRateDelta: data.win_rate_delta,
      performanceTrend: data.performance_trend,
      todayProfitFactor: data.today_profit_factor,
      yesterdayProfitFactor: data.yesterday_profit_factor,
      profitFactorDelta: data.profit_factor_delta,
      todayTotalTrades: data.today_total_trades,
      yesterdayTotalTrades: data.yesterday_total_trades,
      strategicRecommendations: data.strategic_recommendations,
      patternsToEmphasize: data.patterns_to_emphasize,
      patternsToAvoid: data.patterns_to_avoid,
      confidenceCalibration: data.confidence_calibration,
      recommendedPairs: data.recommended_pairs,
      pairsToAvoid: data.pairs_to_avoid,
      keyDiscoveries: data.key_discoveries,
      improvementFocus: data.improvement_focus,
      estimatedImprovementPotential: data.estimated_improvement_potential
    };
  }

  async getRecentDailyAnalyses(userId: string, limit: number = 7): Promise<DailyMetaAnalysis[]> {
    const { data, error } = await supabase
      .from('daily_meta_analysis')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(limit);

    if (error || !data) {
      return [];
    }

    return data.map(d => ({
      date: d.date,
      todayWinRate: d.today_win_rate,
      yesterdayWinRate: d.yesterday_win_rate,
      winRateDelta: d.win_rate_delta,
      performanceTrend: d.performance_trend,
      todayProfitFactor: d.today_profit_factor,
      yesterdayProfitFactor: d.yesterday_profit_factor,
      profitFactorDelta: d.profit_factor_delta,
      todayTotalTrades: d.today_total_trades,
      yesterdayTotalTrades: d.yesterday_total_trades,
      strategicRecommendations: d.strategic_recommendations,
      patternsToEmphasize: d.patterns_to_emphasize,
      patternsToAvoid: d.patterns_to_avoid,
      confidenceCalibration: d.confidence_calibration,
      recommendedPairs: d.recommended_pairs,
      pairsToAvoid: d.pairs_to_avoid,
      keyDiscoveries: d.key_discoveries,
      improvementFocus: d.improvement_focus,
      estimatedImprovementPotential: d.estimated_improvement_potential
    }));
  }
}

export const progressiveDailyLearning = new ProgressiveDailyLearning();
export type { DailyLearningAggregation, DailyMetaAnalysis };
