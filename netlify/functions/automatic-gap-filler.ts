import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { fetchHistoricalCandles } from '../../src/services/metaapi-service';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const ACTIVE_SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];
const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

const TIMEFRAME_SECONDS: Record<string, number> = {
  'M1': 60,
  'M5': 300,
  'M15': 900,
  'M30': 1800,
  'H1': 3600,
  'H4': 14400,
  'D1': 86400
};

interface GapInfo {
  symbol: string;
  timeframe: string;
  gapStart: Date;
  gapEnd: Date;
  missingCandles: number;
}

function isMarketOpenAt(timestamp: Date): boolean {
  const estTime = new Date(timestamp.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dayOfWeek = estTime.getDay();
  const hours = estTime.getHours();
  const minutes = estTime.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  const fridayCloseTime = 17 * 60;
  const sundayOpenTime = 17 * 60;

  if (dayOfWeek === 6) return false;
  if (dayOfWeek === 5 && totalMinutes >= fridayCloseTime) return false;
  if (dayOfWeek === 0 && totalMinutes < sundayOpenTime) return false;

  return true;
}

async function detectGapsForSymbol(symbol: string, timeframe: string, lookbackDays: number = 7): Promise<GapInfo[]> {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  console.log(`[AutoGapFiller] Checking ${symbol} ${timeframe} for gaps (${lookbackDays} days back)`);

  const { data: candles, error } = await supabase
    .from('forex_candles')
    .select('open_time')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .gte('open_time', startTime.toISOString())
    .lte('open_time', endTime.toISOString())
    .order('open_time', { ascending: true });

  if (error) {
    console.error(`[AutoGapFiller] Error fetching candles: ${error.message}`);
    return [];
  }

  if (!candles || candles.length < 2) {
    console.log(`[AutoGapFiller] Not enough candles to detect gaps (${candles?.length || 0})`);
    return [];
  }

  const gaps: GapInfo[] = [];
  const intervalMs = TIMEFRAME_SECONDS[timeframe] * 1000;
  const gapThreshold = intervalMs * 1.5;

  for (let i = 1; i < candles.length; i++) {
    const prevTime = new Date(candles[i - 1].open_time);
    const currTime = new Date(candles[i].open_time);
    const timeDiff = currTime.getTime() - prevTime.getTime();

    if (timeDiff > gapThreshold) {
      const prevDay = prevTime.getUTCDay();
      const currDay = currTime.getUTCDay();

      const isWeekendGap =
        (prevDay === 5 && (currDay === 0 || currDay === 1)) ||
        (prevDay === 6 && (currDay === 0 || currDay === 1));

      if (!isWeekendGap) {
        const missingCandles = Math.floor(timeDiff / intervalMs) - 1;

        if (missingCandles > 0 && missingCandles <= 100) {
          gaps.push({
            symbol,
            timeframe,
            gapStart: new Date(prevTime.getTime() + intervalMs),
            gapEnd: new Date(currTime.getTime() - intervalMs),
            missingCandles
          });
        }
      }
    }
  }

  if (gaps.length > 0) {
    console.log(`[AutoGapFiller] Found ${gaps.length} gaps in ${symbol} ${timeframe}`);
  }

  return gaps;
}

async function fillGap(gap: GapInfo): Promise<number> {
  console.log(`[AutoGapFiller] Filling gap: ${gap.symbol} ${gap.timeframe} from ${gap.gapStart.toISOString()} to ${gap.gapEnd.toISOString()} (${gap.missingCandles} candles)`);

  try {
    const gapDurationDays = Math.ceil((gap.gapEnd.getTime() - gap.gapStart.getTime()) / (24 * 60 * 60 * 1000));
    const fetchDays = Math.min(gapDurationDays + 1, 7);

    const historicalCandles = await fetchHistoricalCandles(
      gap.symbol,
      gap.timeframe,
      fetchDays
    );

    if (historicalCandles.length === 0) {
      console.warn(`[AutoGapFiller] No historical data returned from MetaAPI for ${gap.symbol} ${gap.timeframe}`);
      return 0;
    }

    const gapStartTime = gap.gapStart.getTime();
    const gapEndTime = gap.gapEnd.getTime();

    const candlesInGapRange = historicalCandles.filter(candle => {
      const candleTime = new Date(candle.open_time).getTime();
      return candleTime >= gapStartTime && candleTime <= gapEndTime;
    });

    if (candlesInGapRange.length === 0) {
      console.warn(`[AutoGapFiller] No candles in gap range after filtering`);
      return 0;
    }

    const candlesToInsert = candlesInGapRange.map(candle => ({
      symbol: candle.symbol,
      timeframe: candle.timeframe,
      open_time: candle.open_time,
      close_time: candle.close_time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume || 0,
      tick_count: candle.volume || 0,
      data_source: 'metaapi_backfill',
      quality_score: 95
    }));

    const { error: insertError } = await supabase
      .from('forex_candles')
      .upsert(candlesToInsert, {
        onConflict: 'symbol,timeframe,open_time',
        ignoreDuplicates: false
      });

    if (insertError) {
      console.error(`[AutoGapFiller] Error inserting candles: ${insertError.message}`);
      return 0;
    }

    console.log(`[AutoGapFiller] Successfully filled gap with ${candlesToInsert.length} candles`);
    return candlesToInsert.length;

  } catch (error) {
    console.error(`[AutoGapFiller] Error filling gap:`, error);
    return 0;
  }
}

async function processSymbolTimeframe(symbol: string, timeframe: string): Promise<number> {
  const gaps = await detectGapsForSymbol(symbol, timeframe, 7);

  if (gaps.length === 0) {
    return 0;
  }

  let totalFilled = 0;

  for (const gap of gaps.slice(0, 5)) {
    const filled = await fillGap(gap);
    totalFilled += filled;

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return totalFilled;
}

export const handler: Handler = async (event, context) => {
  console.log('[AutoGapFiller] Starting automatic gap detection and filling...');
  const startTime = Date.now();

  try {
    const results: Record<string, number> = {};
    let totalCandlesFilled = 0;

    for (const symbol of ACTIVE_SYMBOLS) {
      for (const timeframe of TIMEFRAMES) {
        const key = `${symbol}_${timeframe}`;

        try {
          const filled = await processSymbolTimeframe(symbol, timeframe);
          results[key] = filled;
          totalCandlesFilled += filled;

          if (filled > 0) {
            console.log(`[AutoGapFiller] ${key}: Filled ${filled} candles`);
          }
        } catch (error) {
          console.error(`[AutoGapFiller] Error processing ${key}:`, error);
          results[key] = 0;
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[AutoGapFiller] Completed in ${duration}ms: ${totalCandlesFilled} candles filled`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        totalCandlesFilled,
        durationMs: duration,
        results,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('[AutoGapFiller] Fatal error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      })
    };
  }
};
