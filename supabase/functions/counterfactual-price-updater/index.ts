import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.53.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Typical SL distance in pips per instrument — used for would_have_won heuristic.
const TYPICAL_SL_PIPS: Record<string, number> = {
  XAUUSD: 150,
  BTCUSD: 300,
  ETHUSD: 200,
  US30:   300,
  NAS100: 200,
  DEFAULT: 12,
};

function getTypicalSlPips(symbol: string): number {
  return TYPICAL_SL_PIPS[symbol] ?? TYPICAL_SL_PIPS.DEFAULT;
}

// Pip size per instrument family.
function getPipSize(symbol: string): number {
  if (symbol.includes("JPY")) return 0.01;
  if (symbol === "XAUUSD") return 0.1;
  if (symbol.startsWith("BTC") || symbol.startsWith("ETH")) return 1;
  if (["US30", "NAS100", "UK100", "GER40"].some(i => symbol.includes(i))) return 1;
  return 0.0001;
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

    // Fetch pending counterfactual rows within the 3-hour processing window.
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

    // Fetch latest price for all unique symbols in a single query.
    const symbols = [...new Set(pending.map((r: any) => r.symbol as string))];
    const { data: priceRows } = await supabase
      .from("realtime_prices")
      .select("symbol, mid, created_at")
      .in("symbol", symbols)
      .order("created_at", { ascending: false });

    // Keep only the most-recent price per symbol.
    const priceBySymbol = new Map<string, number>();
    for (const row of priceRows ?? []) {
      if (!priceBySymbol.has(row.symbol)) {
        priceBySymbol.set(row.symbol, row.mid as number);
      }
    }

    const now = Date.now();
    let updatedCount = 0;

    for (const row of pending as any[]) {
      const currentPrice = priceBySymbol.get(row.symbol);
      if (!currentPrice) continue;

      const elapsedMinutes = (now - new Date(row.created_at).getTime()) / 60_000;
      const update: Record<string, any> = { updated_at: new Date().toISOString() };
      let shouldUpdate = false;

      if (row.price_30m === null && elapsedMinutes >= 30) {
        update.price_30m = currentPrice;
        shouldUpdate = true;
      }

      if (row.price_60m === null && elapsedMinutes >= 60) {
        update.price_60m = currentPrice;
        shouldUpdate = true;

        const entryRef = row.entry_reference_price as number;
        const priceDiff = currentPrice - entryRef;
        const diffPips = Math.abs(priceDiff) / getPipSize(row.symbol);

        if (row.direction_lean === "BUY") {
          update.mfe_pips_60m = priceDiff > 0 ? diffPips : 0;
          update.mae_pips_60m = priceDiff < 0 ? diffPips : 0;
        } else {
          update.mfe_pips_60m = priceDiff < 0 ? diffPips : 0;
          update.mae_pips_60m = priceDiff > 0 ? diffPips : 0;
        }

        update.would_have_won = update.mfe_pips_60m > getTypicalSlPips(row.symbol);
      }

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
