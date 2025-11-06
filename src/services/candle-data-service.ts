import { supabase } from '@/lib/supabase';
import { Timeframe } from '@/services/chart-preferences';

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

export function getTimeframeMinutes(timeframe: Timeframe): number {
  return TIMEFRAME_MINUTES_MAP[timeframe] || 15;
}

const TIMEFRAME_MAX_AGE_HOURS: Record<Timeframe, number> = {
  M1: 24,
  M5: 48,
  M15: 72,
  M30: 168,
  H1: 336,
  H4: 720,
  D1: 2160,
  W1: 4320,
};

function getMaxCandleAge(timeframe: Timeframe): number {
  return TIMEFRAME_MAX_AGE_HOURS[timeframe] || 168;
}

function filterStaleCandles(
  candles: CandleData[],
  timeframe: Timeframe,
  referenceTime: number = Date.now()
): { filtered: CandleData[]; removed: number } {
  if (candles.length === 0) {
    return { filtered: [], removed: 0 };
  }

  const maxAgeHours = getMaxCandleAge(timeframe);
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const cutoffTime = Math.floor((referenceTime - maxAgeMs) / 1000);

  const filtered = candles.filter(candle => candle.time >= cutoffTime);
  const removed = candles.length - filtered.length;

  if (removed > 0) {
    console.log(
      `[CandleFilter] Removed ${removed} stale candles older than ${maxAgeHours} hours for timeframe ${timeframe}`
    );
  }

  return { filtered, removed };
}

function validateTimeContinuity(
  historical: CandleData[],
  current: CandleData | null,
  timeframe: Timeframe
): { isValid: boolean; gapSize?: number; warning?: string } {
  if (!current || historical.length === 0) {
    return { isValid: true };
  }

  const lastHistorical = historical[historical.length - 1];
  const timeDiff = current.time - lastHistorical.time;
  const intervalSeconds = getTimeframeMinutes(timeframe) * 60;
  const maxGapMultiplier = 10;

  if (timeDiff < 0) {
    return {
      isValid: false,
      gapSize: timeDiff,
      warning: `Current candle is ${Math.abs(timeDiff)}s before last historical candle`
    };
  }

  if (timeDiff > intervalSeconds * maxGapMultiplier) {
    const gapMinutes = Math.floor(timeDiff / 60);
    return {
      isValid: false,
      gapSize: timeDiff,
      warning: `Large time gap detected: ${gapMinutes} minutes between historical and current data`
    };
  }

  return { isValid: true, gapSize: timeDiff };
}

export async function fetchPreAggregatedCandles(
  symbol: string,
  timeframe: Timeframe,
  limit: number = 500
): Promise<CandleData[]> {
  try {
    const maxAgeHours = getMaxCandleAge(timeframe);
    const cutoffTime = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);

    const { data: forexCandles, error: forexError } = await supabase
      .from('forex_candles')
      .select('open_time, open, high, low, close, volume')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .gte('open_time', cutoffTime.toISOString())
      .order('open_time', { ascending: false })
      .limit(limit);

    if (!forexError && forexCandles && forexCandles.length > 0) {
      const candles = forexCandles
        .map((candle) => ({
          time: Math.floor(new Date(candle.open_time).getTime() / 1000),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        }))
        .reverse();

      const { filtered, removed } = filterStaleCandles(candles, timeframe);
      console.log(
        `[FetchCandles] Loaded ${filtered.length} candles from forex_candles for ${symbol} ${timeframe} ` +
        `(${removed} stale candles filtered out)`
      );
      return filtered;
    }

    const { data: marketData, error: marketError } = await supabase
      .from('market_data')
      .select('timestamp, open, high, low, close, volume')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .gte('timestamp', cutoffTime.toISOString())
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (!marketError && marketData && marketData.length > 0) {
      const candles = marketData
        .map((candle) => ({
          time: Math.floor(new Date(candle.timestamp).getTime() / 1000),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        }))
        .reverse();

      const { filtered, removed } = filterStaleCandles(candles, timeframe);
      console.log(
        `[FetchCandles] Loaded ${filtered.length} candles from market_data for ${symbol} ${timeframe} ` +
        `(${removed} stale candles filtered out)`
      );
      return filtered;
    }

    console.warn(`No pre-aggregated candles found for ${symbol} ${timeframe}`);
    return [];
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

export function aggregatePricesToCurrentCandle(
  prices: RealtimePrice[],
  timeframe: Timeframe
): CandleData | null {
  if (prices.length === 0) return null;

  const intervalMinutes = getTimeframeMinutes(timeframe);
  const intervalMs = intervalMinutes * 60 * 1000;

  const latestPrice = prices[prices.length - 1];
  const latestTimestampUtc = parseUtcTimestamp(latestPrice.broker_time || latestPrice.created_at);

  const currentCandleTimeMs = Math.floor(latestTimestampUtc / intervalMs) * intervalMs;

  const relevantPrices = prices.filter((price) => {
    const timestampUtc = parseUtcTimestamp(price.broker_time || price.created_at);
    const candleTimeMs = Math.floor(timestampUtc / intervalMs) * intervalMs;
    return candleTimeMs === currentCandleTimeMs;
  });

  if (relevantPrices.length === 0) return null;

  const midPrices = relevantPrices.map((price) => {
    const bid = parseFloat(price.bid);
    const ask = parseFloat(price.ask);
    return (bid + ask) / 2;
  });

  return {
    time: Math.floor(currentCandleTimeMs / 1000),
    open: midPrices[0],
    high: Math.max(...midPrices),
    low: Math.min(...midPrices),
    close: midPrices[midPrices.length - 1],
  };
}

export async function fetchCompleteChartData(
  symbol: string,
  timeframe: Timeframe,
  limit: number = 500
): Promise<{
  historical: CandleData[];
  current: CandleData | null;
  continuityWarning?: string;
  dataQuality: {
    hasData: boolean;
    historicalCount: number;
    hasCurrent: boolean;
    timeContinuityValid: boolean;
    oldestCandleAge?: number;
  };
}> {
  console.log(`[ChartData] Fetching complete data for ${symbol} ${timeframe}, limit: ${limit}`);

  const [historicalCandles, recentPrices] = await Promise.all([
    fetchPreAggregatedCandles(symbol, timeframe, limit),
    fetchRecentRealtimePrices(symbol, getTimeframeMinutes(timeframe) * 2),
  ]);

  console.log(`[ChartData] Loaded ${historicalCandles.length} historical candles, ${recentPrices.length} recent prices`);

  if (historicalCandles.length > 0) {
    const lastHistorical = historicalCandles[historicalCandles.length - 1];
    const oldestCandle = historicalCandles[0];
    const ageHours = Math.floor((Date.now() - oldestCandle.time * 1000) / (1000 * 60 * 60));
    console.log(
      `[ChartData] Historical range: ${new Date(oldestCandle.time * 1000).toISOString()} to ` +
      `${new Date(lastHistorical.time * 1000).toISOString()} (${ageHours}h old)`
    );
    console.log(`[ChartData] Last historical candle: ${new Date(lastHistorical.time * 1000).toISOString()} - Close: ${lastHistorical.close}`);
  }

  const currentCandle = aggregatePricesToCurrentCandle(recentPrices, timeframe);

  if (currentCandle) {
    console.log(`[ChartData] Current candle aggregated: ${new Date(currentCandle.time * 1000).toISOString()} - OHLC: ${currentCandle.open}/${currentCandle.high}/${currentCandle.low}/${currentCandle.close}`);
  }

  const continuityCheck = validateTimeContinuity(historicalCandles, currentCandle, timeframe);

  if (!continuityCheck.isValid) {
    console.warn(`[ChartData] ⚠️ Time continuity issue: ${continuityCheck.warning}`);
  } else if (continuityCheck.gapSize) {
    const gapMinutes = Math.floor(continuityCheck.gapSize / 60);
    console.log(`[ChartData] ✓ Time continuity valid (gap: ${gapMinutes} minutes)`);
  }

  let finalHistorical = historicalCandles;
  let finalCurrent = currentCandle;

  if (currentCandle && historicalCandles.length > 0) {
    const lastHistoricalTime = historicalCandles[historicalCandles.length - 1].time;

    if (currentCandle.time === lastHistoricalTime) {
      console.log(`[ChartData] Current candle matches last historical - replacing with aggregated data`);
      finalHistorical = [...historicalCandles.slice(0, -1)];
    } else if (currentCandle.time < lastHistoricalTime) {
      console.warn(
        `[ChartData] ⚠️ Current candle (${new Date(currentCandle.time * 1000).toISOString()}) ` +
        `is before last historical (${new Date(lastHistoricalTime * 1000).toISOString()}) - ` +
        `rejecting current candle to prevent overlap`
      );
      finalCurrent = null;
    }
  }

  const oldestCandleAge = historicalCandles.length > 0
    ? Math.floor((Date.now() - historicalCandles[0].time * 1000) / (1000 * 60 * 60))
    : undefined;

  return {
    historical: finalHistorical,
    current: finalCurrent,
    continuityWarning: continuityCheck.isValid ? undefined : continuityCheck.warning,
    dataQuality: {
      hasData: historicalCandles.length > 0 || currentCandle !== null,
      historicalCount: finalHistorical.length,
      hasCurrent: finalCurrent !== null,
      timeContinuityValid: continuityCheck.isValid,
      oldestCandleAge
    }
  };
}
