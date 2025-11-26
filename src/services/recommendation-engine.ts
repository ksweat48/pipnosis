/**
 * Recommendation Engine
 *
 * Tracks, applies, and measures effectiveness of trading recommendations.
 * Closes the learning loop by ensuring recommendations become actions.
 */

import { supabase } from '../lib/supabase';

export interface Recommendation {
  id: string;
  userId: string;
  recommendationText: string;
  recommendationType: 'confidence_adjust' | 'risk_adjust' | 'filter_adjust' | 'pattern_avoid' | 'strategy_change';
  targetSymbol?: string;
  targetPattern?: string;
  adjustmentValue?: number;
  status: 'pending' | 'active' | 'applied' | 'retired';
  confidenceScore: number;
  sourceSessionId?: string;
  createdAt: Date;
  appliedAt?: Date;
  retiredAt?: Date;
  effectivenessScore?: number;
  tradesAffected?: number;
  metadata?: any;
}

export interface RecommendationEffectiveness {
  recommendationId: string;
  tradesCount: number;
  winRateBefore: number;
  winRateAfter: number;
  profitFactorBefore: number;
  profitFactorAfter: number;
  improvementScore: number;
  shouldKeep: boolean;
  reasoning: string;
}

class RecommendationEngine {
  /**
   * Store a new recommendation
   */
  async storeRecommendation(
    userId: string,
    recommendationText: string,
    type: Recommendation['recommendationType'],
    confidenceScore: number,
    options?: {
      targetSymbol?: string;
      targetPattern?: string;
      adjustmentValue?: number;
      sourceSessionId?: string;
      metadata?: any;
    }
  ): Promise<string | null> {
    console.log(`[Recommendation Engine] 💡 Storing new recommendation: ${recommendationText}`);

    try {
      const { data, error } = await supabase
        .from('recommendations')
        .insert({
          user_id: userId,
          recommendation_text: recommendationText,
          recommendation_type: type,
          target_symbol: options?.targetSymbol,
          target_pattern: options?.targetPattern,
          adjustment_value: options?.adjustmentValue,
          status: confidenceScore >= 80 ? 'active' : 'pending',
          confidence_score: confidenceScore,
          source_session_id: options?.sourceSessionId,
          metadata: options?.metadata || {},
          created_at: new Date().toISOString()
        })
        .select('id')
        .single();

      if (error) {
        console.error('[Recommendation Engine] Error storing recommendation:', error);
        return null;
      }

      console.log(`[Recommendation Engine] ✅ Recommendation stored with ID: ${data.id}`);
      console.log(`[Recommendation Engine] Status: ${confidenceScore >= 80 ? 'ACTIVE (auto-apply)' : 'PENDING (requires approval)'}`);

      return data.id;
    } catch (error) {
      console.error('[Recommendation Engine] Unexpected error:', error);
      return null;
    }
  }

  /**
   * Get active recommendations for a user
   */
  async getActiveRecommendations(
    userId: string,
    symbol?: string
  ): Promise<Recommendation[]> {
    console.log(`[Recommendation Engine] 📋 Loading active recommendations for user ${userId}${symbol ? ` (${symbol})` : ''}`);

    try {
      let query = supabase
        .from('recommendations')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['active', 'applied'])
        .order('confidence_score', { ascending: false });

      if (symbol) {
        query = query.or(`target_symbol.eq.${symbol},target_symbol.is.null`);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[Recommendation Engine] Error loading recommendations:', error);
        return [];
      }

      if (!data || data.length === 0) {
        console.log('[Recommendation Engine] No active recommendations found');
        return [];
      }

      console.log(`[Recommendation Engine] ✅ Loaded ${data.length} active recommendations`);

      return data.map(rec => ({
        id: rec.id,
        userId: rec.user_id,
        recommendationText: rec.recommendation_text,
        recommendationType: rec.recommendation_type,
        targetSymbol: rec.target_symbol,
        targetPattern: rec.target_pattern,
        adjustmentValue: rec.adjustment_value,
        status: rec.status,
        confidenceScore: rec.confidence_score,
        sourceSessionId: rec.source_session_id,
        createdAt: new Date(rec.created_at),
        appliedAt: rec.applied_at ? new Date(rec.applied_at) : undefined,
        retiredAt: rec.retired_at ? new Date(rec.retired_at) : undefined,
        effectivenessScore: rec.effectiveness_score,
        tradesAffected: rec.trades_affected,
        metadata: rec.metadata || {}
      }));
    } catch (error) {
      console.error('[Recommendation Engine] Unexpected error:', error);
      return [];
    }
  }

  /**
   * Apply a recommendation (mark as applied and start tracking)
   */
  async applyRecommendation(recommendationId: string): Promise<boolean> {
    console.log(`[Recommendation Engine] ⚙️ Applying recommendation ${recommendationId}`);

    try {
      const { error } = await supabase
        .from('recommendations')
        .update({
          status: 'applied',
          applied_at: new Date().toISOString()
        })
        .eq('id', recommendationId);

      if (error) {
        console.error('[Recommendation Engine] Error applying recommendation:', error);
        return false;
      }

      console.log(`[Recommendation Engine] ✅ Recommendation applied successfully`);
      return true;
    } catch (error) {
      console.error('[Recommendation Engine] Unexpected error:', error);
      return false;
    }
  }

  /**
   * Track recommendation effectiveness after N trades
   */
  async trackRecommendationEffectiveness(
    recommendationId: string,
    minTrades: number = 10
  ): Promise<RecommendationEffectiveness | null> {
    console.log(`[Recommendation Engine] 📊 Measuring effectiveness for recommendation ${recommendationId}`);

    try {
      // Get the recommendation
      const { data: rec, error: recError } = await supabase
        .from('recommendations')
        .select('*')
        .eq('id', recommendationId)
        .single();

      if (recError || !rec) {
        console.error('[Recommendation Engine] Recommendation not found');
        return null;
      }

      const appliedAt = rec.applied_at ? new Date(rec.applied_at) : null;
      if (!appliedAt) {
        console.log('[Recommendation Engine] Recommendation not yet applied');
        return null;
      }

      // Get trades before recommendation
      const { data: tradesBefore, error: beforeError } = await supabase
        .from('trade_history')
        .select('outcome, profit_loss')
        .eq('user_id', rec.user_id)
        .lt('closed_at', appliedAt.toISOString())
        .order('closed_at', { ascending: false })
        .limit(minTrades);

      // Get trades after recommendation
      const { data: tradesAfter, error: afterError } = await supabase
        .from('trade_history')
        .select('outcome, profit_loss')
        .eq('user_id', rec.user_id)
        .gte('closed_at', appliedAt.toISOString())
        .order('closed_at', { ascending: false })
        .limit(minTrades);

      if (beforeError || afterError || !tradesBefore || !tradesAfter) {
        console.error('[Recommendation Engine] Error fetching trades');
        return null;
      }

      if (tradesAfter.length < minTrades) {
        console.log(`[Recommendation Engine] Not enough trades yet (${tradesAfter.length}/${minTrades})`);
        return null;
      }

      // Calculate metrics before
      const winsBefore = tradesBefore.filter(t => t.outcome === 'win').length;
      const winRateBefore = (winsBefore / tradesBefore.length) * 100;
      const totalWinsBefore = tradesBefore
        .filter(t => t.outcome === 'win')
        .reduce((sum, t) => sum + (t.profit_loss || 0), 0);
      const totalLossesBefore = Math.abs(
        tradesBefore
          .filter(t => t.outcome === 'loss')
          .reduce((sum, t) => sum + (t.profit_loss || 0), 0)
      );
      const profitFactorBefore = totalLossesBefore > 0 ? totalWinsBefore / totalLossesBefore : 0;

      // Calculate metrics after
      const winsAfter = tradesAfter.filter(t => t.outcome === 'win').length;
      const winRateAfter = (winsAfter / tradesAfter.length) * 100;
      const totalWinsAfter = tradesAfter
        .filter(t => t.outcome === 'win')
        .reduce((sum, t) => sum + (t.profit_loss || 0), 0);
      const totalLossesAfter = Math.abs(
        tradesAfter
          .filter(t => t.outcome === 'loss')
          .reduce((sum, t) => sum + (t.profit_loss || 0), 0)
      );
      const profitFactorAfter = totalLossesAfter > 0 ? totalWinsAfter / totalLossesAfter : 0;

      // Calculate improvement score
      const winRateImprovement = winRateAfter - winRateBefore;
      const pfImprovement = profitFactorAfter - profitFactorBefore;
      const improvementScore = (winRateImprovement * 0.6) + (pfImprovement * 20 * 0.4);

      const shouldKeep = improvementScore > 5;

      let reasoning = '';
      if (improvementScore > 10) {
        reasoning = `Excellent improvement: WR +${winRateImprovement.toFixed(1)}%, PF +${pfImprovement.toFixed(2)}`;
      } else if (improvementScore > 5) {
        reasoning = `Positive improvement: WR +${winRateImprovement.toFixed(1)}%, PF +${pfImprovement.toFixed(2)}`;
      } else if (improvementScore > -5) {
        reasoning = `Neutral impact: WR ${winRateImprovement > 0 ? '+' : ''}${winRateImprovement.toFixed(1)}%, PF ${pfImprovement > 0 ? '+' : ''}${pfImprovement.toFixed(2)}`;
      } else {
        reasoning = `Negative impact: WR ${winRateImprovement.toFixed(1)}%, PF ${pfImprovement.toFixed(2)}. Consider retiring.`;
      }

      console.log(`[Recommendation Engine] 📈 Effectiveness measured:`);
      console.log(`  Win Rate: ${winRateBefore.toFixed(1)}% → ${winRateAfter.toFixed(1)}% (${winRateImprovement > 0 ? '+' : ''}${winRateImprovement.toFixed(1)}%)`);
      console.log(`  Profit Factor: ${profitFactorBefore.toFixed(2)} → ${profitFactorAfter.toFixed(2)} (${pfImprovement > 0 ? '+' : ''}${pfImprovement.toFixed(2)})`);
      console.log(`  Improvement Score: ${improvementScore.toFixed(1)}`);
      console.log(`  Decision: ${shouldKeep ? 'KEEP' : 'RETIRE'}`);

      // Update recommendation with effectiveness data
      await supabase
        .from('recommendations')
        .update({
          effectiveness_score: improvementScore,
          trades_affected: tradesAfter.length
        })
        .eq('id', recommendationId);

      return {
        recommendationId,
        tradesCount: tradesAfter.length,
        winRateBefore,
        winRateAfter,
        profitFactorBefore,
        profitFactorAfter,
        improvementScore,
        shouldKeep,
        reasoning
      };
    } catch (error) {
      console.error('[Recommendation Engine] Error tracking effectiveness:', error);
      return null;
    }
  }

  /**
   * Retire a recommendation (mark as retired)
   */
  async retireRecommendation(
    recommendationId: string,
    reason: string
  ): Promise<boolean> {
    console.log(`[Recommendation Engine] 🗑️ Retiring recommendation ${recommendationId}: ${reason}`);

    try {
      const { error } = await supabase
        .from('recommendations')
        .update({
          status: 'retired',
          retired_at: new Date().toISOString(),
          metadata: { retirement_reason: reason }
        })
        .eq('id', recommendationId);

      if (error) {
        console.error('[Recommendation Engine] Error retiring recommendation:', error);
        return false;
      }

      console.log(`[Recommendation Engine] ✅ Recommendation retired`);
      return true;
    } catch (error) {
      console.error('[Recommendation Engine] Unexpected error:', error);
      return false;
    }
  }

  /**
   * Auto-apply high-confidence recommendations
   */
  async autoApplyPendingRecommendations(userId: string): Promise<number> {
    console.log(`[Recommendation Engine] 🤖 Auto-applying high-confidence recommendations for user ${userId}`);

    try {
      const { data: pending, error } = await supabase
        .from('recommendations')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .gte('confidence_score', 80);

      if (error || !pending || pending.length === 0) {
        console.log('[Recommendation Engine] No pending high-confidence recommendations');
        return 0;
      }

      let appliedCount = 0;
      for (const rec of pending) {
        // Check if recommendation is old enough (24h)
        const createdAt = new Date(rec.created_at);
        const hoursSinceCreation = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);

        if (hoursSinceCreation >= 24) {
          await this.applyRecommendation(rec.id);
          appliedCount++;
        }
      }

      console.log(`[Recommendation Engine] ✅ Auto-applied ${appliedCount} recommendations`);
      return appliedCount;
    } catch (error) {
      console.error('[Recommendation Engine] Error auto-applying:', error);
      return 0;
    }
  }

  /**
   * Format recommendations for LLM context
   */
  formatForLLM(recommendations: Recommendation[]): string {
    if (recommendations.length === 0) {
      return '';
    }

    let formatted = '\n=== 💡 ACTIVE RECOMMENDATIONS ===\n';
    formatted += `You have ${recommendations.length} active recommendation${recommendations.length > 1 ? 's' : ''} to consider:\n\n`;

    for (let i = 0; i < Math.min(recommendations.length, 5); i++) {
      const rec = recommendations[i];
      formatted += `${i + 1}. ${rec.recommendationText}\n`;
      formatted += `   Type: ${rec.recommendationType} | Confidence: ${rec.confidenceScore}%\n`;
      if (rec.targetSymbol) {
        formatted += `   Target: ${rec.targetSymbol}\n`;
      }
      if (rec.effectivenessScore !== undefined) {
        formatted += `   Effectiveness: ${rec.effectivenessScore.toFixed(1)} (${rec.tradesAffected} trades)\n`;
      }
      formatted += '\n';
    }

    formatted += '⚠️ IMPORTANT: Factor these recommendations into your decision-making.\n';

    return formatted;
  }
}

export const recommendationEngine = new RecommendationEngine();
