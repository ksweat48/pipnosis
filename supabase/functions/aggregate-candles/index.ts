import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "US30"];
const TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"];

const TIMEFRAME_MINUTES: Record<string, number> = {
  M1: 1,
  M5: 5,
  M15: 15,
  M30: 30,
  H1: 60,
  H4: 240,
  D1: 1440,
  W1: 10080,
};

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

    for (const symbol of SYMBOLS) {
      // Fetch recent ticks from realtime_prices - get last 200 per symbol
      const { data: ticks, error: tickError } = await supabase
        .from("realtime_prices")
        .select("bid, ask, mid, broker_time, received_at")
        .eq("symbol", symbol)
        .order("broker_time", { ascending: true })
        .limit(200);

      if (tickError || !ticks || ticks.length === 0) {
        results.push({ symbol, error: tickError?.message || "no ticks", ticksProcessed: 0 });
        continue;
      }

      totalTicks += ticks.length;

      for (const timeframe of TIMEFRAMES) {
        const minutesPerCandle = TIMEFRAME_MINUTES[timeframe];
        const candlesCreated: number[] = [];

        // Group ticks into candle buckets
        const buckets = new Map<number, { open: number; high: number; low: number; close: number; volume: number; tickCount: number; openTime: Date }>();

        for (const tick of ticks) {
          const price = parseFloat(tick.bid ?? tick.mid ?? tick.ask);
          if (isNaN(price) || price <= 0) continue;

          const tickTime = new Date(tick.broker_time || tick.received_at);
          const bucketMs = Math.floor(tickTime.getTime() / (minutesPerCandle * 60 * 1000)) * (minutesPerCandle * 60 * 1000);

          if (!buckets.has(bucketMs)) {
            buckets.set(bucketMs, {
              open: price,
              high: price,
              low: price,
              close: price,
              volume: 1,
              tickCount: 1,
              openTime: new Date(bucketMs),
            });
          } else {
            const bucket = buckets.get(bucketMs)!;
            bucket.high = Math.max(bucket.high, price);
            bucket.low = Math.min(bucket.low, price);
            bucket.close = price;
            bucket.volume += 1;
            bucket.tickCount += 1;
          }
        }

        // Skip the current (incomplete) candle bucket
        const now = Date.now();
        const currentBucketMs = Math.floor(now / (minutesPerCandle * 60 * 1000)) * (minutesPerCandle * 60 * 1000);

        const completedBuckets = Array.from(buckets.entries()).filter(([bucketMs]) => bucketMs < currentBucketMs);

        for (const [bucketMs, candle] of completedBuckets) {
          const openTime = new Date(bucketMs);
          const closeTime = new Date(bucketMs + minutesPerCandle * 60 * 1000 - 1000);

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
                data_source: "aggregate_candles_v2",
              },
              {
                onConflict: "symbol,timeframe,open_time",
                ignoreDuplicates: false,
              }
            );

          if (!upsertError) {
            candlesCreated.push(bucketMs);
            totalCandles++;
          }
        }

        results.push({
          symbol,
          timeframe,
          candlesCreated: candlesCreated.length,
          ticksProcessed: ticks.length,
          errors: [],
        });
      }
    }

    // Log aggregation run
    await supabase.from("candle_aggregation_log").insert({
      status: "success",
      ticks_processed: totalTicks,
      candles_created: totalCandles,
      symbols_processed: SYMBOLS.length,
      duration_ms: Date.now() - startTime,
      details: results,
    });

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
