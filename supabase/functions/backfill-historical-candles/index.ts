import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ALL_SYMBOLS = [
  'XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY', 'NAS100'
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
  time: string;
  brokerTime?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume?: number;
  volume?: number;
}

interface BackfillResult {
  symbol: string;
  timeframe: string;
  candlesFetched: number;
  candlesSaved: number;
  error?: string;
}

async function fetchMetaApiCandles(
  token: string,
  accountId: string,
  region: string,
  symbol: string,
  timeframe: string,
  startTime: Date,
  endTime?: Date
): Promise<MetaApiCandle[]> {
  const domains = [
    `mt-client-api-v1.${region}.agiliumtrade.ai`,
    `mt-market-data-client-api-v1.${region}.agiliumtrade.ai`,
  ];

  const path = `/users/current/accounts/${accountId}/historical-market-data/symbols/${symbol}/timeframes/${timeframe}/candles`;

  for (const domain of domains) {
    let url = `https://${domain}${path}?startTime=${startTime.toISOString()}`;
    if (endTime) url += `&endTime=${endTime.toISOString()}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'auth-token': token,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(30000)
      });

      if (response.status === 404) {
        console.log(`[Backfill] 404 from ${domain} for ${symbol} ${timeframe}, trying next...`);
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        console.error(`[Backfill] ${domain} error ${response.status} for ${symbol} ${timeframe}: ${text}`);
        continue;
      }

      const data = await response.json();
      if (!Array.isArray(data)) {
        console.error(`[Backfill] Non-array response from ${domain} for ${symbol} ${timeframe}`);
        continue;
      }

      console.log(`[Backfill] Success from ${domain}: ${data.length} candles for ${symbol} ${timeframe}`);
      return data;
    } catch (err) {
      console.error(`[Backfill] Fetch error from ${domain} for ${symbol} ${timeframe}:`, err instanceof Error ? err.message : err);
    }
  }

  return [];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const startMs = Date.now();

  try {
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
    const daysBack = parseInt(url.searchParams.get('days') || '3', 10);

    const symbolsToFetch = specificSymbol ? [specificSymbol] : ALL_SYMBOLS;
    const timeframesToFetch = specificTimeframe
      ? TIMEFRAMES.filter(tf => tf.name === specificTimeframe)
      : TIMEFRAMES;

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - daysBack * 24 * 60 * 60 * 1000);

    console.log(`[Backfill] Starting: ${symbolsToFetch.length} symbols × ${timeframesToFetch.length} timeframes | ${daysBack} days back | region=${metaapiRegion}`);

    const results: BackfillResult[] = [];
    let totalFetched = 0;
    let totalSaved = 0;

    for (const symbol of symbolsToFetch) {
      for (const tf of timeframesToFetch) {
        const result: BackfillResult = {
          symbol,
          timeframe: tf.name,
          candlesFetched: 0,
          candlesSaved: 0,
        };

        try {
          const candles = await fetchMetaApiCandles(
            metaapiToken,
            metaapiAccountId,
            metaapiRegion,
            symbol,
            tf.name,
            startTime,
            endTime
          );

          result.candlesFetched = candles.length;
          totalFetched += candles.length;

          if (candles.length > 0) {
            const rows = candles
              .filter(c => c.open > 0 && c.high >= c.low && c.high > 0)
              .map(c => {
                const openTime = new Date(c.time);
                const closeTime = new Date(openTime.getTime() + tf.minutes * 60000);
                return {
                  symbol,
                  timeframe: tf.name,
                  open_time: openTime.toISOString(),
                  close_time: closeTime.toISOString(),
                  open: parseFloat(String(c.open)),
                  high: parseFloat(String(c.high)),
                  low: parseFloat(String(c.low)),
                  close: parseFloat(String(c.close)),
                  volume: parseFloat(String(c.tickVolume ?? c.volume ?? 0)),
                  tick_count: 1,
                  data_source: 'metaapi_backfill',
                  candle_status: 'confirmed',
                  quality_score: 95,
                };
              });

            if (rows.length > 0) {
              const { error } = await supabase
                .from('forex_candles')
                .upsert(rows, {
                  onConflict: 'symbol,timeframe,open_time',
                  ignoreDuplicates: false
                });

              if (error) {
                result.error = error.message;
                console.error(`[Backfill] DB error for ${symbol} ${tf.name}: ${error.message}`);
              } else {
                result.candlesSaved = rows.length;
                totalSaved += rows.length;
                console.log(`[Backfill] Saved ${rows.length} ${symbol} ${tf.name} candles`);
              }
            }
          }

          await new Promise(r => setTimeout(r, 150));
        } catch (err) {
          result.error = err instanceof Error ? err.message : 'Unknown error';
          console.error(`[Backfill] Error for ${symbol} ${tf.name}:`, result.error);
        }

        results.push(result);
      }

      await new Promise(r => setTimeout(r, 300));
    }

    const durationMs = Date.now() - startMs;

    console.log(`[Backfill] Complete: fetched=${totalFetched}, saved=${totalSaved}, duration=${(durationMs/1000).toFixed(1)}s`);

    return new Response(
      JSON.stringify({
        success: true,
        daysBack,
        symbolsProcessed: symbolsToFetch.length,
        timeframesProcessed: timeframesToFetch.length,
        totalFetched,
        totalSaved,
        durationMs,
        results
      }, null, 2),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[Backfill] Fatal error:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        durationMs: Date.now() - startMs
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
