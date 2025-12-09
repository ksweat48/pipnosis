import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const ACTIVE_SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];

// CRITICAL: Process M1, M5, M15 every run to ensure continuous data (runs every 5 min)
// These are the most commonly used timeframes and must always have fresh data
const FAST_TIMEFRAMES = ['M1', 'M5', 'M15']; // Process every run (5 min) - CRITICAL FOR PERSISTENCE
const MEDIUM_TIMEFRAMES = ['M30', 'H1']; // Process every 3rd run (15 min)
const SLOW_TIMEFRAMES = ['H4', 'D1', 'W1']; // Process every 12th run (60 min)
const ALL_TIMEFRAMES = [...FAST_TIMEFRAMES, ...MEDIUM_TIMEFRAMES, ...SLOW_TIMEFRAMES];

// SAFETY: Maximum candles to create per timeframe per run (prevents runaway processing)
const MAX_CANDLES_PER_TIMEFRAME = 3;

// WICK RECONSTRUCTION: Improve candle quality by adding realistic wicks
const ENABLE_WICK_RECONSTRUCTION = true;

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

/**
 * BREAKTHROUGH: Apply ATR-based wick reconstruction for low-tick candles
 * This dramatically improves chart quality by adding realistic wicks
 */
async function reconstructCandleWicks(candle: CandleData): Promise<CandleData> {
  // Only reconstruct if enabled and candle has low tick count
  if (!ENABLE_WICK_RECONSTRUCTION || candle.volume > 2) {
    return candle;
  }

  try {
    // Fetch recent candles for ATR calculation
    const { data: recentCandles } = await supabase
      .from('forex_candles')
      .select('open, high, low, close')
      .eq('symbol', candle.symbol)
      .eq('timeframe', candle.timeframe)
      .order('open_time', { ascending: false })
      .limit(14);

    if (!recentCandles || recentCandles.length < 5) {
      return candle; // Not enough data for reconstruction
    }

    // Calculate ATR (Average True Range)
    let totalTR = 0;
    let totalUpperWick = 0;
    let totalLowerWick = 0;
    let validCandles = 0;

    for (let i = 0; i < recentCandles.length - 1; i++) {
      const curr = recentCandles[i];
      const prev = recentCandles[i + 1];

      const tr = Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prev.close),
        Math.abs(curr.low - prev.close)
      );
      totalTR += tr;

      const bodySize = Math.abs(curr.close - curr.open);
      if (bodySize > 0) {
        const upperWick = curr.high - Math.max(curr.open, curr.close);
        const lowerWick = Math.min(curr.open, curr.close) - curr.low;
        totalUpperWick += upperWick / bodySize;
        totalLowerWick += lowerWick / bodySize;
        validCandles++;
      }
    }

    const atr = totalTR / (recentCandles.length - 1);
    const avgUpperWickPercent = validCandles > 0 ? totalUpperWick / validCandles : 0.3;
    const avgLowerWickPercent = validCandles > 0 ? totalLowerWick / validCandles : 0.3;

    // Reconstruct wicks
    const bodySize = Math.abs(candle.close - candle.open);
    if (bodySize === 0) {
      // Flat candle: use ATR to create realistic range
      const wickSize = atr * 0.5;
      const mid = candle.open;
      return {
        ...candle,
        high: Math.max(candle.high, mid + wickSize / 2),
        low: Math.min(candle.low, mid - wickSize / 2)
      };
    }

    // Normal candle: add wicks based on historical patterns
    const upperWick = bodySize * avgUpperWickPercent;
    const lowerWick = bodySize * avgLowerWickPercent;
    const bodyTop = Math.max(candle.open, candle.close);
    const bodyBottom = Math.min(candle.open, candle.close);

    return {
      ...candle,
      high: Math.max(candle.high, bodyTop + upperWick),
      low: Math.min(candle.low, bodyBottom - lowerWick)
    };
  } catch (error) {
    // If reconstruction fails, return original candle
    return candle;
  }
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
    // Apply wick reconstruction if needed
    const reconstructedCandle = await reconstructCandleWicks(candle);
    const qualityScore = candle.volume >= 3 ? 95 : 75; // Lower score for reconstructed candles

    const { error } = await supabase
      .from('forex_candles')
      .upsert({
        symbol: reconstructedCandle.symbol,
        timeframe: reconstructedCandle.timeframe,
        open_time: reconstructedCandle.open_time.toISOString(),
        close_time: reconstructedCandle.close_time.toISOString(),
        open: reconstructedCandle.open,
        high: reconstructedCandle.high,
        low: reconstructedCandle.low,
        close: reconstructedCandle.close,
        volume: reconstructedCandle.volume,
        tick_count: reconstructedCandle.volume,
        data_source: 'netlify_aggregator',
        quality_score: qualityScore
      }, {
        onConflict: 'symbol,timeframe,open_time',
        ignoreDuplicates: false
      });

    if (error) {
      console.error(`[CandleAggregator] Database error for ${candle.symbol} ${candle.timeframe}:`, error.message);
      return false;
    }

    if (reconstructedCandle.high !== candle.high || reconstructedCandle.low !== candle.low) {
      console.log(`[CandleAggregator] 🔧 Reconstructed wicks for ${candle.symbol} ${candle.timeframe} (${candle.volume} ticks)`);
    }

    return true;
  } catch (error) {
    console.error(`[CandleAggregator] Unexpected error saving candle:`, error);
    return false;
  }
}

/**
 * OPTIMIZATION: Batch save multiple candles in a single DB transaction
 * BREAKTHROUGH: Now includes wick reconstruction for better quality
 */
async function saveCandlesBatch(candles: CandleData[]): Promise<number> {
  if (candles.length === 0) return 0;

  try {
    // Apply wick reconstruction to all candles
    const reconstructedCandles = await Promise.all(
      candles.map(candle => reconstructCandleWicks(candle))
    );

    let reconstructedCount = 0;
    const candleRecords = reconstructedCandles.map((candle, index) => {
      const original = candles[index];
      const wasReconstructed = candle.high !== original.high || candle.low !== original.low;
      if (wasReconstructed) reconstructedCount++;

      const qualityScore = candle.volume >= 3 ? 95 : 75;

      return {
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
        data_source: 'netlify_aggregator',
        quality_score: qualityScore
      };
    });

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

    if (reconstructedCount > 0) {
      console.log(`[CandleAggregator] 🔧 Reconstructed wicks for ${reconstructedCount}/${candles.length} candles`);
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
  maxDurationMs: number = 5000 // 5 seconds per symbol (M1 only, much faster)
): Promise<{ candlesCreated: number; timedOut: boolean }> {
  const symbolStartTime = Date.now();
  console.log(`[CandleAggregator]   📊 Starting aggregation for ${symbol}...`);

  // OPTIMIZATION: Fetch only 3 minutes of recent prices (just 2-3 M1 candles max)
  const lookbackMinutes = 3; // CRITICAL: Reduced to 3 minutes for fastest processing
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
    const timeframeStartTime = Date.now();

    // TIMEOUT PROTECTION: Check if we're approaching the limit
    const elapsedMs = Date.now() - startTime;
    if (elapsedMs > maxDurationMs) {
      console.log(`[CandleAggregator] ⚠️ Approaching timeout (${elapsedMs}ms), stopping ${symbol} at ${timeframe}`);
      return { candlesCreated, timedOut: true };
    }

    console.log(`[CandleAggregator]     🔧 Processing ${symbol} ${timeframe}...`);
    const timeframeMinutes = TIMEFRAME_MINUTES[timeframe];

    // OPTIMIZATION: Fetch ALL existing candles for this time range in ONE query
    // This eliminates per-candle database queries in the loop
    const lookbackTime = new Date(now.getTime() - lookbackMinutes * 60 * 1000);
    const { data: existingCandles } = await supabase
      .from('forex_candles')
      .select('open_time')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .gte('open_time', lookbackTime.toISOString())
      .order('open_time', { ascending: true });

    // Create a Set of existing candle timestamps for O(1) lookup
    const existingCandleTimes = new Set(
      (existingCandles || []).map(c => new Date(c.open_time).getTime())
    );

    console.log(`[CandleAggregator]       📋 Found ${existingCandleTimes.size} existing ${timeframe} candles`);

    // CRITICAL: Only process the last 3 completed candles (not all 15 minutes)
    const currentCandleStart = roundTimeToCandle(now, timeframeMinutes);
    const previousCandleStart = new Date(currentCandleStart.getTime() - timeframeMinutes * 60 * 1000);

    // Start from 3 candles ago
    const startFrom = new Date(previousCandleStart.getTime() - (2 * timeframeMinutes * 60 * 1000));
    const endAt = previousCandleStart;

    // BACKFILL LOOP: Create all missing candles
    let currentCandleToCreate = startFrom;
    let candlesCreatedForTimeframe = 0;

    while (currentCandleToCreate <= endAt) {
      // TIMEOUT PROTECTION: Check inside the loop to prevent hanging
      const loopElapsedMs = Date.now() - startTime;
      if (loopElapsedMs > maxDurationMs) {
        console.log(`[CandleAggregator]       ⚠️ Timeout in while loop (${loopElapsedMs}ms), stopping ${symbol} ${timeframe}`);
        return { candlesCreated, timedOut: true };
      }

      // MAX CANDLES PROTECTION: Prevent creating too many candles per timeframe
      if (candlesCreatedForTimeframe >= MAX_CANDLES_PER_TIMEFRAME) {
        console.log(`[CandleAggregator]       ⚠️ Max candles reached (${MAX_CANDLES_PER_TIMEFRAME}) for ${symbol} ${timeframe}`);
        break;
      }

      const candleEndTime = new Date(currentCandleToCreate.getTime() + timeframeMinutes * 60 * 1000);

      // Skip if candle period is not complete yet (with 1 minute safety buffer)
      const bufferMs = 1 * 60 * 1000;
      if (candleEndTime > new Date(now.getTime() - bufferMs)) {
        break;
      }

      // OPTIMIZATION: Check if candle already exists (O(1) lookup in Set)
      if (existingCandleTimes.has(currentCandleToCreate.getTime())) {
        // Candle already exists, skip it
        currentCandleToCreate = new Date(currentCandleToCreate.getTime() + timeframeMinutes * 60 * 1000);
        continue;
      }

      let candle: CandleData | null = null;

      // FAST PATH: For M1, use in-memory aggregation from prices (no database queries)
      const candlePrices = prices.filter(p => {
        const priceTime = new Date(p.created_at);
        return priceTime >= currentCandleToCreate && priceTime < candleEndTime;
      });

      if (candlePrices.length > 0) {
        candle = calculateCandleFromPrices(candlePrices, symbol, timeframe, currentCandleToCreate);
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
        candlesCreatedForTimeframe++;
      }

      // Move to next candle period
      currentCandleToCreate = new Date(currentCandleToCreate.getTime() + timeframeMinutes * 60 * 1000);
    }

    // Performance logging for timeframe
    const timeframeDuration = Date.now() - timeframeStartTime;
    console.log(`[CandleAggregator]       ✅ ${symbol} ${timeframe}: ${candlesCreatedForTimeframe} candles queued (${timeframeDuration}ms)`);
  }

  // OPTIMIZATION: Batch save all candles at once (much faster than individual inserts)
  if (candlesToSave.length > 0) {
    const saveStartTime = Date.now();
    console.log(`[CandleAggregator]   💾 ${symbol}: Saving ${candlesToSave.length} candles to database...`);
    const saved = await saveCandlesBatch(candlesToSave);
    const saveDuration = Date.now() - saveStartTime;
    candlesCreated = saved;
    console.log(`[CandleAggregator]   ✅ ${symbol}: Created ${saved} candles across ${timeframesToProcess.length} timeframes (save: ${saveDuration}ms)`);
  } else {
    console.log(`[CandleAggregator]   ℹ️ ${symbol}: No new candles to create`);
  }

  const symbolTotalDuration = Date.now() - symbolStartTime;
  console.log(`[CandleAggregator]   ⏱️ ${symbol} completed in ${symbolTotalDuration}ms`);

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

      // Check if we're approaching timeout (5 symbols * 5s = 25s, leave 90s buffer)
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs > 30000) { // 30 seconds total (well under 120s Netlify timeout)
        console.log(`[CandleAggregator] ⚠️ Approaching function timeout (${elapsedMs}ms), stopping before ${symbol}`);
        symbolResults[symbol] = { candles: 0, timedOut: false, error: 'Function timeout - not processed' };
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
