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

const TIMEFRAME_LOOKBACK_DAYS: Record<string, number> = {
  'M1': 7,
  'M5': 14,
  'M15': 30,
  'M30': 30,
  'H1': 30,
  'H4': 30,
  'D1': 30
};

function getLookbackDays(timeframe: string): number {
  return TIMEFRAME_LOOKBACK_DAYS[timeframe] || 7;
}

interface GapInfo {
  symbol: string;
  timeframe: string;
  gapStart: Date;
  gapEnd: Date;
  missingCandles: number;
}

interface GapFillStats {
  totalGapsDetected: number;
  totalGapsFilled: number;
  filledByRealtimePrices: number;
  filledBySmallerTimeframe: number;
  filledByMetaAPI: number;
  failedToFill: number;
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

function isWeekendPeriod(startTime: Date, endTime: Date): boolean {
  const start = startTime.getUTCDay();
  const end = endTime.getUTCDay();

  return (start === 5 && (end === 0 || end === 1)) ||
         (start === 6 && (end === 0 || end === 1));
}

function getSmallerTimeframe(timeframe: string): string | null {
  const hierarchy: Record<string, string> = {
    'M5': 'M1',
    'M15': 'M5',
    'M30': 'M15',
    'H1': 'M15',
    'H4': 'H1',
    'D1': 'H4'
  };
  return hierarchy[timeframe] || null;
}

function getGapAgeHours(gap: GapInfo): number {
  const now = Date.now();
  const gapEndTime = gap.gapEnd.getTime();
  return (now - gapEndTime) / (60 * 60 * 1000);
}

async function detectGapsForSymbol(symbol: string, timeframe: string): Promise<GapInfo[]> {
  const lookbackDays = getLookbackDays(timeframe);
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
  const gapThreshold = intervalMs * 2.5;

  for (let i = 1; i < candles.length; i++) {
    const prevTime = new Date(candles[i - 1].open_time);
    const currTime = new Date(candles[i].open_time);
    const timeDiff = currTime.getTime() - prevTime.getTime();

    if (timeDiff > gapThreshold) {
      const isWeekendGap = isWeekendPeriod(prevTime, currTime);

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
        } else if (missingCandles > 100) {
          console.warn(`[GapFiller] Skipping large gap: ${missingCandles} candles (too large to fill)`);
        }
      }
    }
  }

  if (gaps.length > 0) {
    console.log(`[GapFiller] Found ${gaps.length} fillable gaps in ${symbol} ${timeframe}`);
  }

  return gaps;
}

async function fillGapFromRealtimePrices(gap: GapInfo): Promise<number> {
  console.log(`[GapFiller] Strategy 1: Trying realtime_prices aggregation (SQL)...`);

  const intervalSeconds = TIMEFRAME_SECONDS[gap.timeframe];
  const intervalMs = intervalSeconds * 1000;
  const candlesToInsert = [];
  let currentCandleStart = gap.gapStart.getTime();

  while (currentCandleStart <= gap.gapEnd.getTime()) {
    const currentCandleEnd = currentCandleStart + intervalMs;
    const startTime = new Date(currentCandleStart);
    const endTime = new Date(currentCandleEnd);

    if (!isMarketOpenAt(startTime)) {
      currentCandleStart = currentCandleEnd;
      continue;
    }

    try {
      const { data, error } = await supabase.rpc('aggregate_candle_from_prices', {
        p_symbol: gap.symbol,
        p_start_time: startTime.toISOString(),
        p_end_time: endTime.toISOString()
      });

      if (error) {
        console.error(`[GapFiller] SQL aggregation error: ${error.message}`);
        currentCandleStart = currentCandleEnd;
        continue;
      }

      if (data && data.length > 0 && data[0].price_count > 0) {
        const row = data[0];

        candlesToInsert.push({
          symbol: gap.symbol,
          timeframe: gap.timeframe,
          open_time: startTime.toISOString(),
          close_time: endTime.toISOString(),
          open: row.first_price,
          high: row.high_price,
          low: row.low_price,
          close: row.last_price,
          volume: row.price_count,
          tick_count: row.price_count,
          data_source: 'gap_filler_prices',
          quality_score: 95
        });
      }
    } catch (error) {
      console.error(`[GapFiller] Error calling SQL function:`, error);
    }

    currentCandleStart = currentCandleEnd;
  }

  if (candlesToInsert.length === 0) {
    console.log(`[GapFiller] No realtime_prices data available for gap range`);
    return 0;
  }

  const { error: insertError } = await supabase
    .from('forex_candles')
    .upsert(candlesToInsert, {
      onConflict: 'symbol,timeframe,open_time',
      ignoreDuplicates: false
    });

  if (insertError) {
    console.error(`[GapFiller] Error inserting candles from realtime: ${insertError.message}`);
    return 0;
  }

  console.log(`[GapFiller] ✅ Successfully filled ${candlesToInsert.length} candles from realtime_prices (SQL aggregation)`);
  return candlesToInsert.length;
}

async function fillGapFromSmallerTimeframe(gap: GapInfo): Promise<number> {
  const smallerTf = getSmallerTimeframe(gap.timeframe);
  if (!smallerTf) {
    console.log(`[GapFiller] No smaller timeframe available (already at M1)`);
    return 0;
  }

  console.log(`[GapFiller] Strategy 2: Aggregating from ${smallerTf}...`);

  const { data: smallerCandles, error } = await supabase
    .from('forex_candles')
    .select('open_time, open, high, low, close, volume')
    .eq('symbol', gap.symbol)
    .eq('timeframe', smallerTf)
    .gte('open_time', gap.gapStart.toISOString())
    .lt('open_time', gap.gapEnd.toISOString())
    .order('open_time', { ascending: true });

  if (error || !smallerCandles || smallerCandles.length === 0) {
    console.log(`[GapFiller] Not enough ${smallerTf} candles (${smallerCandles?.length || 0})`);
    return 0;
  }

  const intervalSeconds = TIMEFRAME_SECONDS[gap.timeframe];
  const intervalMs = intervalSeconds * 1000;
  const candlesToInsert = [];
  let currentCandleStart = gap.gapStart.getTime();

  while (currentCandleStart <= gap.gapEnd.getTime()) {
    const currentCandleEnd = currentCandleStart + intervalMs;
    const startTime = new Date(currentCandleStart);

    if (!isMarketOpenAt(startTime)) {
      currentCandleStart = currentCandleEnd;
      continue;
    }

    const candlesInPeriod = smallerCandles.filter(c => {
      const candleTime = new Date(c.open_time).getTime();
      return candleTime >= currentCandleStart && candleTime < currentCandleEnd;
    });

    if (candlesInPeriod.length > 0) {
      const open = candlesInPeriod[0].open;
      const close = candlesInPeriod[candlesInPeriod.length - 1].close;
      const high = Math.max(...candlesInPeriod.map(c => c.high));
      const low = Math.min(...candlesInPeriod.map(c => c.low));
      const volume = candlesInPeriod.reduce((sum, c) => sum + (c.volume || 0), 0);

      candlesToInsert.push({
        symbol: gap.symbol,
        timeframe: gap.timeframe,
        open_time: startTime.toISOString(),
        close_time: new Date(currentCandleEnd).toISOString(),
        open,
        high,
        low,
        close,
        volume,
        tick_count: candlesInPeriod.length,
        data_source: `gap_filler_${smallerTf}`,
        quality_score: 90
      });
    }

    currentCandleStart = currentCandleEnd;
  }

  if (candlesToInsert.length === 0) {
    console.log(`[GapFiller] No aggregatable data from ${smallerTf}`);
    return 0;
  }

  const { error: insertError } = await supabase
    .from('forex_candles')
    .upsert(candlesToInsert, {
      onConflict: 'symbol,timeframe,open_time',
      ignoreDuplicates: false
    });

  if (insertError) {
    console.error(`[GapFiller] Error inserting aggregated candles: ${insertError.message}`);
    return 0;
  }

  console.log(`[GapFiller] ✅ Successfully filled ${candlesToInsert.length} candles from ${smallerTf}`);
  return candlesToInsert.length;
}

async function fillGapFromMetaAPI(gap: GapInfo): Promise<number> {
  console.log(`[GapFiller] Strategy 3: Trying MetaAPI historical fetch (fallback)...`);

  try {
    const gapDurationDays = Math.ceil((gap.gapEnd.getTime() - gap.gapStart.getTime()) / (24 * 60 * 60 * 1000));
    const fetchDays = Math.min(gapDurationDays + 1, 7);

    const historicalCandles = await fetchHistoricalCandles(
      gap.symbol,
      gap.timeframe,
      fetchDays
    );

    if (historicalCandles.length === 0) {
      console.warn(`[GapFiller] MetaAPI returned no data`);
      return 0;
    }

    const gapStartTime = gap.gapStart.getTime();
    const gapEndTime = gap.gapEnd.getTime();

    const candlesInGapRange = historicalCandles.filter(candle => {
      const candleTime = new Date(candle.open_time).getTime();
      return candleTime >= gapStartTime && candleTime <= gapEndTime;
    });

    if (candlesInGapRange.length === 0) {
      console.warn(`[GapFiller] No candles in gap range from MetaAPI`);
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
      console.error(`[GapFiller] Error inserting MetaAPI candles: ${insertError.message}`);
      return 0;
    }

    console.log(`[GapFiller] ✅ Successfully filled ${candlesToInsert.length} candles from MetaAPI`);
    return candlesToInsert.length;

  } catch (error) {
    console.warn(`[GapFiller] MetaAPI failed:`, error instanceof Error ? error.message : 'Unknown error');
    return 0;
  }
}

async function fillGap(gap: GapInfo, stats: GapFillStats): Promise<number> {
  console.log(`[GapFiller] Filling gap: ${gap.symbol} ${gap.timeframe} from ${gap.gapStart.toISOString()} to ${gap.gapEnd.toISOString()} (${gap.missingCandles} candles)`);

  const gapAgeHours = getGapAgeHours(gap);
  console.log(`[GapFiller] Gap age: ${gapAgeHours.toFixed(1)} hours`);

  let candlesFilled = 0;

  if (gapAgeHours < 24) {
    candlesFilled = await fillGapFromRealtimePrices(gap);
    if (candlesFilled > 0) {
      stats.filledByRealtimePrices += candlesFilled;
      stats.totalGapsFilled++;
      return candlesFilled;
    }
    console.log(`[GapFiller] Strategy 1 failed: No realtime_prices data available`);
  }

  candlesFilled = await fillGapFromSmallerTimeframe(gap);
  if (candlesFilled > 0) {
    stats.filledBySmallerTimeframe += candlesFilled;
    stats.totalGapsFilled++;
    return candlesFilled;
  }
  console.log(`[GapFiller] Strategy 2 failed: No smaller timeframe data available`);

  candlesFilled = await fillGapFromMetaAPI(gap);
  if (candlesFilled > 0) {
    stats.filledByMetaAPI += candlesFilled;
    stats.totalGapsFilled++;
    return candlesFilled;
  }
  console.log(`[GapFiller] Strategy 3 failed: MetaAPI unavailable or returned no data`);

  console.warn(`[GapFiller] ⚠️  Could not fill gap for ${gap.symbol} ${gap.timeframe} - no data available`);
  stats.failedToFill++;
  return 0;
}

async function processSymbolTimeframe(symbol: string, timeframe: string, stats: GapFillStats): Promise<number> {
  const gaps = await detectGapsForSymbol(symbol, timeframe);

  stats.totalGapsDetected += gaps.length;

  if (gaps.length === 0) {
    return 0;
  }

  let totalFilled = 0;
  const maxGapsToFill = (timeframe === 'M1' || timeframe === 'M5') ? 3 : 5;

  for (const gap of gaps.slice(0, maxGapsToFill)) {
    const filled = await fillGap(gap, stats);
    totalFilled += filled;

    const delay = (timeframe === 'M1' || timeframe === 'M5') ? 2000 : 1000;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  return totalFilled;
}

export const handler: Handler = async (event, context) => {
  console.log('[AutoGapFiller] Starting automatic gap detection and filling...');
  const startTime = Date.now();

  const stats: GapFillStats = {
    totalGapsDetected: 0,
    totalGapsFilled: 0,
    filledByRealtimePrices: 0,
    filledBySmallerTimeframe: 0,
    filledByMetaAPI: 0,
    failedToFill: 0
  };

  try {
    const results: Record<string, number> = {};
    let totalCandlesFilled = 0;

    const prioritizedTimeframes = ['M1', 'M5', ...TIMEFRAMES.filter(t => t !== 'M1' && t !== 'M5')];

    for (const symbol of ACTIVE_SYMBOLS) {
      for (const timeframe of prioritizedTimeframes) {
        const key = `${symbol}_${timeframe}`;

        try {
          const filled = await processSymbolTimeframe(symbol, timeframe, stats);
          results[key] = filled;
          totalCandlesFilled += filled;

          if (filled > 0) {
            console.log(`[AutoGapFiller] ${key}: Filled ${filled} candles`);
          }
        } catch (error) {
          console.error(`[AutoGapFiller] Error processing ${key}:`, error);
          results[key] = 0;
        }

        const delay = (timeframe === 'M1' || timeframe === 'M5') ? 1000 : 500;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    const duration = Date.now() - startTime;

    console.log('[AutoGapFiller] ===== SUMMARY =====');
    console.log(`Total gaps detected: ${stats.totalGapsDetected}`);
    console.log(`Total gaps filled: ${stats.totalGapsFilled}`);
    console.log(`  - From realtime_prices: ${stats.filledByRealtimePrices}`);
    console.log(`  - From smaller timeframes: ${stats.filledBySmallerTimeframe}`);
    console.log(`  - From MetaAPI: ${stats.filledByMetaAPI}`);
    console.log(`  - Failed to fill: ${stats.failedToFill}`);
    console.log(`Completed in ${duration}ms`);
    console.log('================================');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        stats,
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
