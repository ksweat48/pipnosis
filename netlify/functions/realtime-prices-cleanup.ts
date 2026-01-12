/**
 * Realtime Prices Cleanup
 *
 * Scheduled function that runs every hour to clean up old price data.
 * Prevents the realtime_prices table from accumulating stale data.
 *
 * CRITICAL: This must run regularly to prevent "Price data is XXXXXs old" errors
 */

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export const handler: Handler = async (event, context) => {
  const executionId = `cleanup_${Date.now()}`;
  const startTime = Date.now();

  console.log(`[PriceCleanup:${executionId}] Starting realtime_prices cleanup...`);

  try {
    // Call the batched cleanup function that deletes data older than 24 hours
    const { data, error } = await supabase.rpc('cleanup_old_realtime_prices_batch', {
      batch_size: 10000
    });

    if (error) {
      console.error(`[PriceCleanup:${executionId}] ❌ Cleanup function error:`, error);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          executionId,
          error: error.message,
          timestamp: new Date().toISOString()
        })
      };
    }

    const recordsDeleted = data || 0;
    const duration = Date.now() - startTime;

    console.log(`[PriceCleanup:${executionId}] ✅ Cleanup complete:`);
    console.log(`[PriceCleanup:${executionId}]   - Records deleted: ${recordsDeleted}`);
    console.log(`[PriceCleanup:${executionId}]   - Duration: ${duration}ms`);

    // Get current table stats
    const { data: stats, error: statsError } = await supabase
      .from('realtime_prices')
      .select('symbol, created_at', { count: 'exact', head: false })
      .order('created_at', { ascending: false })
      .limit(1);

    let tableStats = {};
    if (!statsError && stats && stats.length > 0) {
      const newestPrice = stats[0];
      const ageSeconds = Math.floor((Date.now() - new Date(newestPrice.created_at).getTime()) / 1000);

      tableStats = {
        newestPrice: newestPrice.created_at,
        newestPriceAgeSeconds: ageSeconds,
        symbol: newestPrice.symbol
      };

      console.log(`[PriceCleanup:${executionId}]   - Newest price: ${newestPrice.created_at} (${ageSeconds}s old)`);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        executionId,
        recordsDeleted,
        durationMs: duration,
        tableStats,
        timestamp: new Date().toISOString()
      })
    };
  } catch (error) {
    console.error(`[PriceCleanup:${executionId}] ❌ Unexpected error:`, error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        executionId,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      })
    };
  }
};
