/**
 * CCIP GOVERNANCE TOMBSTONE — DO NOT RESTORE OR REDEPLOY
 *
 * This Supabase edge function has been DECOMMISSIONED.
 *
 * Reason:
 *   This function was created during a console-warning fix attempt and introduced a
 *   duplicate candle aggregator that ran in parallel with the authoritative Netlify
 *   continuous-candle-aggregator. This caused:
 *     - Dual writes to forex_candles with data_source='aggregate_candles_v3' overwriting
 *       correct netlify_aggregator candles
 *     - All 7 pairs showing identical OHLC values (same realtime_prices tick pool)
 *     - Unnecessary database load and write conflicts
 *
 * SSOT Authority:
 *   The Netlify `continuous-candle-aggregator` function is the SOLE AUTHORITY
 *   for candle aggregation. It is scheduled via netlify.toml every 2 minutes.
 *   The MetaAPI dead-man switch inside that function is the ONLY gap-fill source.
 *   Finnhub, Kraken, and all other third-party sources have been removed.
 *
 * If you need to restore candle data, use:
 *   - Netlify function: continuous-candle-aggregator (primary)
 *   - Supabase function: metaapi-backfill (manual historical backfill only)
 *   - Supabase function: dukascopy-backfill (deep historical backfill only)
 *
 * Date decommissioned: 2026-04-13
 * CCIP ref: CCIP-CANDLE-SSOT-RESTORE-20260413
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({
      error: "DECOMMISSIONED",
      message: "This function has been retired. The Netlify continuous-candle-aggregator is the sole candle aggregation authority.",
      ssot: "netlify/functions/continuous-candle-aggregator.ts",
      ccip_ref: "CCIP-CANDLE-SSOT-RESTORE-20260413",
    }),
    {
      status: 410,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
