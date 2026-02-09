/**
 * Compute Daily PIP Utility Index - Scheduled Function
 *
 * Responsibility:
 * - Runs daily at 00:00 UTC
 * - Calculates PIP Utility Index using pipUtilityIndexEngine
 * - Stores result in pip_utility_index_history
 * - Alerts on integrity failures
 *
 * Schedule: Daily cron (0 0 * * *)
 *
 * SSOT Compliance:
 * - Delegates all calculation to pipUtilityIndexEngine
 * - Logs all executions for audit trail
 *
 * @module netlify/functions/compute-daily-pip-index
 */

import { Handler, schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * PIP Utility Index Engine (inline for serverless)
 */
const EPSILON = 0.01;

async function getIndexState() {
  const { data, error } = await supabase
    .from('pip_utility_index_state')
    .select('*')
    .eq('id', 1)
    .single();

  if (error) throw new Error(`Failed to fetch index state: ${error.message}`);
  return data;
}

async function getMetricsFor30Days() {
  const { data, error } = await supabase.rpc('get_pip_index_metrics_30d');

  if (error) throw new Error(`Failed to get 30-day metrics: ${error.message}`);

  return data || {
    credits_spent_30d: 0,
    pip_burned_30d: 0,
    staked_ratio: 0,
    active_users_30d: 0,
    liquid_supply_ratio: 0
  };
}

function normalizeMetric(
  value: number,
  bounds: { min: number; max: number }
): number {
  const clipped = Math.max(bounds.min, Math.min(bounds.max, value));
  const range = bounds.max - bounds.min;
  if (range === 0) return 0;
  return (clipped - bounds.min) / range;
}

function calculateRawIndex(
  normalizedMetrics: Record<string, number>,
  weights: {
    credits: number;
    burn: number;
    stake: number;
    active: number;
  },
  supplyPressure: number
): number {
  const usageScore =
    weights.credits * normalizedMetrics.credits_spent +
    weights.burn * normalizedMetrics.pip_burned +
    weights.stake * normalizedMetrics.staked_ratio +
    weights.active * normalizedMetrics.active_users;

  return usageScore / Math.max(supplyPressure, EPSILON);
}

function applyEMASmoothing(
  rawIndex: number,
  previousSmoothed: number,
  alpha: number
): number {
  return previousSmoothed * (1 - alpha) + rawIndex * alpha;
}

async function computeDailyIndex() {
  const date = new Date();
  const dateStr = date.toISOString().split('T')[0];

  console.log(`Computing daily PIP Utility Index for ${dateStr}`);

  // 1. Get index state
  const state = await getIndexState();

  // 2. Get 30-day metrics
  const metrics = await getMetricsFor30Days();

  // 3. Normalize metrics
  const normalizedMetrics = {
    credits_spent: normalizeMetric(
      Number(metrics.credits_spent_30d),
      state.normalization_bounds.credits_spent
    ),
    pip_burned: normalizeMetric(
      Number(metrics.pip_burned_30d),
      state.normalization_bounds.pip_burned
    ),
    staked_ratio: normalizeMetric(
      Number(metrics.staked_ratio),
      state.normalization_bounds.staked_ratio
    ),
    active_users: normalizeMetric(
      Number(metrics.active_users_30d),
      state.normalization_bounds.active_users
    ),
    liquid_supply_ratio: normalizeMetric(
      Number(metrics.liquid_supply_ratio),
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
  const rawIndex = calculateRawIndex(normalizedMetrics, weights, supplyPressure);

  // 6. Apply EMA smoothing
  const smoothedIndex = applyEMASmoothing(
    rawIndex,
    state.previous_smoothed_index,
    state.alpha
  );

  // 7. Convert to display value
  const displayValueUsd = state.base_utility_value * smoothedIndex;

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
    throw new Error(`Failed to store index history: ${insertError.message}`);
  }

  // 9. Update state
  await supabase
    .from('pip_utility_index_state')
    .update({
      last_computed_date: dateStr,
      previous_smoothed_index: smoothedIndex,
      updated_at: new Date().toISOString()
    })
    .eq('id', 1);

  console.log('PIP Utility Index computed successfully', {
    date: dateStr,
    raw_index: rawIndex,
    smoothed_index: smoothedIndex,
    display_value_usd: displayValueUsd
  });

  return {
    date: dateStr,
    raw_index: rawIndex,
    smoothed_index: smoothedIndex,
    display_value_usd: displayValueUsd
  };
}

/**
 * Scheduled handler (runs daily at 00:00 UTC)
 */
const scheduledHandler: Handler = async (event, context) => {
  console.log('Daily PIP Utility Index computation started');

  try {
    const result = await computeDailyIndex();

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'PIP Utility Index computed successfully',
        result
      })
    };
  } catch (error: any) {
    console.error('Failed to compute daily PIP Utility Index', error);

    // Log error for admin monitoring
    await supabase
      .from('governance_alerts')
      .insert({
        alert_type: 'pip_index_computation_error',
        severity: 'high',
        message: `Failed to compute daily PIP Utility Index: ${error.message}`,
        metadata: {
          error: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString()
        }
      })
      .catch(err => console.error('Failed to log error alert', err));

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};

/**
 * Manual trigger handler (for testing and admin use)
 */
const manualHandler: Handler = async (event, context) => {
  console.log('Manual PIP Utility Index computation triggered');

  try {
    const result = await computeDailyIndex();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        message: 'PIP Utility Index computed successfully',
        result
      })
    };
  } catch (error: any) {
    console.error('Failed to compute PIP Utility Index', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};

// Schedule: Daily at 00:00 UTC
export const handler = schedule('0 0 * * *', scheduledHandler);

// Also export manual handler for on-demand execution
export { manualHandler };
