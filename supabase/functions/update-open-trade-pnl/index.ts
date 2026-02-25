import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * UPDATE OPEN TRADE PNL — Server-Side P&L Updater
 *
 * CCIP GOVERNANCE: This is the server-side authority for keeping current_pnl
 * fresh on ALL open trades, regardless of whether the trade owner has the app open.
 *
 * PROBLEM SOLVED: The client-side position-monitor only runs for the authenticated
 * user's own session. If the trade owner is not browsing, current_pnl goes stale
 * and the LiveTradesTicker shows frozen values to all other viewers.
 *
 * SSOT COMPLIANCE:
 *   - Replicates the exact same PnL formula used by position-monitor.ts / currencyHelpers.ts
 *   - Reads prices ONLY from realtime_prices (the authoritative price source)
 *   - Writes ONLY current_pnl and current_price (no business logic mutations)
 *   - Does NOT close trades — that remains sole authority of position-monitoring-authority
 *   - Does NOT alter stop_loss, take_profit, or any governance fields
 *
 * DESIGNED TO BE CALLED: via pg_cron every 5 seconds, or on-demand via POST
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface OpenTrade {
  id: string;
  user_id: string;
  symbol: string;
  direction: string;
  entry_price: number;
  lot_size: number;
  current_pnl: number | null;
  current_price: number | null;
}

interface LivePrice {
  symbol: string;
  bid: number;
  ask: number;
  created_at: string;
}

/**
 * PIP INFO — mirrors getCurrencyPipInfo() in currencyHelpers.ts exactly
 * SSOT: Any changes to currencyHelpers.ts must be reflected here.
 */
function getPipInfo(symbol: string): { pipValue: number; dollarPerPipPerLot: number } {
  const s = symbol.toUpperCase();

  if (s.includes("XAU") || s === "GOLD") {
    return { pipValue: 1.0, dollarPerPipPerLot: 100 };
  }
  if (s.includes("US30") || s.includes("NAS") || s.includes("SPX") || s.includes("DJI") || s.includes("DAX") || s.includes("FTSE")) {
    return { pipValue: 1.0, dollarPerPipPerLot: 100 };
  }
  if (s === "BTCUSD" || s.includes("BTC") || s === "ETHUSD" || s.includes("ETH")) {
    return { pipValue: 1.0, dollarPerPipPerLot: 1.0 };
  }
  if (s.includes("JPY")) {
    return { pipValue: 0.01, dollarPerPipPerLot: 10 };
  }
  return { pipValue: 0.0001, dollarPerPipPerLot: 10 };
}

/**
 * CALCULATE PNL — mirrors calculatePnL() in position.ts exactly
 * Formula: priceDiff / pipValue * (lotSize * dollarPerPipPerLot)
 */
function calculatePnL(
  direction: string,
  entryPrice: number,
  currentPrice: number,
  lotSize: number,
  symbol: string
): number {
  const { pipValue, dollarPerPipPerLot } = getPipInfo(symbol);
  const priceDiff = direction === "buy"
    ? currentPrice - entryPrice
    : entryPrice - currentPrice;
  const pips = priceDiff / pipValue;
  const pnl = pips * (lotSize * dollarPerPipPerLot);
  return Math.round(pnl * 100) / 100;
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

    const { data: openTrades, error: tradesError } = await supabase
      .from("goal_session_trades")
      .select("id, user_id, symbol, direction, entry_price, lot_size, current_pnl, current_price")
      .eq("status", "open");

    if (tradesError) {
      return new Response(JSON.stringify({ error: tradesError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!openTrades || openTrades.length === 0) {
      return new Response(JSON.stringify({ updated: 0, message: "No open trades" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const symbols = [...new Set((openTrades as OpenTrade[]).map((t) => t.symbol))];

    const { data: priceRows, error: priceError } = await supabase
      .from("realtime_prices")
      .select("symbol, bid, ask, created_at")
      .in("symbol", symbols)
      .order("created_at", { ascending: false });

    if (priceError) {
      return new Response(JSON.stringify({ error: priceError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const priceMap = new Map<string, LivePrice>();
    for (const row of (priceRows || []) as LivePrice[]) {
      if (!priceMap.has(row.symbol)) {
        const ageMs = Date.now() - new Date(row.created_at).getTime();
        if (ageMs < 120_000) {
          priceMap.set(row.symbol, row);
        }
      }
    }

    let updated = 0;
    let skipped = 0;

    for (const trade of openTrades as OpenTrade[]) {
      const price = priceMap.get(trade.symbol);
      if (!price) { skipped++; continue; }

      const currentPrice = trade.direction === "buy"
        ? price.bid
        : price.ask;

      if (!trade.entry_price || !trade.lot_size || trade.lot_size <= 0) {
        skipped++;
        continue;
      }

      const newPnl = calculatePnL(
        trade.direction,
        trade.entry_price,
        currentPrice,
        trade.lot_size,
        trade.symbol
      );

      if (Math.abs(newPnl) > 10000) { skipped++; continue; }

      const pnlChanged = trade.current_pnl === null || Math.abs(newPnl - trade.current_pnl) >= 0.01;
      const priceChanged = trade.current_price === null || Math.abs(currentPrice - trade.current_price) >= 0.0001;

      if (!pnlChanged && !priceChanged) { skipped++; continue; }

      const { error: updateError } = await supabase
        .from("goal_session_trades")
        .update({ current_pnl: newPnl, current_price: currentPrice })
        .eq("id", trade.id)
        .eq("status", "open");

      if (!updateError) updated++;
    }

    return new Response(
      JSON.stringify({ updated, skipped, total: openTrades.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
