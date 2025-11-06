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

export async function fetchPreAggregatedCandles(
  symbol: string,
  timeframe: Timeframe,
  limit: number = 500
): Promise<CandleData[]> {
  try {
    const { data: forexCandles, error: forexError } = await supabase
      .from('forex_candles')
      .select('open_time, open, high, low, close, volume')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
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

      console.log(`Loaded ${candles.length} pre-aggregated candles from forex_candles for ${symbol} ${timeframe}`);
      return candles;
    }

    const { data: marketData, error: marketError } = await supabase
      .from('market_data')
      .select('timestamp, open, high, low, close, volume')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
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

      console.log(`Loaded ${candles.length} pre-aggregated candles from market_data for ${symbol} ${timeframe}`);
      return candles;
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

function getCurrentCandleStartTime(timeframe: Timeframe): number {
  const now = Date.now();
  const intervalMs = getTimeframeMinutes(timeframe) * 60 * 1000;
  return Math.floor(now / intervalMs) * intervalMs;
}

export async function fetchCompleteChartData(
  symbol: string,
  timeframe: Timeframe,
  limit: number = 500
): Promise<{ historical: CandleData[]; current: CandleData | null }> {
  console.log(`[ChartData] Fetching complete data for ${symbol} ${timeframe}, limit: ${limit}`);

  const currentCandleStartMs = getCurrentCandleStartTime(timeframe);
  const currentCandleStartTime = Math.floor(currentCandleStartMs / 1000);
  console.log(`[ChartData] Current candle period starts at: ${new Date(currentCandleStartMs).toISOString()} (${currentCandleStartTime})`);

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

  const currentCandle = aggregatePricesToCurrentCandle(recentPrices, timeframe);

  if (currentCandle) {
    console.log(`[ChartData] Current candle aggregated: ${new Date(currentCandle.time * 1000).toISOString()} - OHLC: ${currentCandle.open}/${currentCandle.high}/${currentCandle.low}/${currentCandle.close}`);
  }

  let finalHistorical = historicalCandles;
  let finalCurrent: CandleData | null = currentCandle;

  if (currentCandle && historicalCandles.length > 0) {
    const lastHistoricalTime = historicalCandles[historicalCandles.length - 1].time;

    if (currentCandle.time === lastHistoricalTime) {
      console.warn(`[ChartData] WARNING: Current candle overlaps with last historical - removing last historical`);
      finalHistorical = [...historicalCandles.slice(0, -1)];
    } else if (currentCandle.time < lastHistoricalTime) {
      console.error(`[ChartData] ERROR: Current candle time ${currentCandle.time} < last historical ${lastHistoricalTime}`);
      console.error(`[ChartData] This indicates historical data includes incomplete candles - ignoring current`);
      return {
        historical: historicalCandles,
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
