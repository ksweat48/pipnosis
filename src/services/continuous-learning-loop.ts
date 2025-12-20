import { supabase } from '../lib/supabase';
import { llmPostSessionAnalyzer } from './llm-post-session-analyzer';

interface InsightValidationResult {
  insightId: string;
  validated: boolean;
  actualOutcome: 'win' | 'loss' | 'breakeven';
  expectedOutcome: 'win' | 'loss';
  confidenceAdjustment: number;
  shouldKeep: boolean;
  reasoning: string;
}

class ContinuousLearningLoop {
  private validationIntervalMs = 60000; // 1 minute
  private isRunning = false;
  private validationTimer: any = null;

  async start(userId: string): Promise<void> {
    if (this.isRunning) {
      console.log('[Continuous Learning Loop] Already running');
      return;
    }

    console.log('[Continuous Learning Loop] 🔄 Starting continuous validation...');
    this.isRunning = true;

    this.validationTimer = setInterval(async () => {
      await this.runValidationCycle(userId);
    }, this.validationIntervalMs);

    await this.runValidationCycle(userId);
  }

  stop(): void {
    if (this.validationTimer) {
      clearInterval(this.validationTimer);
      this.validationTimer = null;
    }
    this.isRunning = false;
    console.log('[Continuous Learning Loop] ⏸️  Stopped');
  }

  private async runValidationCycle(userId: string): Promise<void> {
    try {
      const recentTrades = await this.getRecentCompletedTrades(userId);

      if (recentTrades.length === 0) {
        return;
      }

      console.log(`[Continuous Learning Loop] Validating ${recentTrades.length} recent trades`);

      for (const trade of recentTrades) {
        await this.validateInsightsAgainstTrade(userId, trade);
      }

      await this.adjustThresholdsBasedOnValidation(userId);
      await this.pruneIneffectiveInsights(userId);

    } catch (error) {
      console.error('[Continuous Learning Loop] Error in validation cycle:', error);
    }
  }

  private async getRecentCompletedTrades(userId: string): Promise<any[]> {
    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60000).toISOString();

      const { data: trades, error } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'closed')
        .gte('closed_at', fiveMinutesAgo)
        .is('ai_validated', false)
        .limit(10);

      if (error) {
        console.error('[Continuous Learning Loop] Error fetching trades:', error);
        return [];
      }

      return trades || [];
    } catch (error) {
      console.error('[Continuous Learning Loop] Error in getRecentCompletedTrades:', error);
      return [];
    }
  }

  private async validateInsightsAgainstTrade(userId: string, trade: any): Promise<void> {
    try {
      const insights = await this.getApplicableInsights(userId, trade.symbol);

      for (const insight of insights) {
        const validation = this.evaluateInsightPerformance(insight, trade);
        await this.updateInsightValidation(insight.id, validation);
      }

      await supabase
        .from('goal_session_trades')
        .update({ ai_validated: true })
        .eq('id', trade.id);

    } catch (error) {
      console.error('[Continuous Learning Loop] Error validating insights:', error);
    }
  }

  private async getApplicableInsights(userId: string, symbol: string): Promise<any[]> {
    try {
      const { data: insights, error } = await supabase
        .from('ai_learning_insights')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .gte('confidence_score', 60)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        console.error('[Continuous Learning Loop] Error fetching insights:', error);
        return [];
      }

      return insights || [];
    } catch (error) {
      console.error('[Continuous Learning Loop] Error in getApplicableInsights:', error);
      return [];
    }
  }

  private evaluateInsightPerformance(insight: any, trade: any): InsightValidationResult {
    const tradeWon = parseFloat(trade.profit_loss) > 0;
    const expectedWin = insight.insight_type === 'winning_pattern';
    const validated = tradeWon === expectedWin;

    let confidenceAdjustment = 0;
    if (validated) {
      confidenceAdjustment = 2;
    } else {
      confidenceAdjustment = -5;
    }

    const shouldKeep = insight.confidence_score + confidenceAdjustment >= 50;

    return {
      insightId: insight.id,
      validated,
      actualOutcome: tradeWon ? 'win' : 'loss',
      expectedOutcome: expectedWin ? 'win' : 'loss',
      confidenceAdjustment,
      shouldKeep,
      reasoning: validated
        ? 'Insight prediction matched actual outcome'
        : 'Insight prediction did not match actual outcome'
    };
  }

  private async updateInsightValidation(insightId: string, validation: InsightValidationResult): Promise<void> {
    try {
      const { data: existing } = await supabase
        .from('ai_learning_insights')
        .select('confidence_score, times_applied, success_rate_when_applied')
        .eq('id', insightId)
        .single();

      if (!existing) return;

      const newTimesApplied = existing.times_applied + 1;
      const oldSuccessTotal = (existing.success_rate_when_applied || 0) * existing.times_applied;
      const newSuccessTotal = oldSuccessTotal + (validation.validated ? 100 : 0);
      const newSuccessRate = newSuccessTotal / newTimesApplied;

      const newConfidence = Math.max(0, Math.min(100,
        existing.confidence_score + validation.confidenceAdjustment
      ));

      await supabase
        .from('ai_learning_insights')
        .update({
          confidence_score: newConfidence,
          times_applied: newTimesApplied,
          success_rate_when_applied: newSuccessRate,
          updated_at: new Date().toISOString()
        })
        .eq('id', insightId);

    } catch (error) {
      console.error('[Continuous Learning Loop] Error updating insight validation:', error);
    }
  }

  private async adjustThresholdsBasedOnValidation(userId: string): Promise<void> {
    try {
      const { data: recentPerformance } = await supabase
        .from('ai_trade_analysis')
        .select('entry_confidence, outcome')
        .eq('user_id', userId)
        .order('entry_time', { ascending: false })
        .limit(50);

      if (!recentPerformance || recentPerformance.length < 20) {
        return;
      }

      const confidenceBuckets = this.analyzeConfidenceBuckets(recentPerformance);

      const optimalThreshold = this.calculateOptimalThreshold(confidenceBuckets);

      await supabase
        .from('user_trading_preferences')
        .upsert({
          user_id: userId,
          min_confidence_threshold: optimalThreshold,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        });

      console.log(`[Continuous Learning Loop] Adjusted confidence threshold to ${optimalThreshold}%`);

    } catch (error) {
      console.error('[Continuous Learning Loop] Error adjusting thresholds:', error);
    }
  }

  private analyzeConfidenceBuckets(trades: any[]): Record<number, { wins: number; total: number }> {
    const buckets: Record<number, { wins: number; total: number }> = {};

    for (let threshold = 60; threshold <= 90; threshold += 5) {
      buckets[threshold] = { wins: 0, total: 0 };
    }

    for (const trade of trades) {
      const conf = trade.entry_confidence;
      for (let threshold = 60; threshold <= 90; threshold += 5) {
        if (conf >= threshold) {
          buckets[threshold].total++;
          if (trade.outcome === 'win') {
            buckets[threshold].wins++;
          }
        }
      }
    }

    return buckets;
  }

  private calculateOptimalThreshold(buckets: Record<number, { wins: number; total: number }>): number {
    let optimalThreshold = 75;
    let bestScore = 0;

    for (const [threshold, stats] of Object.entries(buckets)) {
      if (stats.total < 10) continue;

      const winRate = (stats.wins / stats.total) * 100;
      const score = winRate * Math.log(stats.total + 1);

      if (score > bestScore && winRate >= 60) {
        bestScore = score;
        optimalThreshold = parseInt(threshold);
      }
    }

    return optimalThreshold;
  }

  private async pruneIneffectiveInsights(userId: string): Promise<void> {
    try {
      const { data: lowPerformingInsights } = await supabase
        .from('ai_learning_insights')
        .select('id')
        .eq('user_id', userId)
        .gte('times_applied', 10)
        .lte('success_rate_when_applied', 40);

      if (!lowPerformingInsights || lowPerformingInsights.length === 0) {
        return;
      }

      const insightIds = lowPerformingInsights.map(i => i.id);

      await supabase
        .from('ai_learning_insights')
        .update({
          confidence_score: 0,
          updated_at: new Date().toISOString()
        })
        .in('id', insightIds);

      console.log(`[Continuous Learning Loop] Pruned ${insightIds.length} ineffective insights`);

    } catch (error) {
      console.error('[Continuous Learning Loop] Error pruning insights:', error);
    }
  }

  async validateInsightInRealtime(
    userId: string,
    insightId: string,
    tradeId: string
  ): Promise<InsightValidationResult | null> {
    try {
      const { data: insight } = await supabase
        .from('ai_learning_insights')
        .select('*')
        .eq('id', insightId)
        .single();

      const { data: trade } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('id', tradeId)
        .single();

      if (!insight || !trade) {
        return null;
      }

      const validation = this.evaluateInsightPerformance(insight, trade);
      await this.updateInsightValidation(insightId, validation);

      return validation;
    } catch (error) {
      console.error('[Continuous Learning Loop] Error in real-time validation:', error);
      return null;
    }
  }

  isActive(): boolean {
    return this.isRunning;
  }

  getStats(): { isRunning: boolean; validationInterval: number } {
    return {
      isRunning: this.isRunning,
      validationInterval: this.validationIntervalMs
    };
  }
}

export const continuousLearningLoop = new ContinuousLearningLoop();
export type { InsightValidationResult };
