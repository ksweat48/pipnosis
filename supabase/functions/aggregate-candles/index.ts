import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const FOREX_SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "US30", "NAS100", "SPX500"];
const CRYPTO_SYMBOLS = ["BTCUSD", "ETHUSD"];
const TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];

const TIMEFRAME_MINUTES: Record<string, number> = {
  M1: 1,
  M5: 5,
  M15: 15,
  M30: 30,
  H1: 60,
  H4: 240,
  D1: 1440,
};

function isCrypto(symbol: string): boolean {
  return CRYPTO_SYMBOLS.includes(symbol);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const startTime = Date.now();
    const results: any[] = [];
    let totalCandles = 0;
    let totalTicks = 0;

    const allSymbols = [...FOREX_SYMBOLS, ...CRYPTO_SYMBOLS];

    for (const symbol of allSymbols) {
      const { data: ticks, error: tickError } = await supabase
        .from("realtime_prices")
        .select("bid, ask, mid, broker_time, received_at")
        .eq("symbol", symbol)
        .order("broker_time", { ascending: true })
        .limit(500);

      if (tickError || !ticks || ticks.length === 0) {
        results.push({ symbol, error: tickError?.message || "no ticks", ticksProcessed: 0 });
        continue;
      }

      totalTicks += ticks.length;

      const lastTick = ticks[ticks.length - 1];
      const lastTickTime = new Date(lastTick.broker_time || lastTick.received_at);
      const serverNow = new Date();

      const effectiveNow = isCrypto(symbol) ? serverNow : lastTickTime;

      const skewMs = effectiveNow.getTime() - serverNow.getTime();
      if (!isCrypto(symbol) && Math.abs(skewMs) > 60000) {
        console.log(`[AggregateCandles] ${symbol}: broker skew = ${Math.round(skewMs / 60000)}min, using broker_time as effectiveNow`);
      }

      for (const timeframe of TIMEFRAMES) {
        const minutesPerCandle = TIMEFRAME_MINUTES[timeframe];
        if (!minutesPerCandle) continue;

        const candleDurationMs = minutesPerCandle * 60 * 1000;
        const candlesCreated: number[] = [];

        const buckets = new Map<number, { open: number; high: number; low: number; close: number; volume: number; tickCount: number }>();

        for (const tick of ticks) {
          const price = parseFloat(tick.mid ?? tick.bid ?? tick.ask);
          if (isNaN(price) || price <= 0) continue;

          const tickTime = new Date(tick.broker_time || tick.received_at);
          const bucketMs = Math.floor(tickTime.getTime() / candleDurationMs) * candleDurationMs;

          if (!buckets.has(bucketMs)) {
            buckets.set(bucketMs, { open: price, high: price, low: price, close: price, volume: 1, tickCount: 1 });
          } else {
            const b = buckets.get(bucketMs)!;
            b.high = Math.max(b.high, price);
            b.low = Math.min(b.low, price);
            b.close = price;
            b.volume++;
            b.tickCount++;
          }
        }

        const currentBucketMs = Math.floor(effectiveNow.getTime() / candleDurationMs) * candleDurationMs;

        const completedBuckets = Array.from(buckets.entries()).filter(([bMs]) => bMs < currentBucketMs);

        for (const [bucketMs, candle] of completedBuckets) {
          const openTime = new Date(bucketMs);
          const closeTime = new Date(bucketMs + candleDurationMs - 1000);

          const { error: upsertError } = await supabase
            .from("forex_candles")
            .upsert(
              {
                symbol,
                timeframe,
                open_time: openTime.toISOString(),
                close_time: closeTime.toISOString(),
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                volume: candle.volume,
                tick_count: candle.tickCount,
                data_source: "aggregate_candles_v3",
              },
              { onConflict: "symbol,timeframe,open_time", ignoreDuplicates: false }
            );

          if (!upsertError) {
            candlesCreated.push(bucketMs);
            totalCandles++;
          }
        }

        if (candlesCreated.length > 0) {
          results.push({ symbol, timeframe, candlesCreated: candlesCreated.length, ticksProcessed: ticks.length });
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        ticks_processed: totalTicks,
        candles_created: totalCandles,
        duration_ms: Date.now() - startTime,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
