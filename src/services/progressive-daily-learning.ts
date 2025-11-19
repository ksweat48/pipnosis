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

interface WeeklyMetaAnalysis {
  weekStart: string;
  weekEnd: string;
  overallWinRate: number;
  overallProfitFactor: number;
  bestDays: string[];
  worstDays: string[];
  strategicRecommendations: string[];
  patternsToEmphasize: string[];
  patternsToAvoid: string[];
  confidenceCalibration: { current: number; recommended: number };
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

  async generateWeeklyMetaAnalysis(userId: string): Promise<WeeklyMetaAnalysis | null> {
    console.log('[Progressive Daily Learning] 📈 Generating weekly meta-analysis');

    try {
      const weekData = await this.getWeeklyData(userId);

      if (weekData.dailyAggregations.length === 0) {
        console.log('[Progressive Daily Learning] Insufficient data for weekly analysis');
        return null;
      }

      const metaAnalysis = await this.buildWeeklyMetaAnalysis(userId, weekData);

      await this.storeWeeklyMetaAnalysis(userId, metaAnalysis);

      console.log('[Progressive Daily Learning] ✅ Weekly meta-analysis complete');
      console.log(`  Overall Win Rate: ${metaAnalysis.overallWinRate.toFixed(1)}%`);
      console.log(`  Best Days: ${metaAnalysis.bestDays.length}`);
      console.log(`  Strategic Recommendations: ${metaAnalysis.strategicRecommendations.length}`);

      return metaAnalysis;
    } catch (error) {
      console.error('[Progressive Daily Learning] Error in weekly meta-analysis:', error);
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

    const { data: analyses, error } = await supabase
      .from('llm_session_analysis')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', startOfDay.toISOString())
      .lte('created_at', endOfDay.toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Progressive Daily Learning] Error fetching LLM analyses:', error);
      return [];
    }

    return analyses || [];
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

  private async getWeeklyData(userId: string): Promise<any> {
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    const { data: dailyAggregations } = await supabase
      .from('daily_learning_aggregations')
      .select('*')
      .eq('user_id', userId)
      .gte('date', weekAgo.toISOString().split('T')[0])
      .order('date', { ascending: true });

    const { data: weeklyTrades } = await supabase
      .from('trade_history')
      .select('*')
      .eq('user_id', userId)
      .gte('closed_at', weekAgo.toISOString())
      .order('closed_at', { ascending: true });

    return {
      dailyAggregations: dailyAggregations || [],
      weeklyTrades: weeklyTrades || []
    };
  }

  private async buildWeeklyMetaAnalysis(userId: string, weekData: any): Promise<WeeklyMetaAnalysis> {
    const { dailyAggregations, weeklyTrades } = weekData;

    const weekStart = dailyAggregations[0]?.date || new Date().toISOString().split('T')[0];
    const weekEnd = dailyAggregations[dailyAggregations.length - 1]?.date || new Date().toISOString().split('T')[0];

    const allWins = weeklyTrades.filter((t: any) => parseFloat(t.profit_loss) > 0);
    const overallWinRate = weeklyTrades.length > 0 ? (allWins.length / weeklyTrades.length) * 100 : 0;

    const totalWins = allWins.reduce((sum: number, t: any) => sum + parseFloat(t.profit_loss), 0);
    const totalLosses = Math.abs(
      weeklyTrades
        .filter((t: any) => parseFloat(t.profit_loss) < 0)
        .reduce((sum: number, t: any) => sum + parseFloat(t.profit_loss), 0)
    );
    const overallProfitFactor = totalLosses > 0 ? totalWins / totalLosses : 0;

    const sortedByWinRate = [...dailyAggregations].sort((a, b) => b.win_rate - a.win_rate);
    const bestDays = sortedByWinRate.slice(0, 2).map(d => d.date);
    const worstDays = sortedByWinRate.slice(-2).map(d => d.date);

    const allRecommendations = dailyAggregations.flatMap((d: any) => d.recommended_adjustments || []);
    const strategicRecommendations = [...new Set(allRecommendations)].slice(0, 5);

    const patternFrequency: Record<string, number> = {};
    for (const day of dailyAggregations) {
      for (const pattern of day.top_patterns || []) {
        patternFrequency[pattern.name] = (patternFrequency[pattern.name] || 0) + 1;
      }
    }

    const patternsToEmphasize = Object.entries(patternFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => name);

    const avgWinRate = dailyAggregations.reduce((sum: number, d: any) => sum + d.win_rate, 0) / dailyAggregations.length;
    const currentThreshold = 75;
    const recommendedThreshold = avgWinRate >= 70 ? 70 : avgWinRate >= 60 ? 75 : 80;

    return {
      weekStart,
      weekEnd,
      overallWinRate,
      overallProfitFactor,
      bestDays,
      worstDays,
      strategicRecommendations,
      patternsToEmphasize,
      patternsToAvoid: [],
      confidenceCalibration: {
        current: currentThreshold,
        recommended: recommendedThreshold
      }
    };
  }

  private async storeWeeklyMetaAnalysis(userId: string, analysis: WeeklyMetaAnalysis): Promise<void> {
    try {
      await supabase
        .from('weekly_meta_analyses')
        .insert({
          user_id: userId,
          week_start: analysis.weekStart,
          week_end: analysis.weekEnd,
          overall_win_rate: analysis.overallWinRate,
          overall_profit_factor: analysis.overallProfitFactor,
          best_days: analysis.bestDays,
          worst_days: analysis.worstDays,
          strategic_recommendations: analysis.strategicRecommendations,
          patterns_to_emphasize: analysis.patternsToEmphasize,
          patterns_to_avoid: analysis.patternsToAvoid,
          confidence_calibration: analysis.confidenceCalibration,
          created_at: new Date().toISOString()
        });
    } catch (error) {
      console.error('[Progressive Daily Learning] Error storing weekly meta-analysis:', error);
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

  async getRecentWeeklyAnalyses(userId: string, limit: number = 4): Promise<WeeklyMetaAnalysis[]> {
    const { data, error } = await supabase
      .from('weekly_meta_analyses')
      .select('*')
      .eq('user_id', userId)
      .order('week_end', { ascending: false })
      .limit(limit);

    if (error || !data) {
      return [];
    }

    return data.map(d => ({
      weekStart: d.week_start,
      weekEnd: d.week_end,
      overallWinRate: d.overall_win_rate,
      overallProfitFactor: d.overall_profit_factor,
      bestDays: d.best_days,
      worstDays: d.worst_days,
      strategicRecommendations: d.strategic_recommendations,
      patternsToEmphasize: d.patterns_to_emphasize,
      patternsToAvoid: d.patterns_to_avoid,
      confidenceCalibration: d.confidence_calibration
    }));
  }
}

export const progressiveDailyLearning = new ProgressiveDailyLearning();
export type { DailyLearningAggregation, WeeklyMetaAnalysis };
