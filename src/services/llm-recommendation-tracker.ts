import { supabase } from '../lib/supabase';
import type { LLMTradeDecision, MarketSnapshot } from './llm-strategy-brain';

export interface LLMRecommendationLog {
  sessionId: string;
  userId: string;
  symbol: string;
  recommendationTime: Date;
  marketSnapshot: MarketSnapshot;
  llmDecision: LLMTradeDecision;
  wasExecuted: boolean;
  actualOutcome?: 'win' | 'loss' | 'breakeven' | 'not_executed' | 'would_have_won' | 'would_have_lost';
  actualPnL?: number;
  apiResponseTimeMs?: number;
  usedFallback?: boolean;
}

export interface RecommendationAnalysis {
  totalRecommendations: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  noTradeAccuracy: number;
}

class LLMRecommendationTracker {
  async logRecommendation(log: LLMRecommendationLog): Promise<void> {
    const recommendationType = this.classifyRecommendation(
      log.llmDecision.action,
      log.wasExecuted,
      log.actualOutcome
    );

    const recommendationWasCorrect = this.assessCorrectness(
      log.llmDecision.action,
      log.actualOutcome
    );

    const qualityScore = this.calculateRecommendationQualityScore(
      log.llmDecision,
      log.actualOutcome,
      log.actualPnL
    );

    const insights = this.generateInsights(
      log.llmDecision,
      log.actualOutcome,
      recommendationWasCorrect
    );

    await supabase
      .from('llm_recommendation_logs')
      .insert({
        session_id: log.sessionId,
        user_id: log.userId,
        symbol: log.symbol,
        recommendation_time: log.recommendationTime.toISOString(),
        market_snapshot: log.marketSnapshot as any,
        llm_action: log.llmDecision.action,
        llm_confidence: log.llmDecision.confidence,
        llm_reasoning: log.llmDecision.reasoning,
        llm_risk_assessment: log.llmDecision.riskAssessment,
        llm_setup_type: log.llmDecision.setupType,
        llm_key_factors: log.llmDecision.keyFactors,
        expected_entry_price: log.llmDecision.entryZone?.ideal,
        expected_stop_loss: log.llmDecision.stopLoss,
        expected_take_profit: log.llmDecision.takeProfit,
        expected_duration_minutes: log.llmDecision.expectedDurationMinutes,
        expected_position_size_percent: log.llmDecision.positionSizePercent,
        was_executed: log.wasExecuted,
        actual_outcome: log.actualOutcome || 'not_executed',
        actual_pnl: log.actualPnL || 0,
        recommendation_was_correct: recommendationWasCorrect,
        recommendation_quality_score: qualityScore,
        recommendation_type: recommendationType,
        api_response_time_ms: log.apiResponseTimeMs,
        api_call_succeeded: !log.usedFallback,
        used_fallback: log.usedFallback || false,
        what_went_right: insights.whatWentRight,
        what_went_wrong: insights.whatWentWrong,
        prompt_adjustment_needed: insights.promptAdjustmentNeeded
      });

    console.log(`[LLM Recommendation Tracker] Logged ${recommendationType} recommendation for ${log.symbol}`);
  }

  private classifyRecommendation(
    action: string,
    wasExecuted: boolean,
    outcome?: string
  ): string {
    if (!wasExecuted && action === 'no_trade') {
      return outcome === 'would_have_lost' ? 'true_negative' : 'false_negative';
    }

    if (wasExecuted) {
      return outcome === 'win' ? 'true_positive' : 'false_positive';
    }

    if (action === 'no_trade' && !wasExecuted) {
      return 'true_negative';
    }

    return 'false_negative';
  }

  private assessCorrectness(action: string, outcome?: string): boolean {
    if (action === 'no_trade') {
      return outcome === 'would_have_lost' || outcome === 'not_executed';
    }

    if (action === 'enter_long' || action === 'enter_short') {
      return outcome === 'win';
    }

    return false;
  }

  private calculateRecommendationQualityScore(
    decision: LLMTradeDecision,
    outcome?: string,
    pnl?: number
  ): number {
    let score = 50;

    if (outcome === 'win') {
      score += 30;
      if (pnl && pnl > 0) {
        score += Math.min(20, (pnl / 100) * 10);
      }
    } else if (outcome === 'loss') {
      score -= 30;
    }

    if (decision.reasoning && decision.reasoning.length > 50) {
      score += 10;
    }

    if (decision.riskAssessment && decision.riskAssessment.length > 20) {
      score += 5;
    }

    if (decision.keyFactors && decision.keyFactors.length >= 3) {
      score += 5;
    }

    return Math.max(0, Math.min(100, score));
  }

  private generateInsights(
    decision: LLMTradeDecision,
    outcome?: string,
    wasCorrect?: boolean
  ): any {
    const insights: any = {
      whatWentRight: null,
      whatWentWrong: null,
      promptAdjustmentNeeded: null
    };

    if (wasCorrect && outcome === 'win') {
      insights.whatWentRight = `LLM correctly identified ${decision.setupType} setup. Reasoning was sound: ${decision.reasoning.substring(0, 100)}`;
    }

    if (!wasCorrect && outcome === 'loss') {
      insights.whatWentWrong = `LLM failed to identify risk in ${decision.setupType} setup. Confidence was ${decision.confidence}% but trade lost.`;
      insights.promptAdjustmentNeeded = 'Improve risk assessment for this market condition';
    }

    if (decision.action === 'no_trade' && outcome === 'would_have_won') {
      insights.whatWentWrong = 'LLM was too conservative. Missed profitable opportunity.';
      insights.promptAdjustmentNeeded = 'Consider reducing confidence threshold or adjusting temperature';
    }

    return insights;
  }

  async analyzeSessionRecommendations(sessionId: string): Promise<RecommendationAnalysis> {
    const { data: recommendations } = await supabase
      .from('llm_recommendation_logs')
      .select('*')
      .eq('session_id', sessionId);

    if (!recommendations || recommendations.length === 0) {
      return {
        totalRecommendations: 0,
        truePositives: 0,
        falsePositives: 0,
        trueNegatives: 0,
        falseNegatives: 0,
        accuracy: 0,
        precision: 0,
        recall: 0,
        f1Score: 0,
        noTradeAccuracy: 0
      };
    }

    const truePositives = recommendations.filter(r => r.recommendation_type === 'true_positive').length;
    const falsePositives = recommendations.filter(r => r.recommendation_type === 'false_positive').length;
    const trueNegatives = recommendations.filter(r => r.recommendation_type === 'true_negative').length;
    const falseNegatives = recommendations.filter(r => r.recommendation_type === 'false_negative').length;

    const total = recommendations.length;
    const accuracy = ((truePositives + trueNegatives) / total) * 100;

    const precision = (truePositives + falsePositives) > 0 ?
      (truePositives / (truePositives + falsePositives)) * 100 : 0;

    const recall = (truePositives + falseNegatives) > 0 ?
      (truePositives / (truePositives + falseNegatives)) * 100 : 0;

    const f1Score = (precision + recall) > 0 ?
      (2 * precision * recall) / (precision + recall) : 0;

    const noTrades = recommendations.filter(r => r.llm_action === 'no_trade');
    const correctNoTrades = noTrades.filter(r => r.recommendation_was_correct).length;
    const noTradeAccuracy = noTrades.length > 0 ?
      (correctNoTrades / noTrades.length) * 100 : 0;

    return {
      totalRecommendations: total,
      truePositives,
      falsePositives,
      trueNegatives,
      falseNegatives,
      accuracy: Math.round(accuracy),
      precision: Math.round(precision),
      recall: Math.round(recall),
      f1Score: Math.round(f1Score),
      noTradeAccuracy: Math.round(noTradeAccuracy)
    };
  }

  async getRecommendationsByOutcome(sessionId: string): Promise<any> {
    const { data: recommendations } = await supabase
      .from('llm_recommendation_logs')
      .select('*')
      .eq('session_id', sessionId)
      .order('recommendation_time', { ascending: false });

    const grouped = {
      truePositives: recommendations?.filter(r => r.recommendation_type === 'true_positive') || [],
      falsePositives: recommendations?.filter(r => r.recommendation_type === 'false_positive') || [],
      trueNegatives: recommendations?.filter(r => r.recommendation_type === 'true_negative') || [],
      falseNegatives: recommendations?.filter(r => r.recommendation_type === 'false_negative') || []
    };

    return grouped;
  }

  async getNoTradeRecommendations(sessionId: string): Promise<any[]> {
    const { data: recommendations } = await supabase
      .from('llm_recommendation_logs')
      .select('*')
      .eq('session_id', sessionId)
      .eq('llm_action', 'no_trade')
      .order('recommendation_time', { ascending: false });

    return recommendations || [];
  }

  async validateNoTradeDecision(
    log: LLMRecommendationLog,
    wouldHaveOutcome: 'would_have_won' | 'would_have_lost',
    theoreticalPnL: number
  ): Promise<void> {
    const { data: existing } = await supabase
      .from('llm_recommendation_logs')
      .select('id')
      .eq('session_id', log.sessionId)
      .eq('recommendation_time', log.recommendationTime.toISOString())
      .maybeSingle();

    if (existing) {
      await supabase
        .from('llm_recommendation_logs')
        .update({
          actual_outcome: wouldHaveOutcome,
          actual_pnl: theoreticalPnL,
          recommendation_was_correct: wouldHaveOutcome === 'would_have_lost',
          recommendation_type: wouldHaveOutcome === 'would_have_lost' ? 'true_negative' : 'false_negative'
        })
        .eq('id', existing.id);

      console.log(`[LLM Recommendation Tracker] Validated no-trade decision: ${wouldHaveOutcome}`);
    }
  }
}

export const llmRecommendationTracker = new LLMRecommendationTracker();
