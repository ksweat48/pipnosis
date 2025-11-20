import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const FOREX_SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];

const TIMEFRAMES = [
  { name: 'M1', minutes: 1, maxDaysBack: 30 },
  { name: 'M5', minutes: 5, maxDaysBack: 60 },
  { name: 'M15', minutes: 15, maxDaysBack: 90 },
  { name: 'M30', minutes: 30, maxDaysBack: 120 },
  { name: 'H1', minutes: 60, maxDaysBack: 180 },
  { name: 'H4', minutes: 240, maxDaysBack: 365 },
  { name: 'D1', minutes: 1440, maxDaysBack: 730 },
  { name: 'W1', minutes: 10080, maxDaysBack: 1825 }
];

interface MetaApiCandle {
  symbol: string;
  timeframe: string;
  time: string;
  brokerTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number;
  spread: number;
  volume: number;
}

interface BackfillProgress {
  symbol: string;
  timeframe: string;
  totalCandles: number;
  oldestCandle: string | null;
  newestCandle: string | null;
  complete: boolean;
  errors: string[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  const startTime = Date.now();

  try {
    console.log('🚀 Starting comprehensive historical backfill...');

    const metaapiToken = Deno.env.get('METAAPI_TOKEN');
    const metaapiAccountId = Deno.env.get('METAAPI_ACCOUNT_ID');
    const metaapiRegion = Deno.env.get('METAAPI_REGION') || 'london';

    if (!metaapiToken || !metaapiAccountId) {
      throw new Error('MetaAPI credentials not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const specificSymbol = url.searchParams.get('symbol');
    const specificTimeframe = url.searchParams.get('timeframe');

    const symbolsToProcess = specificSymbol ? [specificSymbol] : FOREX_SYMBOLS;
    const timeframesToProcess = specificTimeframe
      ? TIMEFRAMES.filter(tf => tf.name.toUpperCase() === specificTimeframe.toUpperCase())
      : TIMEFRAMES;

    console.log(`📊 Processing ${symbolsToProcess.length} symbols × ${timeframesToProcess.length} timeframes`);
    console.log(`Symbols: ${symbolsToProcess.join(', ')}`);
    console.log(`Timeframes: ${timeframesToProcess.map(tf => tf.name).join(', ')}`);

    const results: BackfillProgress[] = [];
    let totalCandlesProcessed = 0;

    for (const symbol of symbolsToProcess) {
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📈 Processing symbol: ${symbol}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      for (const timeframe of timeframesToProcess) {
        const progress: BackfillProgress = {
          symbol,
          timeframe: timeframe.name,
          totalCandles: 0,
          oldestCandle: null,
          newestCandle: null,
          complete: false,
          errors: []
        };

        try {
          console.log(`\n  ⏳ Processing ${timeframe.name} (max ${timeframe.maxDaysBack} days back)...`);

          // Check what we already have in the database
          const { data: existingRange } = await supabase
            .from('forex_candles')
            .select('open_time')
            .eq('symbol', symbol)
            .eq('timeframe', timeframe.name)
            .order('open_time', { ascending: true })
            .limit(1);

          const { data: latestCandle } = await supabase
            .from('forex_candles')
            .select('open_time')
            .eq('symbol', symbol)
            .eq('timeframe', timeframe.name)
            .order('open_time', { ascending: false })
            .limit(1);

          const oldestExisting = existingRange?.[0]?.open_time;
          const newestExisting = latestCandle?.[0]?.open_time;

          if (oldestExisting) {
            console.log(`    📅 Existing data: ${oldestExisting} to ${newestExisting}`);
          } else {
            console.log(`    📅 No existing data found`);
          }

          // Determine the start date for backfill
          const now = new Date();
          const maxStartDate = new Date(now.getTime() - timeframe.maxDaysBack * 24 * 60 * 60 * 1000);

          let currentStartDate = oldestExisting
            ? new Date(new Date(oldestExisting).getTime() - 30 * 24 * 60 * 60 * 1000)
            : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

          // Don't go back further than the max days for this timeframe
          if (currentStartDate < maxStartDate) {
            currentStartDate = maxStartDate;
          }

          console.log(`    🎯 Backfilling from: ${currentStartDate.toISOString()}`);

          let batchCount = 0;
          let totalFetched = 0;
          let reachedEnd = false;

          // Backfill in batches moving backwards in time
          while (!reachedEnd && batchCount < 20) {
            batchCount++;

            const endTime = new Date(currentStartDate.getTime() + 30 * 24 * 60 * 60 * 1000);

            console.log(`    📦 Batch ${batchCount}: ${currentStartDate.toISOString().split('T')[0]} to ${endTime.toISOString().split('T')[0]}`);

            try {
              const candles = await fetchMetaApiCandles(
                metaapiToken,
                metaapiAccountId,
                metaapiRegion,
                symbol,
                timeframe.name,
                currentStartDate,
                endTime
              );

              if (candles.length === 0) {
                console.log(`      ⚠️ No candles returned, reached end of available data`);
                reachedEnd = true;
                break;
              }

              const transformedCandles = candles.map(candle => ({
                symbol: candle.symbol,
                timeframe: candle.timeframe,
                open_time: candle.time,
                close_time: new Date(
                  new Date(candle.time).getTime() + timeframe.minutes * 60000
                ).toISOString(),
                open: parseFloat(String(candle.open)),
                high: parseFloat(String(candle.high)),
                low: parseFloat(String(candle.low)),
                close: parseFloat(String(candle.close)),
                volume: parseFloat(String(candle.tickVolume || 0)),
                tick_count: 1,
                data_source: 'backfill',
                candle_status: 'backfilled',
                completion_score: 90
              }));

              const { error } = await supabase
                .from('forex_candles')
                .upsert(transformedCandles, {
                  onConflict: 'symbol,timeframe,open_time',
                  ignoreDuplicates: true
                });

              if (error) {
                progress.errors.push(`Batch ${batchCount}: ${error.message}`);
                console.error(`      ❌ Error saving batch: ${error.message}`);
              } else {
                totalFetched += candles.length;
                console.log(`      ✅ Saved ${candles.length} candles`);
              }

              // Move back another 30 days
              currentStartDate = new Date(currentStartDate.getTime() - 30 * 24 * 60 * 60 * 1000);

              // Don't go back further than the max
              if (currentStartDate < maxStartDate) {
                console.log(`      📍 Reached maximum backfill depth (${timeframe.maxDaysBack} days)`);
                reachedEnd = true;
              }

              // Rate limiting
              await new Promise(resolve => setTimeout(resolve, 500));

            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              progress.errors.push(`Batch ${batchCount}: ${errorMessage}`);
              console.error(`      ❌ Batch error: ${errorMessage}`);

              // If we get a 404, we've reached the end of available data
              if (errorMessage.includes('404')) {
                reachedEnd = true;
              }
            }
          }

          // Now fill forward to present
          console.log(`    ⏩ Filling forward to present...`);

          const { data: currentLatest } = await supabase
            .from('forex_candles')
            .select('open_time')
            .eq('symbol', symbol)
            .eq('timeframe', timeframe.name)
            .order('open_time', { ascending: false })
            .limit(1);

          if (currentLatest?.[0]) {
            const latestTime = new Date(currentLatest[0].open_time);
            const forwardCandles = await fetchMetaApiCandles(
              metaapiToken,
              metaapiAccountId,
              metaapiRegion,
              symbol,
              timeframe.name,
              latestTime,
              now
            );

            if (forwardCandles.length > 0) {
              const transformedForward = forwardCandles.map(candle => ({
                symbol: candle.symbol,
                timeframe: candle.timeframe,
                open_time: candle.time,
                close_time: new Date(
                  new Date(candle.time).getTime() + timeframe.minutes * 60000
                ).toISOString(),
                open: parseFloat(String(candle.open)),
                high: parseFloat(String(candle.high)),
                low: parseFloat(String(candle.low)),
                close: parseFloat(String(candle.close)),
                volume: parseFloat(String(candle.tickVolume || 0)),
                tick_count: 1,
                data_source: 'metaapi',
                candle_status: 'complete',
                completion_score: 100
              }));

              const { error } = await supabase
                .from('forex_candles')
                .upsert(transformedForward, {
                  onConflict: 'symbol,timeframe,open_time',
                  ignoreDuplicates: false
                });

              if (!error) {
                totalFetched += forwardCandles.length;
                console.log(`      ✅ Added ${forwardCandles.length} recent candles`);
              }
            }
          }

          progress.totalCandles = totalFetched;
          progress.complete = true;

          // Get final stats
          const { data: finalStats } = await supabase
            .from('forex_candles')
            .select('open_time')
            .eq('symbol', symbol)
            .eq('timeframe', timeframe.name)
            .order('open_time');

          if (finalStats && finalStats.length > 0) {
            progress.oldestCandle = finalStats[0].open_time;
            progress.newestCandle = finalStats[finalStats.length - 1].open_time;
            progress.totalCandles = finalStats.length;
          }

          totalCandlesProcessed += progress.totalCandles;

          console.log(`  ✅ ${symbol} ${timeframe.name} complete: ${progress.totalCandles} candles`);
          console.log(`     Range: ${progress.oldestCandle?.split('T')[0]} to ${progress.newestCandle?.split('T')[0]}`);

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          progress.errors.push(errorMessage);
          console.error(`  ❌ ${symbol} ${timeframe.name} failed: ${errorMessage}`);
        }

        results.push(progress);
      }
    }

    const duration = Date.now() - startTime;
    const summary = {
      success: true,
      message: 'Comprehensive backfill completed',
      symbolsProcessed: symbolsToProcess.length,
      timeframesProcessed: timeframesToProcess.length,
      totalCandlesProcessed,
      durationMs: duration,
      durationMinutes: (duration / 60000).toFixed(2),
      results
    };

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ COMPREHENSIVE BACKFILL COMPLETE!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📊 Total candles processed: ${totalCandlesProcessed}`);
    console.log(`⏱️ Duration: ${summary.durationMinutes} minutes`);
    console.log(`🎯 Success rate: ${results.filter(r => r.complete).length}/${results.length}`);

    return new Response(
      JSON.stringify(summary, null, 2),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('❌ Backfill job failed:', error);

    return new Response(
      JSON.stringify({
        success: false,
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

async function fetchMetaApiCandles(
  token: string,
  accountId: string,
  region: string,
  symbol: string,
  timeframe: string,
  startTime: Date,
  endTime: Date
): Promise<MetaApiCandle[]> {
  let url = `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}/historical-market-data/symbols/${symbol}/timeframes/${timeframe}/candles?startTime=${startTime.toISOString()}&endTime=${endTime.toISOString()}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'auth-token': token,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MetaAPI error (${response.status}): ${errorText}`);
  }

  const candles = await response.json();

  if (!Array.isArray(candles)) {
    throw new Error('Invalid candle data from MetaAPI');
  }

  return candles;
}
