import { supabase } from '@/lib/supabase';
import { Timeframe, appTimeframeToDb } from '@/services/chart-preferences';
import { normalizeTimestamp, getCurrentCandleStart, getLastCompletedCandleStart, isTimestampAligned } from '@/utils/timestampNormalizer';

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

const TIMEFRAME_MINUTES_MAP: Record<Timeframe, number> = {
  M1: 1,
  M5: 5,
  M15: 15,
  M30: 30,
  H1: 60,
  H4: 240,
  D1: 1440,
  W1: 10080,
};

const MAX_PRICE_DEVIATION_PERCENT = 10;

/**
 * CRITICAL: Sanitize candle data to ensure ALL values are primitive numbers, not objects
 * This prevents the Lightweight Charts error: "Cannot update oldest data, last time=[object Object]"
 */
export function sanitizeCandleData(candle: any): CandleData {
  // Handle time field - could be number, Date object, or string
  let timeValue: number;

  if (typeof candle.time === 'number') {
    timeValue = candle.time;
  } else if (candle.time instanceof Date) {
    // Convert Date object to Unix timestamp
    timeValue = Math.floor(candle.time.getTime() / 1000);
    console.warn('[CandleData] ⚠️ Converted Date object to timestamp:', candle.time, '->', timeValue);
  } else if (typeof candle.time === 'string') {
    // Convert ISO string to Unix timestamp
    timeValue = Math.floor(new Date(candle.time).getTime() / 1000);
    console.warn('[CandleData] ⚠️ Converted string to timestamp:', candle.time, '->', timeValue);
  } else if (typeof candle.time === 'object' && candle.time !== null) {
    // Handle any other object by trying to extract timestamp
    console.error('[CandleData] ❌ Unexpected object for time:', candle.time);
    timeValue = Math.floor(new Date(candle.time.toString()).getTime() / 1000);
  } else {
    console.error('[CandleData] ❌ Invalid time value:', candle.time);
    timeValue = 0; // Fallback
  }

  // Ensure all OHLC values are primitive numbers
  return {
    time: Number(timeValue),
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

export function getTimeframeMinutes(timeframe: Timeframe): number {
  return TIMEFRAME_MINUTES_MAP[timeframe] || 15;
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

    // CRITICAL FIX: Fetch from BOTH uppercase and lowercase formats to catch all data
    // Then deduplicate by timestamp to prevent overlaps
    const lowercaseFormat = timeframe.toLowerCase().replace(/^m/, '').replace(/^h/, '') +
      (timeframe.startsWith('M') ? 'm' : timeframe.startsWith('H') ? 'h' : timeframe.startsWith('D') ? '' : '');
    const lowercaseTimeframe = timeframe.startsWith('D') ? 'D1' :
      timeframe.startsWith('W') ? 'W1' :
      timeframe.replace(/^M/, '').replace(/^H/, '') + (timeframe.startsWith('M') ? 'm' : 'h');

    const { data: forexCandles, error: forexError } = await supabase
      .from('forex_candles')
      .select('open_time, open, high, low, close, volume')
      .eq('symbol', symbol)
      .in('timeframe', [dbTimeframe, lowercaseTimeframe])
      .order('open_time', { ascending: false })
      .limit(limit * 2); // Fetch more to account for potential duplicates

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

    forexCandles.forEach((candle) => {
      const timestamp = Math.floor(new Date(candle.open_time).getTime() / 1000);

      // Only keep the first occurrence of each timestamp (most recent in query order)
      if (!candleMap.has(timestamp)) {
        // CRITICAL FIX: Explicitly parse all numeric fields to ensure they're numbers, not strings/objects
        candleMap.set(timestamp, {
          time: timestamp,
          open: Number(candle.open),
          high: Number(candle.high),
          low: Number(candle.low),
          close: Number(candle.close),
          volume: Number(candle.volume || 0),
        });
      }
    });

    // Convert map to array, sort by time ascending, and limit to requested count
    const candles = Array.from(candleMap.values())
      .sort((a, b) => a.time - b.time)
      .slice(-limit);

    const duplicatesRemoved = forexCandles.length - candleMap.size;
    if (duplicatesRemoved > 0) {
      console.log(`[CandleData] Removed ${duplicatesRemoved} duplicate candles for ${symbol} ${timeframe}`);
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

  // CRITICAL: Use centralized timestamp normalization
  const currentCandleTimeSeconds = normalizeTimestamp(latestTimestampUtc, timeframe);

  const relevantPrices = prices.filter((price) => {
    const timestampUtc = parseUtcTimestamp(price.broker_time || price.created_at);
    const candleTimeSeconds = normalizeTimestamp(timestampUtc, timeframe);
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
