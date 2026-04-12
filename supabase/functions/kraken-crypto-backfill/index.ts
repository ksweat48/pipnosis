import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const KRAKEN_SYMBOL_MAP: Record<string, string> = {
  BTCUSD: 'XBTUSD',
  ETHUSD: 'ETHUSD',
};

const TIMEFRAME_MINUTES: Record<string, number> = {
  M1: 1,
  M5: 5,
  M15: 15,
  M30: 30,
  H1: 60,
  H4: 240,
  D1: 1440,
};

async function fetchKrakenOHLC(
  symbol: string,
  intervalMinutes: number,
  sinceUnix: number
): Promise<Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>> {
  const krakenSymbol = KRAKEN_SYMBOL_MAP[symbol];
  if (!krakenSymbol) throw new Error(`No Kraken mapping for ${symbol}`);

  const url = `https://api.kraken.com/0/public/OHLC?pair=${krakenSymbol}&interval=${intervalMinutes}&since=${sinceUnix}`;
  const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });

  if (!resp.ok) throw new Error(`Kraken HTTP ${resp.status}`);

  const json = await resp.json();
  if (json.error && json.error.length > 0) throw new Error(`Kraken error: ${json.error.join(', ')}`);

  const resultKeys = Object.keys(json.result).filter(k => k !== 'last');
  if (resultKeys.length === 0) return [];

  const rows: number[][] = json.result[resultKeys[0]];
  return rows.map(r => ({
    time: r[0],
    open: parseFloat(String(r[1])),
    high: parseFloat(String(r[2])),
    low: parseFloat(String(r[3])),
    close: parseFloat(String(r[4])),
    volume: parseFloat(String(r[6])),
  }));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const hoursBack = parseInt(url.searchParams.get('hours') || '14', 10);
    const symbolParam = url.searchParams.get('symbol');
    const symbols = symbolParam ? [symbolParam] : ['BTCUSD', 'ETHUSD'];
    const timeframesParam = url.searchParams.get('timeframes');
    const timeframes = timeframesParam
      ? timeframesParam.split(',')
      : ['M1', 'M5', 'M15', 'M30', 'H1'];

    const sinceUnix = Math.floor((Date.now() / 1000) - hoursBack * 3600);
    const results: Record<string, Record<string, number>> = {};
    let totalSaved = 0;

    for (const symbol of symbols) {
      results[symbol] = {};
      for (const tf of timeframes) {
        const intervalMinutes = TIMEFRAME_MINUTES[tf];
        if (!intervalMinutes) continue;

        try {
          const candles = await fetchKrakenOHLC(symbol, intervalMinutes, sinceUnix);
          if (candles.length === 0) {
            results[symbol][tf] = 0;
            continue;
          }

          const records = candles.map(c => ({
            symbol,
            timeframe: tf,
            open_time: new Date(c.time * 1000).toISOString(),
            close_time: new Date((c.time + intervalMinutes * 60) * 1000).toISOString(),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
            tick_count: 1,
            data_source: 'kraken_backfill',
            quality_score: 90,
          }));

          const { error } = await supabase
            .from('forex_candles')
            .upsert(records, {
              onConflict: 'symbol,timeframe,open_time',
              ignoreDuplicates: false,
            });

          if (error) {
            console.error(`[KrakenBackfill] ${symbol} ${tf} error:`, error.message);
            results[symbol][tf] = -1;
          } else {
            results[symbol][tf] = records.length;
            totalSaved += records.length;
            console.log(`[KrakenBackfill] ${symbol} ${tf}: ${records.length} candles saved`);
          }

          await new Promise(r => setTimeout(r, 300));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[KrakenBackfill] ${symbol} ${tf} failed:`, msg);
          results[symbol][tf] = -1;
        }
      }
    }

    return new Response(JSON.stringify({ success: true, totalSaved, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
