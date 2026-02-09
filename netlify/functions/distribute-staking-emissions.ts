/**
 * Daily Staking Emissions Distribution
 *
 * Scheduled to run daily at midnight UTC via Netlify scheduled function
 * Distributes PIP rewards to active stakers using roll-forward emission model
 *
 * Roll-Forward Model:
 * - Base daily emission + carryover from previous day
 * - If no active stakers, full emission rolls to carryover (no burning)
 * - Any rounding remainder rolls to carryover
 * - Idempotent - safe to run multiple times per day
 */

import { Handler, schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const handler: Handler = async (event) => {
  console.log('[EmissionDistribution] Starting daily emission distribution');

  try {
    const { data, error } = await supabase.rpc('distribute_staking_emissions_v2');

    if (error) {
      console.error('[EmissionDistribution] RPC error:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({
          success: false,
          error: error.message,
          timestamp: new Date().toISOString(),
        }),
      };
    }

    if (!data?.success) {
      console.warn('[EmissionDistribution] Distribution not completed:', data?.error || data?.reason);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: false,
          reason: data?.error || data?.reason,
          timestamp: new Date().toISOString(),
        }),
      };
    }

    console.log('[EmissionDistribution] Distribution successful:', {
      runId: data.run_id,
      distributed: data.distributed,
      stakerCount: data.staker_count,
      carryover: data.carryover_out,
      poolRemaining: data.pool_remaining,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        runId: data.run_id,
        dailyEmission: data.daily_emission,
        distributed: data.distributed,
        carryover: data.carryover_out,
        stakerCount: data.staker_count,
        poolRemaining: data.pool_remaining,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error: any) {
    console.error('[EmissionDistribution] Exception:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Internal error',
        timestamp: new Date().toISOString(),
      }),
    };
  }
};

// Schedule to run daily at midnight UTC
export const config = {
  schedule: '@daily',
};

export { handler };
