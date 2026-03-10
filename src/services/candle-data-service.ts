import { supabase } from '@/lib/supabase';
import {
  type Timeframe,
  formatTimeframeForDb,
  TIMEFRAME_MINUTES,
  normalizeTimestampToTimeframe,
  getCurrentCandleStart,
  isTimestampAligned,
} from '@/config/timeframe-hierarchy';
import { isMarketOpenAt, getTimeframeLookbackHours } from '@/utils/marketHours';
import { prodLogger } from '@/lib/production-logger';

function appTimeframeToDb(timeframe: Timeframe): string {
  return formatTimeframeForDb(timeframe);
}

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface RealtimePrice {
  bid: string;
  ask: string;
  broker_time: string;
  created_at: string;
}

export interface CandleValidationResult {
  isValid: boolean;
  reason?: string;
  priceDeviation?: number;
}

const MAX_PRICE_DEVIATION_PERCENT = 10;

/**
 * CRITICAL: Convert any timestamp format to Unix timestamp (seconds)
 * Handles: numbers (seconds/milliseconds), Date objects, ISO strings, timestamptz strings
 * This is the SINGLE SOURCE OF TRUTH for timestamp conversion
 */
export function ensureUnixTimestamp(value: any, context: string = 'unknown'): number {
  // Already a valid Unix timestamp in seconds
  if (typeof value === 'number' && value > 0 && !isNaN(value)) {
    // Check if it's in milliseconds (> year 2100 in seconds)
    if (value > 4102444800) {
      const seconds = Math.floor(value / 1000);
      return seconds;
    }
    return value;
  }

  // Date object
  if (value instanceof Date) {
    const seconds = Math.floor(value.getTime() / 1000);
    return seconds;
  }

  // String (ISO or timestamp)
  if (typeof value === 'string') {
    // Handle numeric strings
    if (/^\d+$/.test(value)) {
      const numValue = parseInt(value, 10);
      if (!isNaN(numValue)) {
        return ensureUnixTimestamp(numValue, context);
      }
    }

    // Handle ISO strings
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      const seconds = Math.floor(date.getTime() / 1000);
      return seconds;
    }
  }

  // Handle plain objects with numeric value (sometimes Supabase returns this)
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    // Try valueOf() method
    if (typeof value.valueOf === 'function') {
      const primitiveValue = value.valueOf();
      if (typeof primitiveValue === 'number' || typeof primitiveValue === 'string') {
        return ensureUnixTimestamp(primitiveValue, context);
      }
    }

    // Try toString() if it gives us something useful
    if (typeof value.toString === 'function') {
      const stringValue = value.toString();
      if (stringValue !== '[object Object]') {
        return ensureUnixTimestamp(stringValue, context);
      }
    }
  }

  // Fallback for invalid values - throw error instead of returning bad data
  console.error(`[${context}] ⚠️ INVALID TIMESTAMP TYPE: ${typeof value}, value:`, value);
  console.error(`[${context}] CRITICAL: Cannot convert to Unix timestamp, throwing error`);
  throw new Error(`Invalid timestamp value: ${JSON.stringify(value)}`);
}

/**
 * CRITICAL: Convert Unix timestamp (seconds) back to PostgreSQL timestamptz format
 * This is the REVERSE of ensureUnixTimestamp() - for database inserts
 *
 * @param unixSeconds - Unix timestamp in seconds
 * @param context - Context string for logging
 * @returns ISO 8601 timestamp string that PostgreSQL can accept
 */
export function unixTimestampToPostgresTimestamp(unixSeconds: any, context: string = 'unknown'): string {
  // If already a string (ISO format), validate and return
  if (typeof unixSeconds === 'string') {
    const date = new Date(unixSeconds);
    if (!isNaN(date.getTime())) {
      return unixSeconds; // Already valid ISO string
    }
  }

  // If it's a Date object, convert to ISO
  if (unixSeconds instanceof Date) {
    return unixSeconds.toISOString();
  }

  // Must be a number (Unix timestamp in seconds)
  if (typeof unixSeconds !== 'number') {
    console.error(`[${context}] ⚠️ Invalid timestamp for database: ${typeof unixSeconds}`, unixSeconds);
    // Return current time as fallback
    return new Date().toISOString();
  }

  // Validate timestamp is reasonable (between year 2000 and 2100)
  // Unix timestamp for 2000-01-01: 946684800
  // Unix timestamp for 2100-01-01: 4102444800
  if (unixSeconds < 946684800 || unixSeconds > 4102444800) {
    console.error(`[${context}] ⚠️ Timestamp out of reasonable range: ${unixSeconds} (${new Date(unixSeconds * 1000).toISOString()})`);
    return new Date().toISOString();
  }

  // Convert Unix seconds to ISO string for PostgreSQL
  const isoString = new Date(unixSeconds * 1000).toISOString();
  console.log(`[${context}] Converted Unix seconds to ISO: ${unixSeconds} -> ${isoString}`);
  return isoString;
}

/**
 * CRITICAL: Sanitize candle data to ensure ALL values are primitive numbers, not objects
 * This prevents the Lightweight Charts error: "Cannot update oldest data, last time=[object Object]"
 */
export function sanitizeCandleData(candle: any): CandleData {
  // Use the robust timestamp converter
  const timeValue = ensureUnixTimestamp(candle.time, 'sanitizeCandleData');

  // CRITICAL TYPE CHECK: Ensure timeValue is actually a number
  if (typeof timeValue !== 'number' || isNaN(timeValue)) {
    console.error('[sanitizeCandleData] ❌ CRITICAL: timeValue is not a valid number:', {
      timeValue,
      type: typeof timeValue,
      originalCandle: candle
    });
    throw new Error(`Invalid timestamp after conversion: ${timeValue}`);
  }

  // Ensure all OHLC values are primitive numbers
  return {
    time: timeValue,
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    volume: candle.volume !== undefined ? Number(candle.volume) : undefined
  };
}

/**
 * Sanitize an array of candles, removing any with invalid data
 */
export function sanitizeCandleArray(candles: any[]): CandleData[] {
  return candles
    .map(sanitizeCandleData)
    .filter(candle => {
      // Validate all values are valid numbers
      if (isNaN(candle.time) || isNaN(candle.open) || isNaN(candle.high) ||
          isNaN(candle.low) || isNaN(candle.close)) {
        console.error('[CandleData] ❌ Filtered out candle with NaN values:', candle);
        return false;
      }
      return true;
    });
}

function deduplicateCandles(candles: CandleData[]): CandleData[] {
  if (candles.length === 0) return [];

  const uniqueMap = new Map<number, CandleData>();

  // Keep the first occurrence of each timestamp
  candles.forEach(candle => {
    if (!uniqueMap.has(candle.time)) {
      uniqueMap.set(candle.time, candle);
    }
  });

  // Sort by time ascending
  const deduplicated = Array.from(uniqueMap.values())
    .sort((a, b) => a.time - b.time);

  const duplicatesRemoved = candles.length - deduplicated.length;
  if (duplicatesRemoved > 0) {
    console.log(`[CandleData] Deduplicated: removed ${duplicatesRemoved} duplicate timestamps from ${candles.length} candles`);
  }

  return deduplicated;
}

/**
 * CRITICAL: Filter out candles from closed market periods (Saturday, Friday after 5pm EST, Sunday before 5pm EST)
 * This prevents fake/reconstructed candles from appearing on charts
 */
function filterCandlesByMarketHours(candles: CandleData[], symbol: string): CandleData[] {
  if (candles.length === 0) return [];

  const filtered = candles.filter(candle => {
    const isOpen = isMarketOpenAt(candle.time);
    if (!isOpen) {
      const dateStr = new Date(candle.time * 1000).toISOString();
      console.log(`[CandleData] 🚫 Filtered out closed-market candle for ${symbol}: ${dateStr}`);
    }
    return isOpen;
  });

  const removedCount = candles.length - filtered.length;
  if (removedCount > 0) {
    console.log(`[CandleData] ✅ Removed ${removedCount} closed-market candles for ${symbol}`);
  }

  return filtered;
}

export function getTimeframeMinutes(timeframe: Timeframe): number {
  return TIMEFRAME_MINUTES[timeframe] || 15;
}

export function validateCandleAgainstHistorical(
  newCandle: CandleData,
  historicalCandles: CandleData[],
  symbol: string
): CandleValidationResult {
  if (!newCandle || !newCandle.close || newCandle.close <= 0) {
    return {
      isValid: false,
      reason: 'Invalid candle data: missing or zero close price'
    };
  }

  if (historicalCandles.length === 0) {
    return { isValid: true };
  }

  const lastHistorical = historicalCandles[historicalCandles.length - 1];
  const recentCandles = historicalCandles.slice(-20);

  const avgPrice = recentCandles.reduce((sum, c) => sum + c.close, 0) / recentCandles.length;
  const maxPrice = Math.max(...recentCandles.map(c => c.high));
  const minPrice = Math.min(...recentCandles.map(c => c.low));

  const priceRange = maxPrice - minPrice;
  const expectedRange = avgPrice * (MAX_PRICE_DEVIATION_PERCENT / 100);
  const allowedMax = avgPrice + expectedRange;
  const allowedMin = avgPrice - expectedRange;

  if (newCandle.close > allowedMax || newCandle.close < allowedMin) {
    const deviation = ((Math.abs(newCandle.close - avgPrice) / avgPrice) * 100).toFixed(2);
    console.error(
      `[CandleValidation] ❌ ${symbol} - Price anomaly detected!`,
      `\n  New candle close: ${newCandle.close}`,
      `\n  Recent avg price: ${avgPrice.toFixed(5)}`,
      `\n  Allowed range: ${allowedMin.toFixed(5)} - ${allowedMax.toFixed(5)}`,
      `\n  Deviation: ${deviation}% (max allowed: ${MAX_PRICE_DEVIATION_PERCENT}%)`,
      `\n  Last historical: ${lastHistorical.close}`,
      `\n  Time: ${new Date(newCandle.time * 1000).toISOString()}`
    );

    return {
      isValid: false,
      reason: `Price deviation too large: ${deviation}% (avg: ${avgPrice.toFixed(5)}, new: ${newCandle.close})`,
      priceDeviation: parseFloat(deviation)
    };
  }

  const timeDiff = newCandle.time - lastHistorical.time;
  if (timeDiff < 0) {
    return {
      isValid: false,
      reason: `New candle time (${newCandle.time}) is before last historical time (${lastHistorical.time})`
    };
  }

  console.log(
    `[CandleValidation] ✓ ${symbol} - Candle validated`,
    `close: ${newCandle.close}, avg: ${avgPrice.toFixed(5)}, range: ${minPrice.toFixed(5)}-${maxPrice.toFixed(5)}`
  );

  return { isValid: true };
}

export async function fetchPreAggregatedCandles(
  symbol: string,
  timeframe: Timeframe,
  limit: number = 500
): Promise<CandleData[]> {
  try {
    const dbTimeframe = appTimeframeToDb(timeframe);

    // CRITICAL FIX: For lower timeframes, use time-based queries instead of count-based
    // This ensures we get enough historical data even when market is closed
    const usesTimeBasedQuery = ['M1', 'M5', 'M15', 'M30'].includes(timeframe);

    let forexCandles: any[] = [];
    let forexError: any = null;

    if (usesTimeBasedQuery) {
      // TIME-BASED QUERY: Fetch by time range for lower timeframes
      const lookbackHours = getTimeframeLookbackHours(timeframe);
      const now = new Date();
      const startTime = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);

      console.log(`[CandleData] Using time-based query for ${symbol} ${timeframe}: last ${lookbackHours} hours`);

      const lowercaseFormat = timeframe.toLowerCase().replace(/^m/, '').replace(/^h/, '') +
        (timeframe.startsWith('M') ? 'm' : timeframe.startsWith('H') ? 'h' : timeframe.startsWith('D') ? '' : '');
      const lowercaseTimeframe = timeframe.startsWith('D') ? 'D1' :
        timeframe.startsWith('W') ? 'W1' :
        timeframe.replace(/^M/, '').replace(/^H/, '') + (timeframe.startsWith('M') ? 'm' : 'h');

      const { data, error } = await supabase
        .from('forex_candles_best')
        .select('open_time, open, high, low, close, volume')
        .eq('symbol', symbol)
        .in('timeframe', [dbTimeframe, lowercaseTimeframe])
        .gte('open_time', startTime.toISOString())
        .order('open_time', { ascending: true });

      forexCandles = data || [];
      forexError = error;
    } else {
      // COUNT-BASED QUERY: Use traditional limit-based query for higher timeframes
      const lowercaseFormat = timeframe.toLowerCase().replace(/^m/, '').replace(/^h/, '') +
        (timeframe.startsWith('M') ? 'm' : timeframe.startsWith('H') ? 'h' : timeframe.startsWith('D') ? '' : '');
      const lowercaseTimeframe = timeframe.startsWith('D') ? 'D1' :
        timeframe.startsWith('W') ? 'W1' :
        timeframe.replace(/^M/, '').replace(/^H/, '') + (timeframe.startsWith('M') ? 'm' : 'h');

      const { data, error } = await supabase
        .from('forex_candles_best')
        .select('open_time, open, high, low, close, volume')
        .eq('symbol', symbol)
        .in('timeframe', [dbTimeframe, lowercaseTimeframe])
        .order('open_time', { ascending: false })
        .limit(limit * 2); // Fetch more to account for potential duplicates

      forexCandles = data || [];
      forexError = error;
    }

    if (forexError) {
      console.error('Error fetching pre-aggregated candles:', forexError);
      return [];
    }

    if (!forexCandles || forexCandles.length === 0) {
      console.warn(`No pre-aggregated candles found for ${symbol} ${timeframe} (db: ${dbTimeframe})`);
      return [];
    }

    // Convert to standard format and deduplicate by timestamp
    const candleMap = new Map<number, CandleData>();

    forexCandles.forEach((candle, index) => {
      try {
        // CRITICAL FIX: Use robust timestamp converter to handle ALL data types from Supabase
        // open_time could be: Date object, ISO string, or already a number
        const timestamp = ensureUnixTimestamp(candle.open_time, 'fetchPreAggregatedCandles');

        // Validate timestamp is reasonable (after year 2020, before year 2100)
        if (timestamp < 1577836800 || timestamp > 4102444800) {
          console.warn(`[fetchPreAggregatedCandles] Skipping candle ${index} with invalid timestamp: ${timestamp}`);
          return;
        }

        // Only keep the first occurrence of each timestamp (most recent in query order)
        if (!candleMap.has(timestamp)) {
          // CRITICAL FIX: Explicitly parse all numeric fields to ensure they're numbers, not strings/objects
          const candleData = {
            time: timestamp,
            open: Number(candle.open),
            high: Number(candle.high),
            low: Number(candle.low),
            close: Number(candle.close),
            volume: Number(candle.volume || 0),
          };

          // Validate all prices are valid numbers
          if (isNaN(candleData.open) || isNaN(candleData.high) || isNaN(candleData.low) || isNaN(candleData.close)) {
            console.warn(`[fetchPreAggregatedCandles] Skipping candle ${index} with invalid prices:`, candle);
            return;
          }

          // Reject flat/ghost candles (open=high=low=close with zero range)
          if (candleData.open === candleData.high && candleData.high === candleData.low && candleData.low === candleData.close) {
            return;
          }

          // CRITICAL FIX: Validate OHLC relationships
          if (candleData.high < candleData.low) {
            console.warn(`[fetchPreAggregatedCandles] ❌ REJECTED candle ${index}: high ${candleData.high} < low ${candleData.low}`);
            return;
          }

          if (candleData.open < candleData.low || candleData.open > candleData.high) {
            console.warn(`[fetchPreAggregatedCandles] ❌ REJECTED candle ${index}: open ${candleData.open} outside [${candleData.low}, ${candleData.high}]`);
            return;
          }

          if (candleData.close < candleData.low || candleData.close > candleData.high) {
            console.warn(`[fetchPreAggregatedCandles] ❌ REJECTED candle ${index}: close ${candleData.close} outside [${candleData.low}, ${candleData.high}]`);
            return;
          }

          // CRITICAL FIX: Check for extreme candle range (> 5% indicates bad data)
          const candleRange = candleData.high - candleData.low;
          const avgPrice = (candleData.open + candleData.close) / 2;
          const rangePercent = (candleRange / avgPrice) * 100;

          if (rangePercent > 5) {
            console.warn(`[fetchPreAggregatedCandles] ❌ REJECTED candle ${index} for ${symbol}: extreme range ${rangePercent.toFixed(2)}% (O:${candleData.open} H:${candleData.high} L:${candleData.low} C:${candleData.close})`);
            return;
          }

          // CRITICAL FIX: Check for abnormal wick-to-body ratio
          const candleBody = Math.abs(candleData.close - candleData.open);
          const wickSize = candleRange - candleBody;

          if (candleBody > 0 && wickSize / candleBody > 10) {
            prodLogger.dev(`[fetchPreAggregatedCandles] ⚠️ WARNING candle ${index} for ${symbol}: excessive wick ${(wickSize/candleBody).toFixed(1)}x body (may skip)`);
            // Still allow but log warning - might be valid spike
          }

          candleMap.set(timestamp, candleData);
        }
      } catch (error) {
        console.error(`[fetchPreAggregatedCandles] Failed to process candle ${index}:`, error, candle);
        // Continue processing other candles
      }
    });

    // Convert map to array and sort by time ascending
    let candles = Array.from(candleMap.values())
      .sort((a, b) => a.time - b.time);

    const duplicatesRemoved = forexCandles.length - candleMap.size;
    if (duplicatesRemoved > 0) {
      console.log(`[CandleData] Removed ${duplicatesRemoved} duplicate candles for ${symbol} ${timeframe}`);
    }

    // HISTORICAL DATA: Keep all candles for historical display - market hours filter removed
    // This allows viewing complete historical data including weekends
    // candles = filterCandlesByMarketHours(candles, symbol);

    // For count-based queries, apply limit after filtering
    if (!usesTimeBasedQuery) {
      candles = candles.slice(-limit);
    }

    console.log(`Loaded ${candles.length} pre-aggregated candles from forex_candles for ${symbol} ${timeframe} (db: ${dbTimeframe})`);
    return candles;
  } catch (error) {
    console.error('Error fetching pre-aggregated candles:', error);
    return [];
  }
}

export async function fetchRecentRealtimePrices(
  symbol: string,
  minutesBack: number = 60
): Promise<RealtimePrice[]> {
  try {
    const nowUtc = new Date();
    const startTimeUtc = new Date(nowUtc.getTime() - minutesBack * 60 * 1000);

    const { data, error } = await supabase
      .from('realtime_prices')
      .select('bid, ask, broker_time, created_at')
      .eq('symbol', symbol)
      .gte('created_at', startTimeUtc.toISOString())
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching recent realtime prices:', error);
      return [];
    }

    return (data || []) as RealtimePrice[];
  } catch (error) {
    console.error('Error fetching recent realtime prices:', error);
    return [];
  }
}

function parseUtcTimestamp(timeString: string): number {
  const date = new Date(timeString);
  if (isNaN(date.getTime())) {
    console.warn(`Invalid timestamp: ${timeString}, using current time`);
    return Date.now();
  }
  return date.getTime();
}

/**
 * CRITICAL: Validate that a candle timestamp is properly normalized
 * This prevents overlapping candles and timing issues
 */
function validateTimestamp(timestampSeconds: number, timeframe: Timeframe, context: string): boolean {
  if (!isTimestampAligned(timestampSeconds, timeframe)) {
    console.error(`[${context}] ❌ MISALIGNED TIMESTAMP: ${timestampSeconds} is not aligned to ${timeframe}`);
    return false;
  }
  return true;
}

export function aggregatePricesToCurrentCandle(
  prices: RealtimePrice[],
  timeframe: Timeframe,
  historicalCandles?: CandleData[],
  symbol?: string
): CandleData | null {
  if (prices.length === 0) return null;

  const latestPrice = prices[prices.length - 1];
  const latestTimestampUtc = parseUtcTimestamp(latestPrice.broker_time || latestPrice.created_at);

  const currentCandleTimeSeconds = normalizeTimestampToTimeframe(latestTimestampUtc, timeframe);

  const relevantPrices = prices.filter((price) => {
    const timestampUtc = parseUtcTimestamp(price.broker_time || price.created_at);
    const candleTimeSeconds = normalizeTimestampToTimeframe(timestampUtc, timeframe);
    return candleTimeSeconds === currentCandleTimeSeconds;
  });

  if (relevantPrices.length === 0) return null;

  const midPrices = relevantPrices.map((price) => {
    const bid = parseFloat(price.bid);
    const ask = parseFloat(price.ask);
    return (bid + ask) / 2;
  });

  const aggregatedCandle: CandleData = {
    time: currentCandleTimeSeconds,
    open: midPrices[0],
    high: Math.max(...midPrices),
    low: Math.min(...midPrices),
    close: midPrices[midPrices.length - 1],
  };

  // Validate timestamp alignment
  if (!validateTimestamp(aggregatedCandle.time, timeframe, 'aggregatePricesToCurrentCandle')) {
    console.error(`[ChartData] Rejecting misaligned aggregated candle`);
    return null;
  }

  if (historicalCandles && historicalCandles.length > 0 && symbol) {
    const validation = validateCandleAgainstHistorical(aggregatedCandle, historicalCandles, symbol);
    if (!validation.isValid) {
      console.error(`[ChartData] Rejecting aggregated current candle: ${validation.reason}`);
      return null;
    }
  }

  return aggregatedCandle;
}

function getCurrentCandleStartTime(timeframe: Timeframe): number {
  // CRITICAL: Use centralized timestamp normalization
  return getCurrentCandleStart(timeframe);
}

export async function fetchCompleteChartData(
  symbol: string,
  timeframe: Timeframe,
  limit: number = 500
): Promise<{ historical: CandleData[]; current: CandleData | null }> {
  console.log(`[ChartData] Fetching complete data for ${symbol} ${timeframe}, limit: ${limit}`);

  const currentCandleStartTime = getCurrentCandleStart(timeframe);
  console.log(`[ChartData] Current candle period starts at: ${new Date(currentCandleStartTime * 1000).toISOString()} (${currentCandleStartTime})`);

  const [historicalCandles, recentPrices] = await Promise.all([
    fetchPreAggregatedCandles(symbol, timeframe, limit),
    fetchRecentRealtimePrices(symbol, getTimeframeMinutes(timeframe) * 2),
  ]);

  console.log(`[ChartData] Loaded ${historicalCandles.length} historical candles, ${recentPrices.length} recent prices`);

  if (historicalCandles.length > 0) {
    const lastHistorical = historicalCandles[historicalCandles.length - 1];
    console.log(`[ChartData] Last historical candle: ${new Date(lastHistorical.time * 1000).toISOString()} - Close: ${lastHistorical.close}`);
    console.log(`[ChartData] Time difference: ${(currentCandleStartTime - lastHistorical.time) / 60} minutes`);
  }

  const currentCandle = aggregatePricesToCurrentCandle(recentPrices, timeframe, historicalCandles, symbol);

  if (currentCandle) {
    console.log(`[ChartData] Current candle aggregated: ${new Date(currentCandle.time * 1000).toISOString()} - OHLC: ${currentCandle.open}/${currentCandle.high}/${currentCandle.low}/${currentCandle.close}`);
  } else if (recentPrices.length > 0) {
    console.warn(`[ChartData] Could not aggregate current candle from ${recentPrices.length} recent prices (likely failed validation)`);
  }

  // CRITICAL FIX: Deduplicate and validate historical candles before merging
  const deduplicatedHistorical = deduplicateCandles(historicalCandles);

  let finalHistorical = deduplicatedHistorical;
  let finalCurrent: CandleData | null = currentCandle;

  if (currentCandle && deduplicatedHistorical.length > 0) {
    const lastHistoricalTime = deduplicatedHistorical[deduplicatedHistorical.length - 1].time;

    if (currentCandle.time === lastHistoricalTime) {
      console.warn(`[ChartData] WARNING: Current candle overlaps with last historical - removing last historical`);
      finalHistorical = [...deduplicatedHistorical.slice(0, -1)];
    } else if (currentCandle.time < lastHistoricalTime) {
      console.error(`[ChartData] ERROR: Current candle time ${currentCandle.time} < last historical ${lastHistoricalTime}`);
      console.error(`[ChartData] This indicates historical data includes incomplete candles - ignoring current`);
      return {
        historical: deduplicatedHistorical,
        current: null,
      };
    } else if (currentCandle.time === currentCandleStartTime) {
      console.log(`[ChartData] ✓ Perfect alignment: Current candle starts exactly where expected`);
    } else {
      console.warn(`[ChartData] Current candle time mismatch: got ${currentCandle.time}, expected ${currentCandleStartTime}`);
    }

    const timeDiff = currentCandle.time - lastHistoricalTime;
    const intervalSeconds = getTimeframeMinutes(timeframe) * 60;
    if (timeDiff === intervalSeconds) {
      console.log(`[ChartData] ✓ PERFECT CONTINUITY: Exactly one ${timeframe} interval between historical and live data`);
    } else if (timeDiff > intervalSeconds) {
      console.warn(`[ChartData] GAP DETECTED: ${timeDiff / 60} minutes between last historical and current (expected ${intervalSeconds / 60})`);
    }
  }

  if (finalHistorical.length > 0 && finalCurrent) {
    console.log(`[ChartData] Final result: ${finalHistorical.length} historical candles + 1 current candle`);
    console.log(`[ChartData] Chart range: ${new Date(finalHistorical[0].time * 1000).toISOString()} to ${new Date(finalCurrent.time * 1000).toISOString()}`);
  }

  return {
    historical: finalHistorical,
    current: finalCurrent,
  };
}

/**
 * ENHANCED: Fetch candles by time range instead of count
 * This prevents gaps when user returns after being away
 */
export async function fetchCandlesByTimeRange(
  symbol: string,
  timeframe: Timeframe,
  hoursBack: number = 24
): Promise<CandleData[]> {
  try {
    const dbTimeframe = appTimeframeToDb(timeframe);

    // CRITICAL: Use smart lookback hours for lower timeframes
    const smartHoursBack = getTimeframeLookbackHours(timeframe);
    const effectiveHoursBack = Math.max(hoursBack, smartHoursBack);

    const now = new Date();
    const startTime = new Date(now.getTime() - effectiveHoursBack * 60 * 60 * 1000);

    console.log(`[ChartData] Fetching candles for ${symbol} ${timeframe} from last ${effectiveHoursBack} hours`);
    console.log(`[ChartData] Time range: ${startTime.toISOString()} to ${now.toISOString()}`);

    const lowercaseFormat = timeframe.toLowerCase().replace(/^m/, '').replace(/^h/, '') +
      (timeframe.startsWith('M') ? 'm' : timeframe.startsWith('H') ? 'h' : timeframe.startsWith('D') ? '' : '');
    const lowercaseTimeframe = timeframe.startsWith('D') ? 'D1' :
      timeframe.startsWith('W') ? 'W1' :
      timeframe.replace(/^M/, '').replace(/^H/, '') + (timeframe.startsWith('M') ? 'm' : 'h');

    const { data: forexCandles, error: forexError } = await supabase
      .from('forex_candles_best')
      .select('open_time, open, high, low, close, volume, data_source')
      .eq('symbol', symbol)
      .in('timeframe', [dbTimeframe, lowercaseTimeframe])
      .gte('open_time', startTime.toISOString())
      .order('open_time', { ascending: true });

    if (forexError) {
      console.error('[ChartData] Error fetching candles by time range:', forexError);
      return [];
    }

    if (!forexCandles || forexCandles.length === 0) {
      console.warn(`[ChartData] No candles found for ${symbol} ${timeframe} in last ${effectiveHoursBack} hours`);
      return [];
    }

    // Convert and deduplicate
    const candleMap = new Map<number, CandleData>();

    forexCandles.forEach((candle, index) => {
      try {
        const timestamp = ensureUnixTimestamp(candle.open_time, 'fetchCandlesByTimeRange');

        if (timestamp < 1577836800 || timestamp > 4102444800) {
          console.warn(`[ChartData] Skipping candle ${index} with invalid timestamp: ${timestamp}`);
          return;
        }

        if (!candleMap.has(timestamp)) {
          const candleData = {
            time: timestamp,
            open: Number(candle.open),
            high: Number(candle.high),
            low: Number(candle.low),
            close: Number(candle.close),
            volume: Number(candle.volume || 0),
          };

          if (isNaN(candleData.open) || isNaN(candleData.high) || isNaN(candleData.low) || isNaN(candleData.close)) {
            console.warn(`[ChartData] Skipping candle ${index} with invalid prices`);
            return;
          }

          candleMap.set(timestamp, candleData);
        }
      } catch (error) {
        console.error(`[ChartData] Failed to process candle ${index}:`, error);
      }
    });

    let candles = Array.from(candleMap.values()).sort((a, b) => a.time - b.time);

    // HISTORICAL DATA: Keep all candles for historical display - market hours filter removed
    // candles = filterCandlesByMarketHours(candles, symbol);

    console.log(`[ChartData] ✓ Loaded ${candles.length} candles from last ${effectiveHoursBack} hours`);
    if (candles.length > 0) {
      console.log(`[ChartData] Range: ${new Date(candles[0].time * 1000).toISOString()} to ${new Date(candles[candles.length - 1].time * 1000).toISOString()}`);
    }

    return candles;
  } catch (error) {
    console.error('[ChartData] Error fetching candles by time range:', error);
    return [];
  }
}

/**
 * ENHANCED: Fetch complete chart data using time-based approach
 * Ensures all candles from last N hours are loaded, eliminating gaps
 */
export async function fetchCompleteChartDataByTime(
  symbol: string,
  timeframe: Timeframe,
  hoursBack: number = 24
): Promise<{ historical: CandleData[]; current: CandleData | null }> {
  console.log(`[ChartData] Fetching time-based chart data for ${symbol} ${timeframe} (last ${hoursBack} hours)`);

  const currentCandleStartTime = getCurrentCandleStart(timeframe);
  console.log(`[ChartData] Current candle period starts at: ${new Date(currentCandleStartTime * 1000).toISOString()}`);

  const [historicalCandles, recentPrices] = await Promise.all([
    fetchCandlesByTimeRange(symbol, timeframe, hoursBack),
    fetchRecentRealtimePrices(symbol, getTimeframeMinutes(timeframe) * 2),
  ]);

  console.log(`[ChartData] Loaded ${historicalCandles.length} historical candles, ${recentPrices.length} recent prices`);

  if (historicalCandles.length > 0) {
    const lastHistorical = historicalCandles[historicalCandles.length - 1];
    console.log(`[ChartData] Last historical candle: ${new Date(lastHistorical.time * 1000).toISOString()} - Close: ${lastHistorical.close}`);
    console.log(`[ChartData] Time difference to current: ${(currentCandleStartTime - lastHistorical.time) / 60} minutes`);
  }

  const currentCandle = aggregatePricesToCurrentCandle(recentPrices, timeframe, historicalCandles, symbol);

  if (currentCandle) {
    console.log(`[ChartData] Current candle aggregated: ${new Date(currentCandle.time * 1000).toISOString()}`);
  }

  const deduplicatedHistorical = deduplicateCandles(historicalCandles);
  let finalHistorical = deduplicatedHistorical;
  let finalCurrent: CandleData | null = currentCandle;

  if (currentCandle && deduplicatedHistorical.length > 0) {
    const lastHistoricalTime = deduplicatedHistorical[deduplicatedHistorical.length - 1].time;

    if (currentCandle.time === lastHistoricalTime) {
      console.warn(`[ChartData] Current candle overlaps with last historical - removing last historical`);
      finalHistorical = [...deduplicatedHistorical.slice(0, -1)];
    } else if (currentCandle.time < lastHistoricalTime) {
      console.error(`[ChartData] ERROR: Current candle time < last historical`);
      return {
        historical: deduplicatedHistorical,
        current: null,
      };
    }

    const timeDiff = currentCandle.time - lastHistoricalTime;
    const intervalSeconds = getTimeframeMinutes(timeframe) * 60;

    if (timeDiff === intervalSeconds) {
      console.log(`[ChartData] ✓ PERFECT CONTINUITY: Exactly one ${timeframe} interval`);
    } else if (timeDiff > intervalSeconds) {
      const gapMinutes = timeDiff / 60;
      const expectedCandles = gapMinutes / getTimeframeMinutes(timeframe);
      console.warn(`[ChartData] ⚠️ GAP DETECTED: ${gapMinutes} minutes gap (${expectedCandles} missing candles)`);
    }
  }

  console.log(`[ChartData] ✓ Final result: ${finalHistorical.length} historical + ${finalCurrent ? 1 : 0} current candle`);

  return {
    historical: finalHistorical,
    current: finalCurrent,
  };
}
