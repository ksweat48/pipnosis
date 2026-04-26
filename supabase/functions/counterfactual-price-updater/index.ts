import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.53.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Typical SL distance in pips by instrument family — used for would_have_won heuristic.
// These are conservative baselines; the counterfactual is informational, not prescriptive.
const TYPICAL_SL_PIPS: Record<string, number> = {
  XAUUSD: 150,
  BTCUSD: 300,
  ETHUSD: 200,
  US30:   300,
  NAS100: 200,
  // Default for major forex pairs
  DEFAULT: 12,
};

function getTypicalSlPips(symbol: string): number {
  return TYPICAL_SL_PIPS[symbol] ?? TYPICAL_SL_PIPS.DEFAULT;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch pending counterfactual rows — any column still NULL within a 3-hour window.
    // We cap at 3 hours to avoid processing ancient rows on cold restarts.
    const { data: pending, error: fetchError } = await supabase
      .from("alpha_no_trade_counterfactuals")
      .select("id, symbol, direction_lean, entry_reference_price, created_at, price_30m, price_60m, price_120m")
      .or("price_30m.is.null,price_60m.is.null,price_120m.is.null")
      .gte("created_at", new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: true })
      .limit(100);

    if (fetchError) {
      throw new Error(`Failed to fetch pending counterfactuals: ${fetchError.message}`);
    }

    if (!pending || pending.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No pending counterfactuals", updatedCount: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Collect unique symbols to fetch prices in one pass.
    const symbols = [...new Set(pending.map((r: any) => r.symbol as string))];

    // Fetch latest price per symbol from realtime_prices.
    const priceBySymbol = new Map<string, number>();
    for (const symbol of symbols) {
      const { data: priceRow } = await supabase
        .from("realtime_prices")
        .select("mid")
        .eq("symbol", symbol)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (priceRow?.mid) {
        priceBySymbol.set(symbol, priceRow.mid as number);
      }
    }

    const now = Date.now();
    let updatedCount = 0;

    for (const row of pending as any[]) {
      const createdMs = new Date(row.created_at).getTime();
      const elapsedMinutes = (now - createdMs) / 60_000;
      const currentPrice = priceBySymbol.get(row.symbol);

      if (!currentPrice) continue;

      const update: Record<string, any> = { updated_at: new Date().toISOString() };
      let shouldUpdate = false;

      // 30-minute snapshot
      if (row.price_30m === null && elapsedMinutes >= 30) {
        update.price_30m = currentPrice;
        shouldUpdate = true;
      }

      // 60-minute snapshot + MFE/MAE heuristic
      if (row.price_60m === null && elapsedMinutes >= 60) {
        update.price_60m = currentPrice;
        shouldUpdate = true;

        // MFE/MAE: approximate from entry_reference_price vs current price.
        // Direction-aware: BUY lean = higher is favorable, SELL lean = lower is favorable.
        const entryRef = row.entry_reference_price as number;
        const priceDiff = currentPrice - entryRef;

        // Convert price delta to pips using instrument-aware scaling.
        const pipSize = row.symbol.includes("JPY") ? 0.01
          : row.symbol === "XAUUSD" ? 0.1
          : row.symbol.startsWith("BTC") || row.symbol.startsWith("ETH") ? 1
          : ["US30", "NAS100", "UK100", "GER40"].some(i => row.symbol.includes(i)) ? 1
          : 0.0001;

        const diffPips = Math.abs(priceDiff) / pipSize;

        if (row.direction_lean === "BUY") {
          // Favorable = price went up
          update.mfe_pips_60m = priceDiff > 0 ? diffPips : 0;
          update.mae_pips_60m = priceDiff < 0 ? diffPips : 0;
        } else {
          // Favorable = price went down
          update.mfe_pips_60m = priceDiff < 0 ? diffPips : 0;
          update.mae_pips_60m = priceDiff > 0 ? diffPips : 0;
        }

        const typicalSl = getTypicalSlPips(row.symbol);
        update.would_have_won = update.mfe_pips_60m > typicalSl;
      }

      // 120-minute snapshot
      if (row.price_120m === null && elapsedMinutes >= 120) {
        update.price_120m = currentPrice;
        shouldUpdate = true;
      }

      if (!shouldUpdate) continue;

      const { error: updateError } = await supabase
        .from("alpha_no_trade_counterfactuals")
        .update(update)
        .eq("id", row.id);

      if (updateError) {
        console.error(`[Counterfactual Updater] Failed to update row ${row.id}:`, updateError.message);
      } else {
        updatedCount++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Counterfactual price update complete",
        pendingCount: pending.length,
        updatedCount,
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Counterfactual Updater] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
