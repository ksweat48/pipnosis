import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ALL_FOREX_SYMBOLS = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30', 'NAS100', 'SPX500'];

const FINNHUB_SYMBOL_MAP: Record<string, string> = {
  'EURUSD': 'OANDA:EUR_USD',
  'GBPUSD': 'OANDA:GBP_USD',
  'USDJPY': 'OANDA:USD_JPY',
  'XAUUSD': 'OANDA:XAU_USD',
  'US30': 'OANDA:US30_USD',
  'NAS100': 'OANDA:NAS100_USD',
  'SPX500': 'OANDA:SPX500_USD',
};

const TIMEFRAMES = [
  { name: 'M5', resolution: '5', minutes: 5 },
  { name: 'M15', resolution: '15', minutes: 15 },
  { name: 'M30', resolution: '30', minutes: 30 },
  { name: 'H1', resolution: '60', minutes: 60 },
  { name: 'H4', resolution: '240', minutes: 240 },
  { name: 'D1', resolution: 'D', minutes: 1440 },
];

async function fetchFinnhubCandles(
  finnhubSymbol: string,
  resolution: string,
  fromTs: number,
  toTs: number,
  apiKey: string
): Promise<{ t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[]; s: string } | null> {
  const url = `https://finnhub.io/api/v1/forex/candle?symbol=${encodeURIComponent(finnhubSymbol)}&resolution=${resolution}&from=${fromTs}&to=${toTs}&token=${apiKey}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });

    if (!response.ok) {
      console.error(`[ForexGapBackfill] Finnhub HTTP ${response.status} for ${finnhubSymbol} ${resolution}`);
      return null;
    }

    const data = await response.json();
    if (data?.s === 'ok' && Array.isArray(data.t) && data.t.length > 0) {
      return data;
    }

    return null;
  } catch (err) {
    console.error(`[ForexGapBackfill] Fetch error ${finnhubSymbol} ${resolution}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const startMs = Date.now();

  try {
    const finnhubApiKey = Deno.env.get('FINNHUB_API_KEY') || 'd4ogqohr01quuso9k37gd4ogqohr01quuso9k380';
    if (!finnhubApiKey) {
      throw new Error('FINNHUB_API_KEY not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const symbolParam = url.searchParams.get('symbol');
    const daysBack = parseInt(url.searchParams.get('days') || '4', 10);

    const symbolsToProcess = symbolParam ? [symbolParam] : ALL_FOREX_SYMBOLS;

    const toTs = Math.floor(Date.now() / 1000);
    const fromTs = toTs - daysBack * 24 * 60 * 60;

    console.log(`[ForexGapBackfill] Starting: ${symbolsToProcess.length} symbols, ${daysBack} days back`);

    const results: { symbol: string; timeframe: string; saved: number; status: string; error?: string }[] = [];
    let totalSaved = 0;

    for (const symbol of symbolsToProcess) {
      const finnhubSymbol = FINNHUB_SYMBOL_MAP[symbol];
      if (!finnhubSymbol) {
        console.warn(`[ForexGapBackfill] No Finnhub mapping for ${symbol}`);
        continue;
      }

      for (const tf of TIMEFRAMES) {
        try {
          const data = await fetchFinnhubCandles(finnhubSymbol, tf.resolution, fromTs, toTs, finnhubApiKey);

          if (!data) {
            results.push({ symbol, timeframe: tf.name, saved: 0, status: 'no_data' });
            await new Promise(r => setTimeout(r, 1100));
            continue;
          }

          const intervalSec = tf.minutes * 60;
          const rows = [];

          for (let i = 0; i < data.t.length; i++) {
            if (!data.o[i] || !data.h[i] || !data.l[i] || !data.c[i]) continue;
            if (data.h[i] < data.l[i] || data.o[i] <= 0) continue;

            rows.push({
              symbol,
              timeframe: tf.name,
              open_time: new Date(data.t[i] * 1000).toISOString(),
              close_time: new Date((data.t[i] + intervalSec) * 1000).toISOString(),
              open: data.o[i],
              high: data.h[i],
              low: data.l[i],
              close: data.c[i],
              volume: data.v[i] || 0,
              tick_count: data.v[i] || 0,
              data_source: 'finnhub_backfill',
              quality_score: 90,
            });
          }

          if (rows.length > 0) {
            const { error } = await supabase
              .from('forex_candles')
              .upsert(rows, { onConflict: 'symbol,timeframe,open_time', ignoreDuplicates: false });

            if (error) {
              console.error(`[ForexGapBackfill] DB error ${symbol} ${tf.name}:`, error.message);
              results.push({ symbol, timeframe: tf.name, saved: 0, status: 'db_error', error: error.message });
            } else {
              totalSaved += rows.length;
              console.log(`[ForexGapBackfill] Saved ${rows.length} ${symbol} ${tf.name} candles`);
              results.push({ symbol, timeframe: tf.name, saved: rows.length, status: 'ok' });
            }
          } else {
            results.push({ symbol, timeframe: tf.name, saved: 0, status: 'filtered_out' });
          }

          await new Promise(r => setTimeout(r, 1100));
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown';
          console.error(`[ForexGapBackfill] Error ${symbol} ${tf.name}:`, msg);
          results.push({ symbol, timeframe: tf.name, saved: 0, status: 'error', error: msg });
          await new Promise(r => setTimeout(r, 1100));
        }
      }
    }

    const durationMs = Date.now() - startMs;
    console.log(`[ForexGapBackfill] Complete: totalSaved=${totalSaved}, duration=${(durationMs / 1000).toFixed(1)}s`);

    return new Response(
      JSON.stringify({ success: true, totalSaved, daysBack, durationMs, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[ForexGapBackfill] Fatal error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Unknown error', durationMs: Date.now() - startMs }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
