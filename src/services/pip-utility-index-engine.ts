/**
 * PIP Utility Index Engine - SSOT for dynamic utility value calculation
 *
 * Responsibility:
 * - Calculate daily PIP Utility Index based on platform activity
 * - Apply normalization, weighting, and EMA smoothing
 * - Convert to display value (USD units, display-only)
 * - Maintain deterministic, replayable calculations
 *
 * SSOT Compliance:
 * - Single authority for utility index calculation
 * - Deterministic formula with configurable parameters
 * - Event-sourced history (immutable time series)
 *
 * Formula:
 * 1. Aggregate 30-day metrics (credits spent, PIP burned, staked ratio, active users, liquid supply)
 * 2. Normalize each metric to [0, 1] using min/max bounds
 * 3. Calculate weighted score: UsageScore = Σ(weight_i * norm(metric_i))
 * 4. Calculate supply pressure: SupplyPressure = norm(liquid_supply_ratio)
 * 5. Calculate raw index: RawIndex = UsageScore / max(SupplyPressure, epsilon)
 * 6. Apply EMA smoothing: SmoothedIndex = PrevIndex*(1-alpha) + RawIndex*alpha
 * 7. Convert to display value: DisplayValue = BaseValue * SmoothedIndex
 *
 * @module services/pip-utility-index-engine
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

const TOTAL_SUPPLY = 100000000; // 100M PIP
const EPSILON = 0.01; // Prevent division by zero

export interface IndexMetrics {
  credits_spent_30d: number;
  pip_burned_30d: number;
  staked_ratio: number;
  active_users_30d: number;
  liquid_supply_ratio: number;
}

export interface IndexState {
  id: number;
  last_computed_date: string | null;
  previous_smoothed_index: number;
  alpha: number;
  weight_credits: number;
  weight_burn: number;
  weight_stake: number;
  weight_active: number;
  base_utility_value: number;
  normalization_bounds: {
    credits_spent: { min: number; max: number };
    pip_burned: { min: number; max: number };
    staked_ratio: { min: number; max: number };
    active_users: { min: number; max: number };
    liquid_supply_ratio: { min: number; max: number };
  };
  updated_at: string;
}

export interface IndexHistory {
  date: string;
  credits_spent_30d: number;
  pip_burned_30d: number;
  staked_ratio: number;
  active_users_30d: number;
  liquid_supply_ratio: number;
  raw_index: number;
  smoothed_index: number;
  display_value_usd: number;
  computation_metadata: Record<string, any>;
  created_at: string;
}

export interface IndexCalculationResult {
  date: string;
  metrics: IndexMetrics;
  normalized_metrics: Record<string, number>;
  usage_score: number;
  supply_pressure: number;
  raw_index: number;
  smoothed_index: number;
  display_value_usd: number;
}

/**
 * PIP Utility Index Engine
 * SSOT for calculating dynamic utility value
 */
class PipUtilityIndexEngine {
  /**
   * Get current index state (config parameters)
   */
  async getIndexState(): Promise<IndexState> {
    const { data, error } = await supabase
      .from('pip_utility_index_state')
      .select('*')
      .eq('id', 1)
      .single();

    if (error) {
      logger.error('Failed to fetch index state', { error });
      throw new Error(`Failed to fetch index state: ${error.message}`);
    }

    return data;
  }

  /**
   * Update index state configuration (admin-only)
   */
  async updateIndexState(
    updates: Partial<Omit<IndexState, 'id' | 'last_computed_date' | 'updated_at'>>
  ): Promise<void> {
    const { error } = await supabase
      .from('pip_utility_index_state')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', 1);

    if (error) {
      logger.error('Failed to update index state', { error });
      throw new Error(`Failed to update index state: ${error.message}`);
    }

    logger.info('Index state updated', { updates });
  }

  /**
   * Get metrics for the last 30 days
   */
  async getMetricsFor30Days(): Promise<IndexMetrics> {
    const { data: metricsData, error: metricsError } = await supabase.rpc(
      'get_pip_index_metrics_30d'
    );

    if (metricsError) {
      logger.error('Failed to get 30-day metrics', { error: metricsError });
      throw new Error(`Failed to get 30-day metrics: ${metricsError.message}`);
    }

    return metricsData || {
      credits_spent_30d: 0,
      pip_burned_30d: 0,
      staked_ratio: 0,
      active_users_30d: 0,
      liquid_supply_ratio: 0
    };
  }

  /**
   * Normalize metric using min/max bounds with winsorization
   */
  normalizeMetric(
    value: number,
    bounds: { min: number; max: number }
  ): number {
    // Winsorize (clip to bounds)
    const clipped = Math.max(bounds.min, Math.min(bounds.max, value));

    // Normalize to [0, 1]
    const range = bounds.max - bounds.min;
    if (range === 0) return 0;

    return (clipped - bounds.min) / range;
  }

  /**
   * Calculate raw index from normalized metrics
   */
  calculateRawIndex(
    normalizedMetrics: Record<string, number>,
    weights: {
      credits: number;
      burn: number;
      stake: number;
      active: number;
    },
    supplyPressure: number
  ): number {
    // Usage score (positive pressure)
    const usageScore =
      weights.credits * normalizedMetrics.credits_spent +
      weights.burn * normalizedMetrics.pip_burned +
      weights.stake * normalizedMetrics.staked_ratio +
      weights.active * normalizedMetrics.active_users;

    // Raw index = usage / supply pressure
    const rawIndex = usageScore / Math.max(supplyPressure, EPSILON);

    return rawIndex;
  }

  /**
   * Apply EMA smoothing
   */
  applyEMASmoothing(
    rawIndex: number,
    previousSmoothed: number,
    alpha: number
  ): number {
    return previousSmoothed * (1 - alpha) + rawIndex * alpha;
  }

  /**
   * Convert smoothed index to display value
   */
  convertToDisplayValue(
    smoothedIndex: number,
    baseValue: number
  ): number {
    return baseValue * smoothedIndex;
  }

  /**
   * Compute daily index (main calculation engine)
   */
  async computeDailyIndex(targetDate?: Date): Promise<IndexCalculationResult> {
    const date = targetDate || new Date();
    const dateStr = date.toISOString().split('T')[0];

    logger.info('Computing daily PIP Utility Index', { date: dateStr });

    // 1. Get index state (config)
    const state = await this.getIndexState();

    // 2. Get 30-day metrics
    const metrics = await this.getMetricsFor30Days();

    // 3. Normalize metrics
    const normalizedMetrics = {
      credits_spent: this.normalizeMetric(
        metrics.credits_spent_30d,
        state.normalization_bounds.credits_spent
      ),
      pip_burned: this.normalizeMetric(
        metrics.pip_burned_30d,
        state.normalization_bounds.pip_burned
      ),
      staked_ratio: this.normalizeMetric(
        metrics.staked_ratio,
        state.normalization_bounds.staked_ratio
      ),
      active_users: this.normalizeMetric(
        metrics.active_users_30d,
        state.normalization_bounds.active_users
      ),
      liquid_supply_ratio: this.normalizeMetric(
        metrics.liquid_supply_ratio,
        state.normalization_bounds.liquid_supply_ratio
      )
    };

    // 4. Calculate usage score and supply pressure
    const weights = {
      credits: state.weight_credits,
      burn: state.weight_burn,
      stake: state.weight_stake,
      active: state.weight_active
    };

    const supplyPressure = normalizedMetrics.liquid_supply_ratio;

    // 5. Calculate raw index
    const rawIndex = this.calculateRawIndex(normalizedMetrics, weights, supplyPressure);

    // 6. Apply EMA smoothing
    const smoothedIndex = this.applyEMASmoothing(
      rawIndex,
      state.previous_smoothed_index,
      state.alpha
    );

    // 7. Convert to display value
    const displayValueUsd = this.convertToDisplayValue(
      smoothedIndex,
      state.base_utility_value
    );

    // 8. Store in history
    const { error: insertError } = await supabase
      .from('pip_utility_index_history')
      .insert({
        date: dateStr,
        credits_spent_30d: metrics.credits_spent_30d,
        pip_burned_30d: metrics.pip_burned_30d,
        staked_ratio: metrics.staked_ratio,
        active_users_30d: metrics.active_users_30d,
        liquid_supply_ratio: metrics.liquid_supply_ratio,
        raw_index: rawIndex,
        smoothed_index: smoothedIndex,
        display_value_usd: displayValueUsd,
        computation_metadata: {
          weights,
          normalized_metrics: normalizedMetrics,
          usage_score: weights.credits * normalizedMetrics.credits_spent +
                       weights.burn * normalizedMetrics.pip_burned +
                       weights.stake * normalizedMetrics.staked_ratio +
                       weights.active * normalizedMetrics.active_users,
          supply_pressure: supplyPressure,
          normalization_bounds: state.normalization_bounds
        }
      });

    if (insertError && !insertError.message.includes('duplicate key')) {
      logger.error('Failed to store index history', { error: insertError });
      throw new Error(`Failed to store index history: ${insertError.message}`);
    }

    // 9. Update state with new smoothed index
    await supabase
      .from('pip_utility_index_state')
      .update({
        last_computed_date: dateStr,
        previous_smoothed_index: smoothedIndex,
        updated_at: new Date().toISOString()
      })
      .eq('id', 1);

    logger.info('PIP Utility Index computed', {
      date: dateStr,
      raw_index: rawIndex,
      smoothed_index: smoothedIndex,
      display_value_usd: displayValueUsd
    });

    return {
      date: dateStr,
      metrics,
      normalized_metrics: normalizedMetrics,
      usage_score: weights.credits * normalizedMetrics.credits_spent +
                   weights.burn * normalizedMetrics.pip_burned +
                   weights.stake * normalizedMetrics.staked_ratio +
                   weights.active * normalizedMetrics.active_users,
      supply_pressure: supplyPressure,
      raw_index: rawIndex,
      smoothed_index: smoothedIndex,
      display_value_usd: displayValueUsd
    };
  }

  /**
   * Get current utility value (latest from history)
   */
  async getCurrentUtilityValue(): Promise<{
    display_value_usd: number;
    smoothed_index: number;
    date: string;
  } | null> {
    const { data, error } = await supabase
      .from('pip_utility_index_history')
      .select('date, smoothed_index, display_value_usd')
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.error('Failed to get current utility value', { error });
      throw new Error(`Failed to get current utility value: ${error.message}`);
    }

    return data;
  }

  /**
   * Get index history (time series)
   */
  async getIndexHistory(days: number = 90): Promise<IndexHistory[]> {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    const { data, error } = await supabase
      .from('pip_utility_index_history')
      .select('*')
      .gte('date', sinceDate.toISOString().split('T')[0])
      .order('date', { ascending: true });

    if (error) {
      logger.error('Failed to get index history', { days, error });
      throw new Error(`Failed to get index history: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get index change over period
   */
  async getIndexChange(days: number): Promise<{
    previous_value: number;
    current_value: number;
    change_amount: number;
    change_percentage: number;
  }> {
    const history = await this.getIndexHistory(days + 1);

    if (history.length < 2) {
      return {
        previous_value: 0,
        current_value: 0,
        change_amount: 0,
        change_percentage: 0
      };
    }

    const current = history[history.length - 1];
    const previous = history[0];

    const changeAmount = current.display_value_usd - previous.display_value_usd;
    const changePercentage = previous.display_value_usd > 0
      ? (changeAmount / previous.display_value_usd) * 100
      : 0;

    return {
      previous_value: previous.display_value_usd,
      current_value: current.display_value_usd,
      change_amount: changeAmount,
      change_percentage: changePercentage
    };
  }

  /**
   * Get utility pressure level (Low/Medium/High)
   * Based on percentile of smoothed index
   */
  async getUtilityPressure(): Promise<'Low' | 'Medium' | 'High'> {
    const history = await this.getIndexHistory(90);

    if (history.length === 0) {
      return 'Low';
    }

    const current = history[history.length - 1];
    const sortedIndices = history
      .map(h => h.smoothed_index)
      .sort((a, b) => a - b);

    const percentile = sortedIndices.findIndex(v => v >= current.smoothed_index) / sortedIndices.length;

    if (percentile >= 0.67) return 'High';
    if (percentile >= 0.33) return 'Medium';
    return 'Low';
  }
}

export const pipUtilityIndexEngine = new PipUtilityIndexEngine();
