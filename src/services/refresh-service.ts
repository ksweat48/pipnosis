import { createClient } from '@supabase/supabase-js';

/**
 * Serverless-compatible refresh service for Netlify functions
 * This service handles both single and batch refresh operations
 */

export interface RefreshRequest {
  symbol: string;
  timeframe: '5m' | '15m' | '1h';
  daysBack?: number;
  overwrite?: boolean;
}

export interface RefreshResult {
  success: boolean;
  symbol: string;
  timeframe: string;
  candlesFetched: number;
  candlesSaved: number;
  duration: number;
  error?: string;
}

export interface BatchRefreshResult {
  totalSchedules: number;
  successful: number;
  failed: number;
  results: RefreshResult[];
  duration: number;
}

/**
 * Initialize Supabase client with service role for server-side operations
 */
function getSupabaseClient() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase configuration. Ensure VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.');
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

/**
 * Performs a single refresh operation
 */
export async function refreshSingleSymbol(
  request: RefreshRequest
): Promise<RefreshResult> {
  const startTime = Date.now();
  const supabase = getSupabaseClient();

  try {
    const { symbol, timeframe, daysBack = 3, overwrite = true } = request;

    console.log(`Starting refresh for ${symbol} ${timeframe} (${daysBack} days)`);

    // Create history entry
    const { data: historyData, error: historyError } = await supabase
      .rpc('create_refresh_history_entry', {
        p_schedule_id: null,
        p_symbol: symbol,
        p_timeframe: timeframe,
        p_triggered_by: 'manual'
      });

    if (historyError) {
      console.error('Error creating history entry:', historyError);
    }

    const historyId = historyData as unknown as string;

    // Import and call the fetch function dynamically
    // Note: In serverless environment, we need to use dynamic import
    const { fetchHistoricalCandles } = await import('./fetchHistoricalCandles');

    const result = await fetchHistoricalCandles({
      symbol,
      timeframe,
      daysBack,
      overwrite
    });

    // Complete history entry
    if (historyId) {
      await supabase.rpc('complete_refresh_history_entry', {
        p_history_id: historyId,
        p_candles_fetched: result.candlesFetched,
        p_candles_saved: result.candlesSaved,
        p_status: result.success ? 'completed' : 'failed',
        p_error_message: result.error || null
      });
    }

    const duration = Date.now() - startTime;

    return {
      success: result.success,
      symbol,
      timeframe,
      candlesFetched: result.candlesFetched,
      candlesSaved: result.candlesSaved,
      duration,
      error: result.error
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    console.error(`Refresh failed for ${request.symbol} ${request.timeframe}:`, errorMessage);

    return {
      success: false,
      symbol: request.symbol,
      timeframe: request.timeframe,
      candlesFetched: 0,
      candlesSaved: 0,
      duration,
      error: errorMessage
    };
  }
}

/**
 * Performs batch refresh of all active schedules
 */
export async function refreshBatchSchedules(): Promise<BatchRefreshResult> {
  const startTime = Date.now();
  const supabase = getSupabaseClient();
  const results: RefreshResult[] = [];

  try {
    console.log('Starting batch refresh...');

    // Get all active schedules
    const { data: schedules, error: schedulesError } = await supabase
      .rpc('get_active_refresh_schedules');

    if (schedulesError) {
      throw new Error(`Failed to get active schedules: ${schedulesError.message}`);
    }

    if (!schedules || schedules.length === 0) {
      console.log('No active schedules found');
      return {
        totalSchedules: 0,
        successful: 0,
        failed: 0,
        results: [],
        duration: Date.now() - startTime
      };
    }

    console.log(`Found ${schedules.length} active schedules`);

    // Process each schedule
    for (const schedule of schedules) {
      const scheduleId = schedule.id;
      const symbol = schedule.symbol;
      const timeframe = schedule.timeframe as '5m' | '15m' | '1h';
      const daysBack = schedule.days_back;

      console.log(`Processing: ${symbol} ${timeframe}`);

      // Create history entry
      const { data: historyData } = await supabase
        .rpc('create_refresh_history_entry', {
          p_schedule_id: scheduleId,
          p_symbol: symbol,
          p_timeframe: timeframe,
          p_triggered_by: 'scheduled'
        });

      const historyId = historyData as unknown as string;

      try {
        // Import and call the fetch function
        const { fetchHistoricalCandles } = await import('./fetchHistoricalCandles');

        const result = await fetchHistoricalCandles({
          symbol,
          timeframe,
          daysBack,
          overwrite: true
        });

        // Complete history entry
        if (historyId) {
          await supabase.rpc('complete_refresh_history_entry', {
            p_history_id: historyId,
            p_candles_fetched: result.candlesFetched,
            p_candles_saved: result.candlesSaved,
            p_status: result.success ? 'completed' : 'failed',
            p_error_message: result.error || null
          });
        }

        // Update schedule
        await supabase.rpc('update_schedule_after_run', {
          p_schedule_id: scheduleId,
          p_next_run_interval: '1 day'
        });

        results.push({
          success: result.success,
          symbol,
          timeframe,
          candlesFetched: result.candlesFetched,
          candlesSaved: result.candlesSaved,
          duration: result.duration,
          error: result.error
        });

        console.log(`✓ ${symbol} ${timeframe}: ${result.candlesSaved} candles saved`);

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // Complete history entry with error
        if (historyId) {
          await supabase.rpc('complete_refresh_history_entry', {
            p_history_id: historyId,
            p_candles_fetched: 0,
            p_candles_saved: 0,
            p_status: 'failed',
            p_error_message: errorMessage
          });
        }

        results.push({
          success: false,
          symbol,
          timeframe,
          candlesFetched: 0,
          candlesSaved: 0,
          duration: 0,
          error: errorMessage
        });

        console.error(`✗ ${symbol} ${timeframe}: ${errorMessage}`);
      }

      // Small delay between schedules
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const duration = Date.now() - startTime;

    console.log(`Batch refresh completed: ${successful} successful, ${failed} failed`);

    return {
      totalSchedules: schedules.length,
      successful,
      failed,
      results,
      duration
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    console.error('Batch refresh failed:', errorMessage);

    return {
      totalSchedules: 0,
      successful: 0,
      failed: results.length,
      results,
      duration
    };
  }
}

/**
 * Get refresh history
 */
export async function getRefreshHistory(
  symbol?: string,
  timeframe?: string,
  status?: string,
  limit: number = 100
) {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .rpc('get_refresh_history', {
      p_symbol: symbol || null,
      p_timeframe: timeframe || null,
      p_status: status || null,
      p_limit: limit
    });

  if (error) {
    throw new Error(`Failed to get refresh history: ${error.message}`);
  }

  return data;
}
