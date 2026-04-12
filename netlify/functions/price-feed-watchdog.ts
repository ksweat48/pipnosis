import type { Handler } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase-admin';
import { fetchKrakenOHLC, KrakenOHLCCandle } from './_shared/kraken-client';

const supabase = getSupabaseAdmin();

const CRYPTO_SYMBOLS = ['BTCUSD', 'ETHUSD'];
const FAST_TIMEFRAMES = ['M1', 'M5', 'M15'];
const TIMEFRAME_MINUTES: Record<string, number> = { M1: 1, M5: 5, M15: 15 };

const SILENCE_THRESHOLD_SECONDS = 180;

async function getLastTickAge(symbol: string): Promise<number> {
  const { data, error } = await supabase
    .from('realtime_prices')
    .select('created_at')
    .eq('symbol', symbol)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return Infinity;
  return (Date.now() - new Date(data.created_at).getTime()) / 1000;
}

async function getLastCandleTime(symbol: string, timeframe: string): Promise<Date | null> {
  const { data, error } = await supabase
    .from('forex_candles')
    .select('open_time')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .order('open_time', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return new Date(data.open_time);
}

async function backfillGapFromKraken(
  symbol: string,
  timeframe: string,
  lastCandleTime: Date | null
): Promise<number> {
  const now = new Date();
  const sinceDate = lastCandleTime
    ? new Date(lastCandleTime.getTime() - 60 * 1000)
    : new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const sinceSec = Math.floor(sinceDate.getTime() / 1000);

  let candles: KrakenOHLCCandle[];
  try {
    candles = await fetchKrakenOHLC(symbol, timeframe, sinceSec);
  } catch (err) {
    console.error(`[PriceFeedWatchdog] Kraken OHLC fetch failed for ${symbol} ${timeframe}:`, err instanceof Error ? err.message : err);
    return 0;
  }

  if (candles.length === 0) return 0;

  const completedCandles = candles.filter(c => c.closeTime <= now);
  if (completedCandles.length === 0) return 0;

  const existingCheck = await supabase
    .from('forex_candles')
    .select('open_time')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .gte('open_time', sinceDate.toISOString());

  const existingTimes = new Set(
    (existingCheck.data || []).map(r => new Date(r.open_time).getTime())
  );

  const newCandles = completedCandles.filter(c => !existingTimes.has(c.openTime.getTime()));
  if (newCandles.length === 0) return 0;

  const records = newCandles.map(c => ({
    symbol,
    timeframe,
    open_time: c.openTime.toISOString(),
    close_time: c.closeTime.toISOString(),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    tick_count: c.volume,
    data_source: 'kraken_backfill',
    quality_score: 90,
  }));

  const { error } = await supabase
    .from('forex_candles')
    .upsert(records, { onConflict: 'symbol,timeframe,open_time', ignoreDuplicates: false });

  if (error) {
    console.error(`[PriceFeedWatchdog] DB upsert error for ${symbol} ${timeframe}:`, error.message);
    return 0;
  }

  return newCandles.length;
}

export const handler: Handler = async (_event, _context) => {
  const startTime = Date.now();
  console.log('[PriceFeedWatchdog] Running feed silence check...');

  const results: Record<string, { tickAgeSec: number; silent: boolean; candlesFilled: number }> = {};
  let totalCandlesFilled = 0;

  for (const symbol of CRYPTO_SYMBOLS) {
    const tickAgeSec = await getLastTickAge(symbol);
    const silent = tickAgeSec > SILENCE_THRESHOLD_SECONDS;

    console.log(`[PriceFeedWatchdog] ${symbol}: last tick ${Math.round(tickAgeSec)}s ago — ${silent ? 'SILENT' : 'ok'}`);

    let candlesFilled = 0;

    if (silent) {
      console.log(`[PriceFeedWatchdog] ${symbol}: feed silent > ${SILENCE_THRESHOLD_SECONDS}s — triggering Kraken OHLC backfill`);

      for (const tf of FAST_TIMEFRAMES) {
        const lastCandle = await getLastCandleTime(symbol, tf);
        const filled = await backfillGapFromKraken(symbol, tf, lastCandle);
        candlesFilled += filled;

        if (filled > 0) {
          console.log(`[PriceFeedWatchdog] ${symbol} ${tf}: filled ${filled} candles from Kraken OHLC`);
        }
      }
    }

    results[symbol] = { tickAgeSec: Math.round(tickAgeSec), silent, candlesFilled };
    totalCandlesFilled += candlesFilled;
  }

  const duration = Date.now() - startTime;
  console.log(`[PriceFeedWatchdog] Completed in ${duration}ms — ${totalCandlesFilled} total candles filled`);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      totalCandlesFilled,
      silenceThresholdSeconds: SILENCE_THRESHOLD_SECONDS,
      results,
      durationMs: duration,
      timestamp: new Date().toISOString(),
    }),
  };
};
