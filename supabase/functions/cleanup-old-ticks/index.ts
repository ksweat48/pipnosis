import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('🧹 Starting tick data cleanup job...');

    const { data, error } = await supabase.rpc('cleanup_old_realtime_prices');

    if (error) {
      throw new Error(`Cleanup failed: ${error.message}`);
    }

    const result = Array.isArray(data) && data.length > 0 ? data[0] : data;
    const deletedCount = result?.deleted_count || 0;
    const oldestKept = result?.oldest_kept;
    const newestKept = result?.newest_kept;

    console.log(`✅ Cleanup complete: ${deletedCount} old ticks removed`);
    console.log(`📊 Remaining data range: ${oldestKept} to ${newestKept}`);

    await supabase.from('candle_aggregation_log').insert({
      executed_at: new Date().toISOString(),
      status: 'success',
      ticks_processed: 0,
      candles_created: 0,
      symbols_processed: 0,
      duration_ms: Date.now() - startTime,
      message: `Cleanup: ${deletedCount} old ticks removed. Data range: ${oldestKept} to ${newestKept}`
    });

    return new Response(
      JSON.stringify({
        message: 'Tick cleanup completed',
        deletedCount,
        oldestKept,
        newestKept,
        duration: Date.now() - startTime
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('❌ Cleanup job failed:', error);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    await supabase.from('candle_aggregation_log').insert({
      executed_at: new Date().toISOString(),
      status: 'error',
      ticks_processed: 0,
      candles_created: 0,
      symbols_processed: 0,
      duration_ms: Date.now() - startTime,
      error_message: error instanceof Error ? error.message : 'Unknown error',
      message: 'Tick cleanup failed'
    });

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});