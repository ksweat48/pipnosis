/**
 * Counterfactual Insight Generator
 *
 * Generates AI-powered insights from counterfactual analysis results.
 * Uses LLM to create human-readable summaries and actionable recommendations.
 *
 * Cost: ~150 tokens per trade = $0.0002 per trade
 * For 1000 trades/year = $0.20 total
 */

import { supabase } from '../lib/supabase';
import { openaiProxyClient } from './openai-proxy-client';

interface CounterfactualData {
  variant_type: string;
  variant_setting: number;
  variant_description: string;
  counterfactual_pnl: number;
  actual_pnl: number;
  rr_difference: number;
  would_hit_tp: boolean;
  would_hit_sl: boolean;
  time_to_resolution_minutes: number;
}

interface InsightResult {
  insight_summary: string;
  best_sl_multiplier?: number;
  best_tp_multiplier?: number;
  best_risk_pct?: number;
  early_exit_recommended: boolean;
  hold_longer_recommended: boolean;
  actionable_recommendation: string;
  estimated_improvement_dollars: number;
  estimated_improvement_pct: number;
  llm_tokens_used: number;
}

class CounterfactualInsightGenerator {
  /**
   * Generate AI insights from counterfactual results
   */
  async generateInsights(
    tradeId: string,
    userId: string,
    symbol: string,
    actualPnL: number
  ): Promise<InsightResult | null> {
    try {
      console.log(`[Counterfactual Insights] Generating AI summary for trade ${tradeId}...`);

      const counterfactuals = await this.fetchCounterfactuals(tradeId);

      if (!counterfactuals || counterfactuals.length === 0) {
        console.warn('[Counterfactual Insights] No counterfactuals found');
        return null;
      }

      const prompt = this.buildPrompt(counterfactuals, actualPnL, symbol);

      const response = await openaiProxyClient.chat(
        [{ role: 'user', content: prompt }],
        {
          model: 'gpt-4o-mini',
          max_tokens: 200,
          temperature: 0.3
        }
      );

      const insights = this.parseInsights(response.content, counterfactuals, actualPnL);

      await this.saveInsights(tradeId, userId, insights);

      console.log(`[Counterfactual Insights] ✅ Insights generated and saved`);

      return insights;
    } catch (error) {
      console.error('[Counterfactual Insights] Error generating insights:', error);
      return null;
    }
  }

  /**
   * Fetch counterfactual results for a trade
   */
  private async fetchCounterfactuals(tradeId: string): Promise<CounterfactualData[]> {
    const { data, error } = await supabase
      .from('ai_counterfactuals')
      .select('*')
      .eq('trade_id', tradeId)
      .order('rr_difference', { ascending: false });

    if (error) {
      console.error('[Counterfactual Insights] Error fetching counterfactuals:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Build LLM prompt for analysis
   */
  private buildPrompt(
    counterfactuals: CounterfactualData[],
    actualPnL: number,
    symbol: string
  ): string {
    const bestAlternatives = counterfactuals.slice(0, 5);

    const slVariants = counterfactuals.filter(c => c.variant_type === 'sl_variant');
    const tpVariants = counterfactuals.filter(c => c.variant_type === 'tp_variant');
    const earlyExit = counterfactuals.find(c => c.variant_type === 'early_exit');

    const bestSL = slVariants.reduce((best, curr) =>
      curr.rr_difference > best.rr_difference ? curr : best, slVariants[0]
    );

    const bestTP = tpVariants.reduce((best, curr) =>
      curr.rr_difference > best.rr_difference ? curr : best, tpVariants[0]
    );

    return `Analyze counterfactual trade results and provide ultra-concise insights.

Trade: ${symbol}
Actual P&L: $${actualPnL.toFixed(2)}

Top 5 Alternate Outcomes:
${bestAlternatives.map((c, i) => `${i + 1}. ${c.variant_description}: $${c.counterfactual_pnl.toFixed(2)} (${c.rr_difference >= 0 ? '+' : ''}$${c.rr_difference.toFixed(2)})`).join('\n')}

Best SL: ${bestSL.variant_description} → $${bestSL.counterfactual_pnl.toFixed(2)}
Best TP: ${bestTP.variant_description} → $${bestTP.counterfactual_pnl.toFixed(2)}
${earlyExit ? `Early Exit: $${earlyExit.counterfactual_pnl.toFixed(2)} vs actual $${actualPnL.toFixed(2)}` : ''}

Provide ONLY:
1. One sentence summary of best alternate outcome
2. Specific SL/TP recommendation (e.g., "Use SL 1.15x, TP 1.2x")
3. One actionable insight for next trade

Keep total response under 100 words. Be direct and specific.`;
  }

  /**
   * Parse LLM response and extract insights
   */
  private parseInsights(
    llmResponse: string,
    counterfactuals: CounterfactualData[],
    actualPnL: number
  ): InsightResult {
    const slVariants = counterfactuals.filter(c => c.variant_type === 'sl_variant');
    const tpVariants = counterfactuals.filter(c => c.variant_type === 'tp_variant');
    const riskVariants = counterfactuals.filter(c => c.variant_type === 'risk_variant');
    const earlyExit = counterfactuals.find(c => c.variant_type === 'early_exit');

    // SSOT FIX: Handle empty arrays in reduce operations to prevent null reference errors
    const bestSL = slVariants.length > 0
      ? slVariants.reduce((best, curr) =>
          curr.rr_difference > best.rr_difference ? curr : best, slVariants[0]
        )
      : null;

    const bestTP = tpVariants.length > 0
      ? tpVariants.reduce((best, curr) =>
          curr.rr_difference > best.rr_difference ? curr : best, tpVariants[0]
        )
      : null;

    const bestRisk = riskVariants.length > 0
      ? riskVariants.reduce((best, curr) =>
          curr.rr_difference > best.rr_difference ? curr : best, riskVariants[0]
        )
      : null;

    const bestOverall = counterfactuals[0];
    const improvementDollars = bestOverall.rr_difference;
    const improvementPct = actualPnL !== 0
      ? (improvementDollars / Math.abs(actualPnL)) * 100
      : 0;

    const earlyExitBetter = earlyExit && earlyExit.rr_difference > 5;

    return {
      insight_summary: llmResponse.trim(),
      best_sl_multiplier: bestSL?.variant_setting,
      best_tp_multiplier: bestTP?.variant_setting,
      best_risk_pct: bestRisk?.variant_setting,
      early_exit_recommended: earlyExitBetter || false,
      hold_longer_recommended: false,
      actionable_recommendation: this.generateRecommendation(bestSL, bestTP, earlyExitBetter),
      estimated_improvement_dollars: improvementDollars,
      estimated_improvement_pct: improvementPct,
      llm_tokens_used: this.estimateTokens(llmResponse)
    };
  }

  /**
   * Generate actionable recommendation
   */
  private generateRecommendation(
    bestSL: CounterfactualData,
    bestTP: CounterfactualData,
    earlyExitBetter: boolean
  ): string {
    const recommendations: string[] = [];

    if (bestSL && bestSL.rr_difference > 5) {
      const direction = bestSL.variant_setting < 1 ? 'tighter' : 'wider';
      recommendations.push(`Use ${direction} stops (${bestSL.variant_setting}x)`);
    }

    if (bestTP && bestTP.rr_difference > 5) {
      const direction = bestTP.variant_setting < 1 ? 'earlier' : 'extended';
      recommendations.push(`Take profit ${direction} (${bestTP.variant_setting}x)`);
    }

    if (earlyExitBetter) {
      recommendations.push('Consider trailing stop at 20% pullback');
    }

    return recommendations.length > 0
      ? recommendations.join('. ')
      : 'Current parameters are near-optimal';
  }

  /**
   * Estimate token count
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Save insights to database
   */
  private async saveInsights(
    tradeId: string,
    userId: string,
    insights: InsightResult
  ): Promise<void> {
    const { error } = await supabase
      .from('ai_counterfactual_insights')
      .insert({
        trade_id: tradeId,
        user_id: userId,
        insight_summary: insights.insight_summary,
        best_sl_multiplier: insights.best_sl_multiplier,
        best_tp_multiplier: insights.best_tp_multiplier,
        best_risk_pct: insights.best_risk_pct,
        early_exit_recommended: insights.early_exit_recommended,
        hold_longer_recommended: insights.hold_longer_recommended,
        actionable_recommendation: insights.actionable_recommendation,
        estimated_improvement_dollars: insights.estimated_improvement_dollars,
        estimated_improvement_pct: insights.estimated_improvement_pct,
        llm_tokens_used: insights.llm_tokens_used
      });

    if (error) {
      console.error('[Counterfactual Insights] Error saving insights:', error);
    }
  }
}

export const counterfactualInsightGenerator = new CounterfactualInsightGenerator();
