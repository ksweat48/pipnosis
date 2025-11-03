import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface RealtimePrice {
  symbol: string;
  bid: number;
  ask: number;
  created_at: string;
  broker_time: string;
}

interface CandleData {
  symbol: string;
  timeframe: string;
  open_time: string;
  close_time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tick_count: number;
}

interface AggregationResult {
  symbol: string;
  timeframe: string;
  candlesCreated: number;
  ticksProcessed: number;
  errors: string[];
}

const TIMEFRAMES = [
  { name: 'M1', minutes: 1 },
  { name: 'M5', minutes: 5 },
  { name: 'M15', minutes: 15 },
  { name: 'M30', minutes: 30 },
  { name: 'H1', minutes: 60 },
  { name: 'H4', minutes: 240 },
  { name: 'D1', minutes: 1440 },
  { name: 'W1', minutes: 10080 },
];

const FOREX_PAIRS = [
  'XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF',
  'AUDUSD', 'USDCAD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY'
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('🚀 Starting candle aggregation job...');

    const now = new Date();
    const lookbackHours = 24;
    const startTimeUtc = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);

    console.log(`📊 Aggregating from ${startTimeUtc.toISOString()} to ${now.toISOString()}`);

    const { data: realtimePrices, error: fetchError } = await supabase
      .from('realtime_prices')
      .select('symbol, bid, ask, created_at, broker_time')
      .gte('created_at', startTimeUtc.toISOString())
      .order('created_at', { ascending: true });

    if (fetchError) {
      throw new Error(`Failed to fetch realtime prices: ${fetchError.message}`);
    }

    if (!realtimePrices || realtimePrices.length === 0) {
      console.log('⚠️ No tick data found in the last 24 hours');

      await logAggregation(supabase, {
        status: 'success',
        ticks_processed: 0,
        candles_created: 0,
        duration_ms: Date.now() - startTime,
        symbols_processed: 0,
        message: 'No tick data available'
      });

      return new Response(
        JSON.stringify({
          message: 'No tick data to aggregate',
          ticksFound: 0,
          candlesCreated: 0,
          duration: Date.now() - startTime
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`📦 Found ${realtimePrices.length} ticks to process`);

    const results: AggregationResult[] = [];
    let totalCandlesCreated = 0;
    let totalTicksProcessed = 0;
    const symbolsProcessed = new Set<string>();

    for (const symbol of FOREX_PAIRS) {
      const symbolTicks = realtimePrices.filter((p: RealtimePrice) => p.symbol === symbol);

      if (symbolTicks.length === 0) {
        console.log(`⏭️ Skipping ${symbol} - no ticks found`);
        continue;
      }

      console.log(`🔄 Processing ${symbol} - ${symbolTicks.length} ticks`);
      symbolsProcessed.add(symbol);

      for (const timeframe of TIMEFRAMES) {
        const result = await aggregateTimeframe(
          supabase,
          symbol,
          timeframe.name,
          timeframe.minutes,
          symbolTicks,
          now
        );

        results.push(result);
        totalCandlesCreated += result.candlesCreated;
        totalTicksProcessed += result.ticksProcessed;

        if (result.errors.length > 0) {
          console.error(`❌ Errors in ${symbol} ${timeframe.name}:`, result.errors);
        }
      }
    }

    await logAggregation(supabase, {
      status: 'success',
      ticks_processed: totalTicksProcessed,
      candles_created: totalCandlesCreated,
      duration_ms: Date.now() - startTime,
      symbols_processed: symbolsProcessed.size,
      details: results
    });

    console.log(`✅ Aggregation complete: ${totalCandlesCreated} candles from ${totalTicksProcessed} ticks`);

    return new Response(
      JSON.stringify({
        message: 'Candle aggregation completed',
        ticksProcessed: totalTicksProcessed,
        candlesCreated: totalCandlesCreated,
        symbolsProcessed: symbolsProcessed.size,
        duration: Date.now() - startTime,
        results
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('❌ Aggregation job failed:', error);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    await logAggregation(supabase, {
      status: 'error',
      ticks_processed: 0,
      candles_created: 0,
      duration_ms: Date.now() - startTime,
      symbols_processed: 0,
      error_message: error instanceof Error ? error.message : 'Unknown error'
    });

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

async function aggregateTimeframe(
  supabase: any,
  symbol: string,
  timeframe: string,
  intervalMinutes: number,
  ticks: RealtimePrice[],
  currentTime: Date
): Promise<AggregationResult> {
  const result: AggregationResult = {
    symbol,
    timeframe,
    candlesCreated: 0,
    ticksProcessed: 0,
    errors: []
  };

  try {
    const intervalMs = intervalMinutes * 60 * 1000;
    const candleMap = new Map<number, { ticks: RealtimePrice[], midPrices: number[] }>();

    for (const tick of ticks) {
      const tickTime = new Date(tick.broker_time || tick.created_at).getTime();
      const candleStartMs = Math.floor(tickTime / intervalMs) * intervalMs;

      if (!candleMap.has(candleStartMs)) {
        candleMap.set(candleStartMs, { ticks: [], midPrices: [] });
      }

      const candleData = candleMap.get(candleStartMs)!;
      candleData.ticks.push(tick);

      const bid = typeof tick.bid === 'string' ? parseFloat(tick.bid) : tick.bid;
      const ask = typeof tick.ask === 'string' ? parseFloat(tick.ask) : tick.ask;
      const midPrice = (bid + ask) / 2;

      candleData.midPrices.push(midPrice);
      result.ticksProcessed++;
    }

    const completedCandles: CandleData[] = [];
    const currentCandleStartMs = Math.floor(currentTime.getTime() / intervalMs) * intervalMs;

    for (const [candleStartMs, data] of candleMap.entries()) {
      if (candleStartMs >= currentCandleStartMs) {
        continue;
      }

      if (data.midPrices.length === 0) {
        continue;
      }

      const openTime = new Date(candleStartMs);
      const closeTime = new Date(candleStartMs + intervalMs);

      const candle: CandleData = {
        symbol,
        timeframe,
        open_time: openTime.toISOString(),
        close_time: closeTime.toISOString(),
        open: data.midPrices[0],
        high: Math.max(...data.midPrices),
        low: Math.min(...data.midPrices),
        close: data.midPrices[data.midPrices.length - 1],
        volume: data.ticks.length,
        tick_count: data.ticks.length
      };

      completedCandles.push(candle);
    }

    if (completedCandles.length === 0) {
      return result;
    }

    const { error: forexError } = await supabase
      .from('forex_candles')
      .upsert(
        completedCandles.map(c => ({
          symbol: c.symbol,
          timeframe: c.timeframe,
          open_time: c.open_time,
          close_time: c.close_time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          tick_count: c.tick_count
        })),
        {
          onConflict: 'symbol,timeframe,open_time',
          ignoreDuplicates: false
        }
      );

    if (forexError) {
      result.errors.push(`forex_candles: ${forexError.message}`);
    } else {
      result.candlesCreated = completedCandles.length;
    }

    const { error: marketError } = await supabase
      .from('market_data')
      .upsert(
        completedCandles.map(c => ({
          symbol: c.symbol,
          timeframe: c.timeframe,
          timestamp: c.open_time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume
        })),
        {
          onConflict: 'symbol,timeframe,timestamp',
          ignoreDuplicates: false
        }
      );

    if (marketError) {
      result.errors.push(`market_data: ${marketError.message}`);
    }

    console.log(`✓ ${symbol} ${timeframe}: ${completedCandles.length} candles from ${result.ticksProcessed} ticks`);

  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : 'Unknown error');
  }

  return result;
}

async function logAggregation(supabase: any, logData: any): Promise<void> {
  try {
    await supabase
      .from('candle_aggregation_log')
      .insert({
        ...logData,
        executed_at: new Date().toISOString()
      });
  } catch (error) {
    console.error('Failed to log aggregation:', error);
  }
}