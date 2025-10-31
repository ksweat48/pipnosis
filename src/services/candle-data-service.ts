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
    const startTime = new Date();
    startTime.setMinutes(startTime.getMinutes() - minutesBack);

    const { data, error } = await supabase
      .from('realtime_prices')
      .select('bid, ask, broker_time, created_at')
      .eq('symbol', symbol)
      .gte('created_at', startTime.toISOString())
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

export function aggregatePricesToCurrentCandle(
  prices: RealtimePrice[],
  timeframe: Timeframe
): CandleData | null {
  if (prices.length === 0) return null;

  const intervalMinutes = getTimeframeMinutes(timeframe);
  const latestPrice = prices[prices.length - 1];
  const latestTimestamp = new Date(latestPrice.broker_time || latestPrice.created_at).getTime();
  const currentCandleTime = Math.floor(latestTimestamp / (intervalMinutes * 60 * 1000)) * (intervalMinutes * 60);

  const relevantPrices = prices.filter((price) => {
    const timestamp = new Date(price.broker_time || price.created_at).getTime();
    const candleTime = Math.floor(timestamp / (intervalMinutes * 60 * 1000)) * (intervalMinutes * 60);
    return candleTime === currentCandleTime;
  });

  if (relevantPrices.length === 0) return null;

  const midPrices = relevantPrices.map((price) => {
    const bid = parseFloat(price.bid);
    const ask = parseFloat(price.ask);
    return (bid + ask) / 2;
  });

  return {
    time: currentCandleTime / 1000,
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
): Promise<{ historical: CandleData[]; current: CandleData | null }> {
  const [historicalCandles, recentPrices] = await Promise.all([
    fetchPreAggregatedCandles(symbol, timeframe, limit),
    fetchRecentRealtimePrices(symbol, getTimeframeMinutes(timeframe) * 2),
  ]);

  const currentCandle = aggregatePricesToCurrentCandle(recentPrices, timeframe);

  let finalHistorical = historicalCandles;
  if (currentCandle && historicalCandles.length > 0) {
    const lastHistoricalTime = historicalCandles[historicalCandles.length - 1].time;
    if (currentCandle.time === lastHistoricalTime) {
      finalHistorical = historicalCandles.slice(0, -1);
    }
  }

  return {
    historical: finalHistorical,
    current: currentCandle,
  };
}
