import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

/**
 * Dukascopy Historical Data Backfill Service
 *
 * Fetches historical OHLC candle data from Dukascopy's free API
 * and overwrites existing candles in forex_candles table.
 *
 * Features:
 * - Free, no API key required
 * - Historical data from 1990s to present
 * - Supports multiple timeframes
 * - Batch processing with progress tracking
 * - Complete overwrite mode (replaces all existing candles)
 */

type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1';

const TIMEFRAME_MAP: Record<Timeframe, { dukascopyCode: string; minutes: number }> = {
  M1: { dukascopyCode: '1min', minutes: 1 },
  M5: { dukascopyCode: '5min', minutes: 5 },
  M15: { dukascopyCode: '15min', minutes: 15 },
  M30: { dukascopyCode: '30min', minutes: 30 },
  H1: { dukascopyCode: '1hour', minutes: 60 },
  H4: { dukascopyCode: '4hour', minutes: 240 },
  D1: { dukascopyCode: '1day', minutes: 1440 },
};

const DUKASCOPY_SYMBOL_MAP: Record<string, string> = {
  'EURUSD': 'eurusd',
  'GBPUSD': 'gbpusd',
  'USDJPY': 'usdjpy',
  'XAUUSD': 'xauusd',
  'US30': 'us30',
  'GBPJPY': 'gbpjpy',
  'EURJPY': 'eurjpy',
  'AUDUSD': 'audusd',
  'NZDUSD': 'nzdusd',
};

interface DukascopyCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface BackfillProgress {
  symbol: string;
  timeframe: Timeframe;
  status: 'pending' | 'fetching' | 'saving' | 'completed' | 'error';
  candlesFetched: number;
  candlesSaved: number;
  candlesDeleted: number;
  error?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    console.log('🚀 Starting Dukascopy historical backfill...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const specificSymbol = url.searchParams.get('symbol');
    const specificTimeframe = url.searchParams.get('timeframe') as Timeframe | null;
    const daysBack = parseInt(url.searchParams.get('days') || '30', 10);
    const overwrite = url.searchParams.get('overwrite') !== 'false';

    const symbolsToProcess = specificSymbol
      ? [specificSymbol]
      : Object.keys(DUKASCOPY_SYMBOL_MAP);

    const timeframesToProcess = specificTimeframe
      ? [specificTimeframe]
      : (['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'] as Timeframe[]);

    console.log(`📊 Backfilling ${symbolsToProcess.length} symbols × ${timeframesToProcess.length} timeframes`);
    console.log(`📅 Days back: ${daysBack}`);
    console.log(`♻️ Overwrite mode: ${overwrite ? 'ON (will replace existing candles)' : 'OFF (append only)'}`);

    const batchId = crypto.randomUUID();
    console.log(`🆔 Batch ID: ${batchId}`);

    const results: BackfillProgress[] = [];
    let totalFetched = 0;
    let totalSaved = 0;
    let totalDeleted = 0;

    for (const symbol of symbolsToProcess) {
      for (const timeframe of timeframesToProcess) {
        const progress: BackfillProgress = {
          symbol,
          timeframe,
          status: 'pending',
          candlesFetched: 0,
          candlesSaved: 0,
          candlesDeleted: 0,
        };

        try {
          console.log(`\n📈 Processing ${symbol} ${timeframe}...`);
          progress.status = 'fetching';

          const candles = await fetchDukascopyHistoricalData(
            symbol,
            timeframe,
            daysBack
          );

          progress.candlesFetched = candles.length;
          totalFetched += candles.length;

          if (candles.length === 0) {
            console.log(`  ⚠️ No candles returned from Dukascopy for ${symbol} ${timeframe}`);
            progress.status = 'completed';
            results.push(progress);
            continue;
          }

          console.log(`  ✓ Fetched ${candles.length} candles from Dukascopy`);
          progress.status = 'saving';

          if (overwrite) {
            const { count, error: deleteError } = await supabase
              .from('forex_candles')
              .delete({ count: 'exact' })
              .eq('symbol', symbol)
              .eq('timeframe', timeframe);

            if (deleteError) {
              throw new Error(`Failed to delete existing candles: ${deleteError.message}`);
            }

            progress.candlesDeleted = count || 0;
            totalDeleted += count || 0;
            console.log(`  🗑️ Deleted ${count || 0} existing candles`);
          }

          const transformedCandles = candles.map(candle => {
            const openTime = new Date(candle.timestamp);
            const closeTime = new Date(candle.timestamp + TIMEFRAME_MAP[timeframe].minutes * 60000);

            return {
              symbol,
              timeframe,
              open_time: openTime.toISOString(),
              close_time: closeTime.toISOString(),
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume || 0,
              data_source: 'dukascopy',
              quality_score: 100,
              is_backfilled: true,
              backfill_batch_id: batchId,
              backfill_timestamp: new Date().toISOString(),
            };
          });

          const BATCH_SIZE = 1000;
          let savedCount = 0;

          for (let i = 0; i < transformedCandles.length; i += BATCH_SIZE) {
            const batch = transformedCandles.slice(i, i + BATCH_SIZE);

            // CCIP FIX: Use upsert instead of insert to handle duplicates
            // This prevents 409 Conflict errors when backfilling overlapping timeframes
            const { error: insertError } = await supabase
              .from('forex_candles')
              .upsert(batch, {
                onConflict: 'symbol,timeframe,open_time',
                ignoreDuplicates: true
              });

            if (insertError) {
              throw new Error(`Failed to upsert batch: ${insertError.message}`);
            }

            savedCount += batch.length;
            console.log(`  💾 Saved ${savedCount}/${transformedCandles.length} candles...`);
          }

          progress.candlesSaved = savedCount;
          totalSaved += savedCount;
          progress.status = 'completed';

          console.log(`  ✅ ${symbol} ${timeframe}: ${savedCount} candles saved`);

        } catch (error) {
          progress.status = 'error';
          progress.error = error instanceof Error ? error.message : 'Unknown error';
          console.error(`  ❌ ${symbol} ${timeframe}: ${progress.error}`);
        }

        results.push(progress);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    const duration = Date.now() - startTime;
    const summary = {
      success: true,
      message: 'Dukascopy historical backfill completed',
      batchId,
      daysBackfilled: daysBack,
      overwriteMode: overwrite,
      symbolsProcessed: symbolsToProcess.length,
      timeframesProcessed: timeframesToProcess.length,
      totalCandlesFetched: totalFetched,
      totalCandlesSaved: totalSaved,
      totalCandlesDeleted: totalDeleted,
      durationMs: duration,
      durationMinutes: (duration / 60000).toFixed(2),
      results,
    };

    console.log('\n✅ Backfill complete!');
    console.log(`📊 Total candles fetched: ${totalFetched}`);
    console.log(`💾 Total candles saved: ${totalSaved}`);
    console.log(`🗑️ Total candles deleted: ${totalDeleted}`);
    console.log(`⏱️ Duration: ${summary.durationMinutes} minutes`);

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Backfill failed:', error);

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

async function fetchDukascopyHistoricalData(
  symbol: string,
  timeframe: Timeframe,
  daysBack: number
): Promise<DukascopyCandle[]> {
  const dukascopySymbol = DUKASCOPY_SYMBOL_MAP[symbol];
  if (!dukascopySymbol) {
    throw new Error(`Symbol ${symbol} not supported by Dukascopy`);
  }

  const timeframeConfig = TIMEFRAME_MAP[timeframe];
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  const jsonUrl = `https://freeserv.dukascopy.com/2.0/index.php?path=chart%2F${dukascopySymbol}%2F${timeframeConfig.dukascopyCode}&format=json&start=${Math.floor(startDate.getTime())}&end=${Math.floor(endDate.getTime())}`;

  console.log(`  📡 Fetching from Dukascopy: ${dukascopySymbol} ${timeframeConfig.dukascopyCode}`);

  try {
    const response = await fetch(jsonUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PipnosisBot/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`Dukascopy API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      return [];
    }

    const candles: DukascopyCandle[] = data.map((item: any[]) => ({
      timestamp: item[0],
      open: item[1],
      high: item[2],
      low: item[3],
      close: item[4],
      volume: item[5] || 0,
    }));

    return candles;

  } catch (error) {
    console.error(`  ❌ Dukascopy fetch error:`, error);
    throw error;
  }
}