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

async function aggregateCandlesForSymbol(symbol: string): Promise<number> {
  const lookbackMinutes = 30;
  const prices = await fetchRecentPrices(symbol, lookbackMinutes);

  if (prices.length === 0) {
    console.log(`[CandleAggregator] No prices found for ${symbol}`);
    return 0;
  }

  let candlesCreated = 0;
  const now = new Date();

  for (const timeframe of TIMEFRAMES) {
    const timeframeMinutes = TIMEFRAME_MINUTES[timeframe];
    const lastCandleTime = await getLastCandleTime(symbol, timeframe);

    const currentCandleStart = roundTimeToCandle(now, timeframeMinutes);
    const previousCandleStart = new Date(currentCandleStart.getTime() - timeframeMinutes * 60 * 1000);

    const candleStartToProcess = lastCandleTime && lastCandleTime >= previousCandleStart
      ? currentCandleStart
      : previousCandleStart;

    if (candleStartToProcess > now) {
      continue;
    }

    const candleEndTime = new Date(candleStartToProcess.getTime() + timeframeMinutes * 60 * 1000);

    if (candleEndTime > now) {
      continue;
    }

    const candlePrices = prices.filter(p => {
      const priceTime = new Date(p.broker_time || p.created_at);
      return priceTime >= candleStartToProcess && priceTime < candleEndTime;
    });

    if (candlePrices.length > 0) {
      const candle = calculateCandleFromPrices(candlePrices, symbol, timeframe, candleStartToProcess);
      if (candle) {
        const saved = await saveCandleToDatabase(candle);
        if (saved) {
          candlesCreated++;
          console.log(`  - Created ${symbol} ${timeframe} candle at ${candleStartToProcess.toISOString()}`);
        }
      }
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
