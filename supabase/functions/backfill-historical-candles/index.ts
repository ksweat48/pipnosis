import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const FOREX_SYMBOLS = [
  'XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF',
  'AUDUSD', 'USDCAD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY'
];

const TIMEFRAMES = [
  { name: 'M1', minutes: 1 },
  { name: 'M5', minutes: 5 },
  { name: 'M15', minutes: 15 },
  { name: 'M30', minutes: 30 },
  { name: 'H1', minutes: 60 },
  { name: 'H4', minutes: 240 },
  { name: 'D1', minutes: 1440 }
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

interface BackfillResult {
  symbol: string;
  timeframe: string;
  candlesFetched: number;
  candlesSaved: number;
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
    console.log('🚀 Starting historical candle backfill...');

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
    const daysBack = parseInt(url.searchParams.get('days') || '30', 10);

    const symbolsToFetch = specificSymbol ? [specificSymbol] : FOREX_SYMBOLS;
    const timeframesToFetch = specificTimeframe
      ? TIMEFRAMES.filter(tf => tf.name === specificTimeframe)
      : TIMEFRAMES;

    console.log(`📊 Backfilling ${daysBack} days of data for ${symbolsToFetch.length} symbols and ${timeframesToFetch.length} timeframes`);

    const results: BackfillResult[] = [];
    let totalCandlesFetched = 0;
    let totalCandlesSaved = 0;
    let totalErrors = 0;

    for (const symbol of symbolsToFetch) {
      console.log(`\n📈 Processing symbol: ${symbol}`);

      for (const timeframe of timeframesToFetch) {
        const result: BackfillResult = {
          symbol,
          timeframe: timeframe.name,
          candlesFetched: 0,
          candlesSaved: 0,
          errors: []
        };

        try {
          console.log(`  ⏳ Fetching ${timeframe.name} candles...`);

          const candles = await fetchMetaApiCandles(
            metaapiToken,
            metaapiAccountId,
            metaapiRegion,
            symbol,
            timeframe.name,
            daysBack
          );

          result.candlesFetched = candles.length;
          totalCandlesFetched += candles.length;

          if (candles.length > 0) {
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
              tick_count: 1
            }));

            const savedCount = await saveCandlesToDatabase(
              supabase,
              transformedCandles,
              result
            );

            result.candlesSaved = savedCount;
            totalCandlesSaved += savedCount;

            console.log(`  ✅ ${symbol} ${timeframe.name}: ${savedCount}/${candles.length} candles saved`);
          } else {
            console.log(`  ⚠️ ${symbol} ${timeframe.name}: No candles returned from MetaAPI`);
          }

          await new Promise(resolve => setTimeout(resolve, 200));

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          result.errors.push(errorMessage);
          totalErrors++;
          console.error(`  ❌ ${symbol} ${timeframe.name}: ${errorMessage}`);
        }

        results.push(result);
      }
    }

    const duration = Date.now() - startTime;
    const summary = {
      success: true,
      message: 'Historical candle backfill completed',
      daysBackfilled: daysBack,
      symbolsProcessed: symbolsToFetch.length,
      timeframesProcessed: timeframesToFetch.length,
      totalCandlesFetched,
      totalCandlesSaved,
      totalErrors,
      durationMs: duration,
      durationMinutes: (duration / 60000).toFixed(2),
      results
    };

    console.log('\n✅ Backfill complete!');
    console.log(`📊 Total candles fetched: ${totalCandlesFetched}`);
    console.log(`💾 Total candles saved: ${totalCandlesSaved}`);
    console.log(`⏱️ Duration: ${summary.durationMinutes} minutes`);
    console.log(`❌ Errors: ${totalErrors}`);

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
  daysBack: number
): Promise<MetaApiCandle[]> {
  const startTime = new Date();
  startTime.setDate(startTime.getDate() - daysBack);

  const url = `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}/historical-market-data/symbols/${symbol}/timeframes/${timeframe}/candles?startTime=${startTime.toISOString()}`;

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

async function saveCandlesToDatabase(
  supabase: any,
  candles: any[],
  result: BackfillResult
): Promise<number> {
  let savedCount = 0;

  const { error: forexError } = await supabase
    .from('forex_candles')
    .upsert(candles, {
      onConflict: 'symbol,timeframe,open_time',
      ignoreDuplicates: false
    });

  if (forexError) {
    result.errors.push(`forex_candles: ${forexError.message}`);
  } else {
    savedCount = candles.length;
  }

  const marketDataCandles = candles.map(c => ({
    symbol: c.symbol,
    timeframe: c.timeframe,
    timestamp: c.open_time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume
  }));

  const { error: marketDataError } = await supabase
    .from('market_data')
    .upsert(marketDataCandles, {
      onConflict: 'symbol,timeframe,timestamp',
      ignoreDuplicates: false
    });

  if (marketDataError) {
    result.errors.push(`market_data: ${marketDataError.message}`);
  }

  return savedCount;
}
