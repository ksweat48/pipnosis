import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const ACTIVE_SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];
const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'];

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
        return null;
      }
      console.error(`[CandleAggregator] SQL aggregation error:`, error.message);
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
    console.error(`[CandleAggregator] SQL aggregation unexpected error:`, error);
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

async function aggregateCandlesForSymbol(symbol: string): Promise<number> {
  // CRITICAL FIX: Fetch enough prices for ALL timeframes, including D1 and W1
  const lookbackMinutes = 24 * 60; // 24 hours of data
  const prices = await fetchRecentPrices(symbol, lookbackMinutes);

  if (prices.length === 0) {
    console.log(`[CandleAggregator] No prices found for ${symbol}`);
    return 0;
  }

  const firstPriceTime = new Date(prices[0].created_at);
  const lastPriceTime = new Date(prices[prices.length - 1].created_at);
  console.log(`[CandleAggregator] ${symbol}: Fetched ${prices.length} prices from ${firstPriceTime.toISOString()} to ${lastPriceTime.toISOString()}`);

  let candlesCreated = 0;
  const now = new Date();
  console.log(`[CandleAggregator] ${symbol}: Current time (now): ${now.toISOString()}`);

  for (const timeframe of TIMEFRAMES) {
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
      // No candles exist, start from 24 hours ago
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

        const saved = await saveCandleToDatabase(candle);
        if (saved) {
          candlesCreated++;
          candlesCreatedForTimeframe++;
        }
      }

      // Move to next candle period
      currentCandleToCreate = new Date(currentCandleToCreate.getTime() + timeframeMinutes * 60 * 1000);
    }

    if (candlesCreatedForTimeframe > 0) {
      console.log(`  ✅ ${symbol} ${timeframe}: Created ${candlesCreatedForTimeframe} candles`);
    }
  }

  return candlesCreated;
}

export const handler: Handler = async (event, context) => {
  console.log('[CandleAggregator] Starting continuous candle aggregation...');
  const startTime = Date.now();

  try {
    const results = await Promise.allSettled(
      ACTIVE_SYMBOLS.map(symbol => aggregateCandlesForSymbol(symbol))
    );

    const totalCandlesCreated = results.reduce((sum, result) => {
      if (result.status === 'fulfilled') {
        return sum + result.value;
      }
      return sum;
    }, 0);

    const duration = Date.now() - startTime;
    console.log(`[CandleAggregator] ✅ Completed in ${duration}ms: ${totalCandlesCreated} candles created`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        candlesCreated: totalCandlesCreated,
        symbolsProcessed: ACTIVE_SYMBOLS.length,
        durationMs: duration,
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
