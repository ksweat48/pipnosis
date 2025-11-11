import { supabase } from '../lib/supabase';

/**
 * Meta-Learning Engine
 *
 * This service implements a meta-learning layer that learns WHICH types of
 * insights lead to the best trading outcomes. Instead of treating all insights
 * equally, it dynamically adjusts weights based on historical effectiveness.
 *
 * The AI doesn't just learn from trades - it learns HOW to learn more effectively.
 */

interface InsightEffectiveness {
  insightType: string;
  featureCategory?: string;
  timesUsed: number;
  timesCorrect: number;
  precisionScore: number;
  f1Score: number;
  avgPnl: number;
  effectivenessLast30d: number;
  trend: 'improving' | 'declining' | 'stable';
}

interface MetaLearningConfig {
  insightType: string;
  optimalWeight: number;
  confidenceMultiplier: number;
  sampleSize: number;
  isStatisticallySignificant: boolean;
  winRateWhenUsed: number;
}

class MetaLearningEngine {
  /**
   * Get optimal weights for different insight types
   * These weights are learned from historical performance
   */
  async getOptimalInsightWeights(userId: string): Promise<Map<string, number>> {
    try {
      const { data, error } = await supabase
        .from('ai_meta_learning_config')
        .select('insight_type, optimal_weight, statistical_significance')
        .eq('user_id', userId);

      if (error) {
        console.error('[Meta-Learning] Error fetching optimal weights:', error);
        return this.getDefaultWeights();
      }

      const weights = new Map<string, number>();

      if (data && data.length > 0) {
        data.forEach(config => {
          // Only use weights that are statistically significant
          if (config.statistical_significance) {
            weights.set(config.insight_type, config.optimal_weight);
          }
        });
      }

      // Fill in defaults for missing types
      const defaultWeights = this.getDefaultWeights();
      defaultWeights.forEach((weight, type) => {
        if (!weights.has(type)) {
          weights.set(type, weight);
        }
      });

      return weights;
    } catch (error) {
      console.error('[Meta-Learning] Error in getOptimalInsightWeights:', error);
      return this.getDefaultWeights();
    }
  }

  /**
   * Get confidence multipliers for different insight types
   * These tell us how much to trust each type of insight
   */
  async getConfidenceMultipliers(userId: string): Promise<Map<string, number>> {
    try {
      const { data, error } = await supabase
        .from('ai_meta_learning_config')
        .select('insight_type, confidence_multiplier, statistical_significance')
        .eq('user_id', userId);

      if (error) {
        console.error('[Meta-Learning] Error fetching confidence multipliers:', error);
        return new Map([['default', 1.0]]);
      }

      const multipliers = new Map<string, number>();

      if (data && data.length > 0) {
        data.forEach(config => {
          if (config.statistical_significance) {
            multipliers.set(config.insight_type, config.confidence_multiplier);
          }
        });
      }

      return multipliers;
    } catch (error) {
      console.error('[Meta-Learning] Error in getConfidenceMultipliers:', error);
      return new Map([['default', 1.0]]);
    }
  }

  /**
   * Get insight effectiveness metrics
   */
  async getInsightEffectiveness(userId: string, symbol?: string): Promise<InsightEffectiveness[]> {
    try {
      let query = supabase
        .from('ai_insight_effectiveness_tracking')
        .select('*')
        .eq('user_id', userId)
        .gte('times_used', 3) // Minimum 3 uses to show stats
        .order('f1_score', { ascending: false });

      if (symbol) {
        query = query.eq('symbol', symbol);
      }

      const { data, error } = await query.limit(20);

      if (error) {
        console.error('[Meta-Learning] Error fetching insight effectiveness:', error);
        return [];
      }

      return (data || []).map(d => ({
        insightType: d.insight_type,
        featureCategory: d.feature_category,
        timesUsed: d.times_used,
        timesCorrect: d.times_correct,
        precisionScore: parseFloat(d.precision_score),
        f1Score: parseFloat(d.f1_score),
        avgPnl: parseFloat(d.avg_pnl_when_used),
        effectivenessLast30d: parseFloat(d.effectiveness_last_30d || 0),
        trend: d.effectiveness_trend || 'stable'
      }));
    } catch (error) {
      console.error('[Meta-Learning] Error in getInsightEffectiveness:', error);
      return [];
    }
  }

  /**
   * Get top-performing insight types
   */
  async getTopInsightTypes(userId: string, limit: number = 5): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('ai_top_insight_types')
        .select('*')
        .eq('user_id', userId)
        .lte('effectiveness_rank', limit)
        .order('effectiveness_rank', { ascending: true });

      if (error) {
        console.error('[Meta-Learning] Error fetching top insights:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[Meta-Learning] Error in getTopInsightTypes:', error);
      return [];
    }
  }

  /**
   * Track that an insight was used in a decision
   * This is called when the AI decision advisor uses an insight
   */
  async trackInsightUsage(
    userId: string,
    insightType: string,
    featureCategory: string | null,
    symbol: string
  ): Promise<void> {
    try {
      // Update last_used_at timestamp
      await supabase
        .from('ai_insight_effectiveness_tracking')
        .upsert({
          user_id: userId,
          insight_type: insightType,
          feature_category: featureCategory,
          symbol: symbol,
          last_used_at: new Date().toISOString(),
          last_updated_at: new Date().toISOString()
        });
    } catch (error) {
      console.error('[Meta-Learning] Error tracking insight usage:', error);
    }
  }

  /**
   * Recalculate meta-learning configuration
   * Should be called periodically (e.g., daily or after every 10 trades)
   */
  async recalculateConfig(userId: string): Promise<void> {
    try {
      console.log('[Meta-Learning] Recalculating meta-learning configuration...');

      const { error } = await supabase.rpc('recalculate_meta_learning_config', {
        p_user_id: userId
      });

      if (error) {
        console.error('[Meta-Learning] Error recalculating config:', error);
        return;
      }

      console.log('[Meta-Learning] Configuration recalculated successfully');
    } catch (error) {
      console.error('[Meta-Learning] Error in recalculateConfig:', error);
    }
  }

  /**
   * Check if recalculation is due and trigger if needed
   */
  async checkAndRecalculateIfDue(userId: string): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('ai_meta_learning_config')
        .select('next_recalculation_due')
        .eq('user_id', userId)
        .order('next_recalculation_due', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[Meta-Learning] Error checking recalculation due:', error);
        return;
      }

      if (!data) {
        // No config exists, run initial calculation
        await this.recalculateConfig(userId);
        return;
      }

      const dueDate = new Date(data.next_recalculation_due);
      const now = new Date();

      if (now >= dueDate) {
        console.log('[Meta-Learning] Recalculation is due, triggering now...');
        await this.recalculateConfig(userId);
      }
    } catch (error) {
      console.error('[Meta-Learning] Error in checkAndRecalculateIfDue:', error);
    }
  }

  /**
   * Get meta-learning performance summary
   */
  async getPerformanceSummary(userId: string): Promise<any> {
    try {
      const effectiveness = await this.getInsightEffectiveness(userId);
      const config = await this.getOptimalInsightWeights(userId);

      const totalInsights = effectiveness.length;
      const highPerformers = effectiveness.filter(e => e.f1Score >= 0.7).length;
      const lowPerformers = effectiveness.filter(e => e.f1Score < 0.5).length;

      const avgF1 = effectiveness.length > 0
        ? effectiveness.reduce((sum, e) => sum + e.f1Score, 0) / effectiveness.length
        : 0;

      const avgPnl = effectiveness.length > 0
        ? effectiveness.reduce((sum, e) => sum + e.avgPnl, 0) / effectiveness.length
        : 0;

      return {
        totalInsightTypes: totalInsights,
        highPerformers,
        lowPerformers,
        avgF1Score: avgF1.toFixed(3),
        avgPnlPerInsight: avgPnl.toFixed(2),
        learnedWeights: config.size,
        isLearning: totalInsights > 0,
        needsMoreData: totalInsights < 5
      };
    } catch (error) {
      console.error('[Meta-Learning] Error getting performance summary:', error);
      return null;
    }
  }

  /**
   * Default weights when no learned data exists yet
   */
  private getDefaultWeights(): Map<string, number> {
    return new Map([
      ['winning_pattern', 1.0],
      ['losing_pattern', 1.0],
      ['indicator_signal', 0.8],
      ['market_condition', 0.9],
      ['time_of_day', 0.7],
      ['volatility_pattern', 0.8]
    ]);
  }

  /**
   * Apply meta-learned weights to insight confidence
   * This is used by the AI decision advisor to dynamically adjust confidence
   */
  async applyMetaLearningAdjustment(
    userId: string,
    insightType: string,
    baseConfidence: number
  ): Promise<number> {
    try {
      const multipliers = await this.getConfidenceMultipliers(userId);
      const multiplier = multipliers.get(insightType) || multipliers.get('default') || 1.0;

      return baseConfidence * multiplier;
    } catch (error) {
      console.error('[Meta-Learning] Error applying adjustment:', error);
      return baseConfidence;
    }
  }
}

export const metaLearningEngine = new MetaLearningEngine();
export type { InsightEffectiveness, MetaLearningConfig };
