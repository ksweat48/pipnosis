import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const ACTIVE_SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];

// OPTIMIZATION: Different timeframe groups for smart scheduling
const FAST_TIMEFRAMES = ['M1', 'M5', 'M15']; // Process every run (5 min)
const MEDIUM_TIMEFRAMES = ['M30', 'H1']; // Process every 3rd run (15 min)
const SLOW_TIMEFRAMES = ['H4', 'D1', 'W1']; // Process every 12th run (60 min)
const ALL_TIMEFRAMES = [...FAST_TIMEFRAMES, ...MEDIUM_TIMEFRAMES, ...SLOW_TIMEFRAMES];

const TIMEFRAME_MINUTES: Record<string, number> = {
  'M1': 1,
  'M5': 5,
  'M15': 15,
  'M30': 30,
  'H1': 60,
  'H4': 240,
  'D1': 1440,
  'W1': 10080
};

interface RealtimePrice {
  symbol: string;
  bid: number;
  ask: number;
  broker_time: string;
  created_at: string;
}

interface CandleData {
  symbol: string;
  timeframe: string;
  open_time: Date;
  close_time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function roundTimeToCandle(time: Date, minutes: number): Date {
  const ms = time.getTime();
  const roundedMs = Math.floor(ms / (minutes * 60 * 1000)) * (minutes * 60 * 1000);
  return new Date(roundedMs);
}

/**
 * Determine which timeframes to process based on current minute
 * This prevents timeout by processing heavy timeframes less frequently
 */
function getTimeframesToProcess(): string[] {
  const now = new Date();
  const minuteOfHour = now.getMinutes();

  // ALWAYS process fast timeframes (M1, M5, M15)
  let timeframes = [...FAST_TIMEFRAMES];

  // Every 15 minutes (0, 15, 30, 45), also process medium timeframes
  if (minuteOfHour % 15 === 0) {
    timeframes.push(...MEDIUM_TIMEFRAMES);
  }

  // Every hour (0 minutes), also process slow timeframes
  if (minuteOfHour === 0) {
    timeframes.push(...SLOW_TIMEFRAMES);
  }

  console.log(`[CandleAggregator] Processing timeframes: ${timeframes.join(', ')}`);
  return timeframes;
}

/**
 * Check if a specific date/time is during open market hours
 * Uses EST/EDT timezone (New York) to properly handle daylight saving time
 * Market closes Friday 5:00 PM EST and opens Sunday 5:00 PM EST
 */
function isMarketOpenAtTime(date: Date): boolean {
  // Convert to EST/EDT (New York timezone) - automatically handles DST
  const estTime = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));

  const dayOfWeek = estTime.getDay(); // 0 = Sunday, 5 = Friday, 6 = Saturday
  const hours = estTime.getHours();
  const minutes = estTime.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  // Friday 5:00 PM = 17:00 = 1020 minutes
  const fridayCloseTime = 17 * 60;

  // Sunday 5:00 PM = 17:00 = 1020 minutes
  const sundayOpenTime = 17 * 60;

  // Market is closed on Saturday (all day)
  if (dayOfWeek === 6) {
    return false;
  }

  // Market is closed Friday after 5:00 PM
  if (dayOfWeek === 5 && totalMinutes >= fridayCloseTime) {
    return false;
  }

  // Market is closed Sunday before 5:00 PM
  if (dayOfWeek === 0 && totalMinutes < sundayOpenTime) {
    return false;
  }

  return true;
}

function calculateCandleFromPrices(
  prices: RealtimePrice[],
  symbol: string,
  timeframe: string,
  candleStartTime: Date
): CandleData | null {
  if (prices.length === 0) return null;

  const timeframeMinutes = TIMEFRAME_MINUTES[timeframe];
  const candleEndTime = new Date(candleStartTime.getTime() + timeframeMinutes * 60 * 1000);

  const midPrices = prices.map(p => (p.bid + p.ask) / 2);

  return {
    symbol,
    timeframe,
    open_time: candleStartTime,
    close_time: candleEndTime,
    open: midPrices[0],
    high: Math.max(...midPrices),
    low: Math.min(...midPrices),
    close: midPrices[midPrices.length - 1],
    volume: prices.length
  };
}

async function fetchRecentPrices(symbol: string, lookbackMinutes: number): Promise<RealtimePrice[]> {
  const cutoffTime = new Date(Date.now() - lookbackMinutes * 60 * 1000);

  const { data, error } = await supabase
    .from('realtime_prices')
    .select('symbol, bid, ask, broker_time, created_at')
    .eq('symbol', symbol)
    .gte('created_at', cutoffTime.toISOString())
    .order('created_at', { ascending: true });

  if (error) {
    console.error(`[CandleAggregator] Error fetching prices for ${symbol}:`, error.message);
    return [];
  }

  return data || [];
}

async function getLastCandleTime(symbol: string, timeframe: string): Promise<Date | null> {
  const { data, error } = await supabase
    .from('forex_candles')
    .select('open_time')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .eq('data_source', 'netlify_aggregator')
    .order('open_time', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`[CandleAggregator] Error fetching last candle for ${symbol} ${timeframe}:`, error.message);
    return null;
  }

  return data ? new Date(data.open_time) : null;
}

async function saveCandleToDatabase(candle: CandleData): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('forex_candles')
      .upsert({
        symbol: candle.symbol,
        timeframe: candle.timeframe,
        open_time: candle.open_time.toISOString(),
        close_time: candle.close_time.toISOString(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        tick_count: candle.volume,
        data_source: 'netlify_aggregator'
      }, {
        onConflict: 'symbol,timeframe,open_time',
        ignoreDuplicates: false
      });

    if (error) {
      console.error(`[CandleAggregator] Database error for ${candle.symbol} ${candle.timeframe}:`, error.message);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`[CandleAggregator] Unexpected error saving candle:`, error);
    return false;
  }
}

/**
 * OPTIMIZATION: Batch save multiple candles in a single DB transaction
 */
async function saveCandlesBatch(candles: CandleData[]): Promise<number> {
  if (candles.length === 0) return 0;

  try {
    const candleRecords = candles.map(candle => ({
      symbol: candle.symbol,
      timeframe: candle.timeframe,
      open_time: candle.open_time.toISOString(),
      close_time: candle.close_time.toISOString(),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      tick_count: candle.volume,
      data_source: 'netlify_aggregator'
    }));

    const { error } = await supabase
      .from('forex_candles')
      .upsert(candleRecords, {
        onConflict: 'symbol,timeframe,open_time',
        ignoreDuplicates: false
      });

    if (error) {
      console.error(`[CandleAggregator] Batch save error:`, error.message);
      return 0;
    }

    return candles.length;
  } catch (error) {
    console.error(`[CandleAggregator] Unexpected batch save error:`, error);
    return 0;
  }
}

// SQL-BASED AGGREGATION: More reliable than in-memory processing
async function aggregateCandleSQL(
  symbol: string,
  timeframe: string,
  startTime: Date,
  endTime: Date
): Promise<CandleData | null> {
  try {
    // Use SQL to calculate OHLC directly from realtime_prices
    const { data, error } = await supabase.rpc('aggregate_candle_from_prices', {
      p_symbol: symbol,
      p_start_time: startTime.toISOString(),
      p_end_time: endTime.toISOString()
    });

    if (error) {
      // If RPC function doesn't exist, return null (will fall back to in-memory)
      if (error.message.includes('function') && error.message.includes('does not exist')) {
        console.log(`[CandleAggregator] SQL function not found, using fallback`);
        return null;
      }
      console.error(`[CandleAggregator] SQL aggregation error: ${error.message}`);
      return null;
    }

    if (!data || data.length === 0 || !data[0].price_count || data[0].price_count === 0) {
      return null;
    }

    const row = data[0];
    return {
      symbol,
      timeframe,
      open_time: startTime,
      close_time: endTime,
      open: row.first_price,
      high: row.high_price,
      low: row.low_price,
      close: row.last_price,
      volume: row.price_count
    };
  } catch (error) {
    // CRITICAL: Network errors (TypeError: fetch failed) should not crash the function
    // Fall back to in-memory aggregation silently
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes('fetch failed') || errorMsg.includes('TypeError')) {
      console.log(`[CandleAggregator] SQL RPC connection issue, using fallback method`);
    } else {
      console.error(`[CandleAggregator] SQL aggregation error: ${errorMsg}`);
    }
    return null;
  }
}

async function aggregateFromM1Candles(
  symbol: string,
  timeframe: string,
  startTime: Date,
  endTime: Date
): Promise<CandleData | null> {
  try {
    const { data, error } = await supabase
      .from('forex_candles')
      .select('open, high, low, close, open_time')
      .eq('symbol', symbol)
      .eq('timeframe', 'M1')
      .gte('open_time', startTime.toISOString())
      .lt('open_time', endTime.toISOString())
      .order('open_time', { ascending: true });

    if (error) {
      console.error(`[CandleAggregator] Error fetching M1 candles for aggregation:`, error.message);
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    const open = data[0].open;
    const close = data[data.length - 1].close;
    const high = Math.max(...data.map(c => c.high));
    const low = Math.min(...data.map(c => c.low));

    return {
      symbol,
      timeframe,
      open_time: startTime,
      close_time: endTime,
      open,
      high,
      low,
      close,
      volume: data.length
    };
  } catch (error) {
    console.error(`[CandleAggregator] M1 aggregation unexpected error:`, error);
    return null;
  }
}

async function aggregateCandlesForSymbol(
  symbol: string,
  timeframesToProcess: string[],
  startTime: number,
  maxDurationMs: number = 100000 // 100 seconds safety margin
): Promise<{ candlesCreated: number; timedOut: boolean }> {
  console.log(`[CandleAggregator]   📊 Starting aggregation for ${symbol}...`);

  // OPTIMIZATION: Fetch only 30 minutes of recent prices for fast timeframes
  // For H4/D1/W1, we aggregate from M1 candles instead (no raw price data needed)
  const lookbackMinutes = 30; // Reduced from 24 hours to 30 minutes!
  const prices = await fetchRecentPrices(symbol, lookbackMinutes);

  if (prices.length === 0) {
    console.log(`[CandleAggregator]   ⚠️ ${symbol}: No prices found in last ${lookbackMinutes} minutes`);
    return { candlesCreated: 0, timedOut: false };
  }

  const firstPriceTime = new Date(prices[0].created_at);
  const lastPriceTime = new Date(prices[prices.length - 1].created_at);
  console.log(`[CandleAggregator]   📈 ${symbol}: Fetched ${prices.length} prices from ${firstPriceTime.toISOString()} to ${lastPriceTime.toISOString()}`);

  let candlesCreated = 0;
  const now = new Date();
  const candlesToSave: CandleData[] = [];

  for (const timeframe of timeframesToProcess) {
    // TIMEOUT PROTECTION: Check if we're approaching the limit
    const elapsedMs = Date.now() - startTime;
    if (elapsedMs > maxDurationMs) {
      console.log(`[CandleAggregator] ⚠️ Approaching timeout (${elapsedMs}ms), stopping ${symbol} at ${timeframe}`);
      return { candlesCreated, timedOut: true };
    }
    const timeframeMinutes = TIMEFRAME_MINUTES[timeframe];
    const lastCandleTime = await getLastCandleTime(symbol, timeframe);

    // CRITICAL FIX: Backfill ALL missing candles, not just the most recent one
    const currentCandleStart = roundTimeToCandle(now, timeframeMinutes);
    const previousCandleStart = new Date(currentCandleStart.getTime() - timeframeMinutes * 60 * 1000);

    // Determine starting point for backfill
    let startFrom: Date;
    if (lastCandleTime) {
      // Start from the next candle after the last one we have
      startFrom = new Date(lastCandleTime.getTime() + timeframeMinutes * 60 * 1000);
    } else {
      // No candles exist, start from lookback period
      // For fast timeframes (M1, M5, M15): 30 minutes is enough
      // For slow timeframes (H4, D1, W1): Will aggregate from M1 candles (goes back further automatically)
      startFrom = new Date(now.getTime() - lookbackMinutes * 60 * 1000);
      startFrom = roundTimeToCandle(startFrom, timeframeMinutes);
    }

    // Don't go beyond the previous completed candle
    const endAt = previousCandleStart;

    // BACKFILL LOOP: Create all missing candles
    let currentCandleToCreate = startFrom;
    let candlesCreatedForTimeframe = 0;

    while (currentCandleToCreate <= endAt) {
      const candleEndTime = new Date(currentCandleToCreate.getTime() + timeframeMinutes * 60 * 1000);

      // Skip if candle period is not complete yet (with 1 minute safety buffer)
      const bufferMs = 1 * 60 * 1000;
      if (candleEndTime > new Date(now.getTime() - bufferMs)) {
        break;
      }

      let candle: CandleData | null = null;

      // For large timeframes (H4, D1, W1), aggregate from existing M1 candles
      if (timeframe === 'H4' || timeframe === 'D1' || timeframe === 'W1') {
        candle = await aggregateFromM1Candles(symbol, timeframe, currentCandleToCreate, candleEndTime);
      }

      // For small timeframes, try SQL-based aggregation from raw prices
      if (!candle) {
        candle = await aggregateCandleSQL(symbol, timeframe, currentCandleToCreate, candleEndTime);
      }

      // FALLBACK: If SQL method fails, use in-memory aggregation
      if (!candle) {
        const candlePrices = prices.filter(p => {
          const priceTime = new Date(p.created_at);
          return priceTime >= currentCandleToCreate && priceTime < candleEndTime;
        });

        if (candlePrices.length > 0) {
          candle = calculateCandleFromPrices(candlePrices, symbol, timeframe, currentCandleToCreate);
        }
      }

      if (candle) {
        // CRITICAL: Check if candle is during market open hours
        // Skip weekend candles using proper EST/EDT timezone conversion
        if (!isMarketOpenAtTime(candle.open_time)) {
          // Skip weekend candle - market is closed
          currentCandleToCreate = new Date(currentCandleToCreate.getTime() + timeframeMinutes * 60 * 1000);
          continue;
        }

        // OPTIMIZATION: Collect candles for batch insert
        candlesToSave.push(candle);
      }

      // Move to next candle period
      currentCandleToCreate = new Date(currentCandleToCreate.getTime() + timeframeMinutes * 60 * 1000);
    }
  }

  // OPTIMIZATION: Batch save all candles at once (much faster than individual inserts)
  if (candlesToSave.length > 0) {
    console.log(`[CandleAggregator]   💾 ${symbol}: Saving ${candlesToSave.length} candles to database...`);
    const saved = await saveCandlesBatch(candlesToSave);
    candlesCreated = saved;
    console.log(`[CandleAggregator]   ✅ ${symbol}: Created ${saved} candles across ${timeframesToProcess.length} timeframes`);
  } else {
    console.log(`[CandleAggregator]   ℹ️ ${symbol}: No new candles to create`);
  }

  return { candlesCreated, timedOut: false };
}

export const handler: Handler = async (event, context) => {
  console.log('[CandleAggregator] Starting continuous candle aggregation...');
  const startTime = Date.now();

  try {
    // OPTIMIZATION: Determine which timeframes to process this run
    const timeframesToProcess = getTimeframesToProcess();

    // OPTIMIZATION: Process symbols sequentially with timeout protection
    // This is more reliable than Promise.allSettled for timeout detection
    let totalCandlesCreated = 0;
    let symbolsProcessed = 0;
    let symbolsTimedOut = 0;
    const symbolResults: Record<string, { candles: number; timedOut: boolean; error?: string }> = {};

    console.log(`[CandleAggregator] Starting loop for ${ACTIVE_SYMBOLS.length} symbols: ${ACTIVE_SYMBOLS.join(', ')}`);

    for (const symbol of ACTIVE_SYMBOLS) {
      console.log(`[CandleAggregator] ▶️ Processing symbol ${symbolsProcessed + 1}/${ACTIVE_SYMBOLS.length}: ${symbol}`);

      // Check if we're approaching timeout (leave 15 seconds for cleanup)
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs > 105000) { // 105 seconds (leave 15s buffer)
        console.log(`[CandleAggregator] ⚠️ Approaching function timeout (${elapsedMs}ms), stopping at ${symbol}`);
        break;
      }

      try {
        const result = await aggregateCandlesForSymbol(symbol, timeframesToProcess, startTime);
        totalCandlesCreated += result.candlesCreated;
        symbolsProcessed++;

        if (result.timedOut) {
          symbolsTimedOut++;
          symbolResults[symbol] = { candles: result.candlesCreated, timedOut: true };
          console.log(`[CandleAggregator]   ⏱️ ${symbol} timed out after creating ${result.candlesCreated} candles`);
        } else {
          symbolResults[symbol] = { candles: result.candlesCreated, timedOut: false };
          console.log(`[CandleAggregator]   ✅ ${symbol} completed: ${result.candlesCreated} candles created`);
        }
      } catch (error) {
        console.error(`[CandleAggregator] ❌ Error processing ${symbol}:`, error);
        symbolResults[symbol] = {
          candles: 0,
          timedOut: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
        // Continue processing other symbols even if one fails
        symbolsProcessed++;
      }
    }

    console.log(`[CandleAggregator] Loop completed. Processed ${symbolsProcessed}/${ACTIVE_SYMBOLS.length} symbols`);

    const duration = Date.now() - startTime;
    console.log(`[CandleAggregator] ✅ Completed in ${duration}ms: ${totalCandlesCreated} candles created`);
    console.log(`[CandleAggregator] Symbols: ${symbolsProcessed}/${ACTIVE_SYMBOLS.length} processed, ${symbolsTimedOut} timed out`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        candlesCreated: totalCandlesCreated,
        symbolsProcessed,
        symbolsTimedOut,
        totalSymbols: ACTIVE_SYMBOLS.length,
        timeframesProcessed: timeframesToProcess,
        durationMs: duration,
        symbolResults,
        timestamp: new Date().toISOString()
      })
    };
  } catch (error) {
    console.error('[CandleAggregator] Unexpected error:', error);
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
