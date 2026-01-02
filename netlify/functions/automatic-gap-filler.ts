import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

// Netlify functions use non-prefixed env vars, fallback to VITE_ for compatibility
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const FOREX_SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY', 'NAS100', 'SPX500'];
const CRYPTO_SYMBOLS = ['BTCUSD', 'ETHUSD'];
const ACTIVE_SYMBOLS = [...FOREX_SYMBOLS, ...CRYPTO_SYMBOLS];
const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

function isCryptoSymbol(symbol: string): boolean {
  return CRYPTO_SYMBOLS.includes(symbol.toUpperCase());
}

// CRITICAL: All timeframes now look back only 24 hours (fillable window)
const FILLABLE_HOURS = 24;

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

interface GapFillStats {
  totalGapsDetected: number;
  gapsSkippedTooOld: number;
  gapsSkippedWeekend: number;
  gapsSkippedTooLarge: number;
  totalGapsFilled: number;
  filledByRealtimePrices: number;
  filledBySmallerTimeframe: number;
  gapsFailedNoData: number;
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
  // Look back only 24 hours (fillable window)
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - FILLABLE_HOURS * 60 * 60 * 1000);

  console.log(`[AutoGapFiller] Checking ${symbol} ${timeframe} for gaps (${FILLABLE_HOURS} hours back)`);

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
  // OPTIMIZED: Reduced from 2.5x to 1.5x to detect smaller gaps more aggressively
  // Client-side filler handles immediate gaps, backend ensures nothing is missed
  const gapThreshold = intervalMs * 1.5;

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
        }
      }
    }
  }

  if (gaps.length > 0) {
    console.log(`[GapFiller] Found ${gaps.length} gaps in ${symbol} ${timeframe}`);
  }

  return gaps;
}

async function fillGapFromRealtimePrices(gap: GapInfo): Promise<number> {
  console.log(`[GapFiller] Strategy 1: Aggregating from realtime_prices (SQL)...`);

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

  console.log(`[GapFiller] ✅ Successfully filled ${candlesToInsert.length} candles from realtime_prices`);
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

async function fillGap(gap: GapInfo, stats: GapFillStats): Promise<number> {
  const gapAgeHours = getGapAgeHours(gap);

  console.log(`[GapFiller] Processing gap: ${gap.symbol} ${gap.timeframe} from ${gap.gapStart.toISOString()} to ${gap.gapEnd.toISOString()} (${gap.missingCandles} candles, age: ${gapAgeHours.toFixed(1)}h)`);

  // Skip gaps older than 24 hours - we don't have source data for them
  if (gapAgeHours > FILLABLE_HOURS) {
    console.log(`[GapFiller] ⏭️  Skipping gap - too old (${gapAgeHours.toFixed(1)}h > ${FILLABLE_HOURS}h)`);
    stats.gapsSkippedTooOld++;
    return 0;
  }

  let candlesFilled = 0;

  // Strategy 1: Aggregate from realtime_prices (works for all timeframes within 24 hours)
  candlesFilled = await fillGapFromRealtimePrices(gap);
  if (candlesFilled > 0) {
    stats.filledByRealtimePrices += candlesFilled;
    stats.totalGapsFilled++;
    return candlesFilled;
  }
  console.log(`[GapFiller] Strategy 1 failed: No realtime_prices data available`);

  // Strategy 2: Aggregate from smaller timeframe (only works for M5+)
  candlesFilled = await fillGapFromSmallerTimeframe(gap);
  if (candlesFilled > 0) {
    stats.filledBySmallerTimeframe += candlesFilled;
    stats.totalGapsFilled++;
    return candlesFilled;
  }
  console.log(`[GapFiller] Strategy 2 failed: No smaller timeframe data available`);

  // Both strategies failed - this is a real problem for recent gaps
  console.warn(`[GapFiller] ⚠️  Failed to fill recent gap for ${gap.symbol} ${gap.timeframe} - no data source available`);
  stats.gapsFailedNoData++;
  return 0;
}

async function processSymbolTimeframe(symbol: string, timeframe: string, stats: GapFillStats): Promise<number> {
  const gaps = await detectGapsForSymbol(symbol, timeframe);

  stats.totalGapsDetected += gaps.length;

  if (gaps.length === 0) {
    return 0;
  }

  let totalFilled = 0;
  const maxGapsToFill = 10; // Increased since we're only looking at 24 hours now

  for (const gap of gaps.slice(0, maxGapsToFill)) {
    const filled = await fillGap(gap, stats);
    totalFilled += filled;

    // Small delay between gaps
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return totalFilled;
}

export const handler: Handler = async (event, context) => {
  console.log('[AutoGapFiller] Starting automatic gap detection and filling...');
  console.log(`[AutoGapFiller] Fillable window: ${FILLABLE_HOURS} hours`);
  console.log(`[AutoGapFiller] Data sources: realtime_prices (24h) + forex_candles`);
  const startTime = Date.now();

  // SMART SCHEDULING: Check market hours and filter symbols accordingly
  const now = new Date();
  const isForexMarketOpen = isMarketOpenAt(now);

  // Filter symbols based on market hours
  let symbolsToProcess = ACTIVE_SYMBOLS;
  if (!isForexMarketOpen) {
    // Forex market closed - only process crypto symbols
    symbolsToProcess = CRYPTO_SYMBOLS;
    console.log(`[AutoGapFiller] 🌙 Forex market closed - processing only crypto: ${symbolsToProcess.join(', ')}`);
  } else {
    console.log(`[AutoGapFiller] 🌅 Forex market open - processing all symbols`);
  }

  // Early exit if no symbols to process
  if (symbolsToProcess.length === 0) {
    console.log('[AutoGapFiller] ℹ️ No symbols to process at this time');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        totalCandlesFilled: 0,
        message: 'No symbols to process - market closed',
        timestamp: new Date().toISOString()
      })
    };
  }

  const stats: GapFillStats = {
    totalGapsDetected: 0,
    gapsSkippedTooOld: 0,
    gapsSkippedWeekend: 0,
    gapsSkippedTooLarge: 0,
    totalGapsFilled: 0,
    filledByRealtimePrices: 0,
    filledBySmallerTimeframe: 0,
    gapsFailedNoData: 0
  };

  try {
    const results: Record<string, number> = {};
    let totalCandlesFilled = 0;

    // Prioritize M1 and M5 since they're most critical and most likely to have gaps
    const prioritizedTimeframes = ['M1', 'M5', ...TIMEFRAMES.filter(t => t !== 'M1' && t !== 'M5')];

    // EXECUTION GUARD: Track start time and add 90-second limit
    const executionDeadline = startTime + 90000; // 90 seconds max execution

    for (const symbol of symbolsToProcess) {
      // Check if approaching execution deadline
      if (Date.now() > executionDeadline) {
        console.log(`[AutoGapFiller] ⚠️ Approaching execution deadline, stopping before ${symbol}`);
        break;
      }
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

        // Small delay between symbol/timeframe combinations
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    const duration = Date.now() - startTime;

    console.log('[AutoGapFiller] ========== SUMMARY ==========');
    console.log(`Total gaps detected: ${stats.totalGapsDetected}`);
    console.log(`Gaps skipped (too old): ${stats.gapsSkippedTooOld}`);
    console.log(`Gaps filled successfully: ${stats.totalGapsFilled}`);
    console.log(`  - From realtime_prices: ${stats.filledByRealtimePrices}`);
    console.log(`  - From smaller timeframes: ${stats.filledBySmallerTimeframe}`);
    console.log(`Gaps failed (no data): ${stats.gapsFailedNoData}`);
    console.log(`Completed in ${duration}ms`);
    console.log('===================================');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        stats,
        totalCandlesFilled,
        symbolsProcessed: symbolsToProcess.length,
        isForexMarketOpen,
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
