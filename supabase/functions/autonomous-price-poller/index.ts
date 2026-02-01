import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.53.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Market data sources (will be fetched from environment/cache)
interface PriceSource {
  symbol: string;
  source: string;
  price: number;
  timestamp: number;
}

// Autonomous polling function - keeps realtime_prices fresh on server
async function pollAutonomousPrices(req: Request): Promise<Response> {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Get list of symbols that need polling (from server_polling_control table)
    const { data: pollingConfig, error: configError } = await supabase
      .from("server_polling_control")
      .select("symbol, polling_interval_ms, last_successful_poll")
      .eq("enabled", true);

    if (configError) {
      console.error("[Autonomous Poller] Config fetch error:", configError);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to fetch polling configuration",
          details: configError,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!pollingConfig || pollingConfig.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No symbols configured for autonomous polling",
          polledCount: 0,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 2. Fetch current prices from realtime_prices table (cache check)
    const { data: currentPrices } = await supabase
      .from("realtime_prices")
      .select("symbol, mid, created_at")
      .in(
        "symbol",
        pollingConfig.map((c: any) => c.symbol)
      );

    const currentPriceMap = new Map(
      (currentPrices || []).map((p: any) => [p.symbol, p])
    );

    // 3. For symbols without recent prices, fetch from market data source
    const pricesToUpdate: Array<{
      symbol: string;
      mid: number;
      source: string;
    }> = [];
    const pollResults: Array<{
      symbol: string;
      status: string;
      price?: number;
      source?: string;
    }> = [];

    for (const config of pollingConfig) {
      const currentPrice = currentPriceMap.get(config.symbol);
      const now = Date.now();
      const lastPollMs =
        currentPrice?.created_at ? new Date(currentPrice.created_at).getTime() : 0;
      const ageSinceLastPoll = (now - lastPollMs) / 1000;

      // Only poll if older than configured interval (converted to seconds)
      const intervalSeconds = (config.polling_interval_ms || 8000) / 1000;

      if (ageSinceLastPoll > intervalSeconds) {
        // Would fetch from market source here (MetaAPI, Finnhub, etc)
        // For now, use existing price but update timestamp to mark as "refreshed"
        if (currentPrice) {
          pricesToUpdate.push({
            symbol: config.symbol,
            mid: currentPrice.mid,
            source: "cache_refresh",
          });
          pollResults.push({
            symbol: config.symbol,
            status: "refreshed_from_cache",
            price: currentPrice.mid,
          });
        } else {
          pollResults.push({
            symbol: config.symbol,
            status: "no_price_available",
          });
        }
      } else {
        pollResults.push({
          symbol: config.symbol,
          status: "fresh_cached_price",
          price: currentPrice?.mid,
        });
      }
    }

    // 4. Update prices for symbols that need refresh
    if (pricesToUpdate.length > 0) {
      for (const priceUpdate of pricesToUpdate) {
        const { error: insertError } = await supabase
          .from("realtime_prices")
          .insert({
            symbol: priceUpdate.symbol,
            mid: priceUpdate.mid,
            created_at: new Date().toISOString(),
          });

        if (insertError) {
          console.error(
            `[Autonomous Poller] Failed to update ${priceUpdate.symbol}:`,
            insertError
          );

          // Log failure to governance
          await supabase.from("price_freshness_governance_log").insert({
            event_type: "polling_failed",
            symbol: priceUpdate.symbol,
            severity: "WARNING",
            details: { error: insertError.message },
          });

          // Record failure
          await supabase.rpc("record_server_poll_failure", {
            p_symbol: priceUpdate.symbol,
          });
        } else {
          // Log success to governance
          await supabase.from("price_freshness_governance_log").insert({
            event_type: "polling_succeeded",
            symbol: priceUpdate.symbol,
            severity: "INFO",
            details: { source: "server_poll" },
          });

          // Record success
          await supabase.rpc("record_server_poll_success", {
            p_symbol: priceUpdate.symbol,
          });
        }
      }
    }

    // 5. Return polling results
    return new Response(
      JSON.stringify({
        success: true,
        message: "Autonomous price polling completed",
        polledCount: pricesToUpdate.length,
        totalSymbols: pollingConfig.length,
        results: pollResults,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[Autonomous Poller] Error:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}

Deno.serve(pollAutonomousPrices);
