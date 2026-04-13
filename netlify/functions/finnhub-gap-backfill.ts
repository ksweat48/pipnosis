import type { Handler } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase-admin';
import axios from 'axios';

const supabase = getSupabaseAdmin();

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
  symbol: string,
  resolution: string,
  fromTs: number,
  toTs: number,
  apiKey: string
): Promise<{ t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[]; s: string } | null> {
  const finnhubSymbol = FINNHUB_SYMBOL_MAP[symbol];
  if (!finnhubSymbol) return null;

  try {
    const url = `https://finnhub.io/api/v1/forex/candle?symbol=${encodeURIComponent(finnhubSymbol)}&resolution=${resolution}&from=${fromTs}&to=${toTs}&token=${apiKey}`;
    const response = await axios.get(url, { timeout: 20000 });

    if (response.data?.s === 'ok' && response.data.t?.length > 0) {
      return response.data;
    }
    return null;
  } catch (err) {
    console.error(`[FinnhubBackfill] Fetch error ${symbol} ${resolution}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export const handler: Handler = async (event) => {
  const finnhubApiKey = process.env.FINNHUB_API_KEY;
  if (!finnhubApiKey || finnhubApiKey === 'not-needed-in-development') {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'FINNHUB_API_KEY not configured' })
    };
  }

  const params = event.queryStringParameters || {};
  const symbolParam = params.symbol;
  const daysBack = parseInt(params.days || '4', 10);

  const symbolsToProcess = symbolParam ? [symbolParam] : ALL_FOREX_SYMBOLS;

  const toTs = Math.floor(Date.now() / 1000);
  const fromTs = toTs - daysBack * 24 * 60 * 60;

  console.log(`[FinnhubBackfill] Starting: ${symbolsToProcess.length} symbols, ${daysBack} days back`);

  const results: any[] = [];
  let totalSaved = 0;

  for (const symbol of symbolsToProcess) {
    for (const tf of TIMEFRAMES) {
      try {
        const data = await fetchFinnhubCandles(symbol, tf.resolution, fromTs, toTs, finnhubApiKey);

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
            console.error(`[FinnhubBackfill] DB error ${symbol} ${tf.name}:`, error.message);
            results.push({ symbol, timeframe: tf.name, saved: 0, status: 'db_error', error: error.message });
          } else {
            totalSaved += rows.length;
            console.log(`[FinnhubBackfill] Saved ${rows.length} ${symbol} ${tf.name} candles`);
            results.push({ symbol, timeframe: tf.name, saved: rows.length, status: 'ok' });
          }
        } else {
          results.push({ symbol, timeframe: tf.name, saved: 0, status: 'filtered_out' });
        }

        await new Promise(r => setTimeout(r, 1100));
      } catch (err) {
        console.error(`[FinnhubBackfill] Error ${symbol} ${tf.name}:`, err instanceof Error ? err.message : err);
        results.push({ symbol, timeframe: tf.name, saved: 0, status: 'error', error: err instanceof Error ? err.message : 'unknown' });
        await new Promise(r => setTimeout(r, 1100));
      }
    }
  }

  console.log(`[FinnhubBackfill] Complete: totalSaved=${totalSaved}`);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, totalSaved, daysBack, results })
  };
};
