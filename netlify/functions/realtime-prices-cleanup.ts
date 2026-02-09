import type { Handler } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase-admin';

const supabase = getSupabaseAdmin();

export const handler: Handler = async () => {
  const executionId = `cleanup_${Date.now()}`;
  const startTime = Date.now();

  console.log(`[Cleanup:${executionId}] Starting hourly data cleanup...`);

  try {
    const { data: priceResult, error: priceError } = await supabase.rpc(
      'cleanup_old_realtime_prices_batch',
      { batch_size: 10000 }
    );

    if (priceError) {
      console.error(`[Cleanup:${executionId}] Price cleanup error:`, priceError.message);
    } else {
      console.log(`[Cleanup:${executionId}] Price cleanup: ${priceResult || 0} rows deleted`);
    }

    const { data: logResult, error: logError } = await supabase.rpc(
      'cleanup_old_log_data_batched',
      { max_rows_per_table: 50000 }
    );

    if (logError) {
      console.error(`[Cleanup:${executionId}] Log cleanup error:`, logError.message);
    } else {
      console.log(`[Cleanup:${executionId}] Log cleanup results:`, JSON.stringify(logResult));

      if (logResult?.has_more) {
        console.log(`[Cleanup:${executionId}] More rows to clean - will continue next hour`);
      }
    }

    const duration = Date.now() - startTime;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        executionId,
        priceRecordsDeleted: priceResult || 0,
        logCleanupResults: logResult || {},
        durationMs: duration,
        timestamp: new Date().toISOString()
      })
    };
  } catch (error) {
    console.error(`[Cleanup:${executionId}] Unexpected error:`, error);
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
