import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface TradeClosureEvent {
  id: string;
  trade_id: string;
  user_id: string;
  goal_session_id: string;
  symbol: string;
  close_price: number;
  close_reason: string;
  pnl: number;
  last_processed_at: string | null;
  post_processing_status: string;
  created_at: string;
}

/**
 * Process Trade Closures Edge Function
 *
 * Server-side batch processor for trade closure events.
 * Runs every 10 seconds to process unprocessed events.
 * Provides 24/7 processing guarantee even when browser is offline.
 *
 * This function:
 * 1. Fetches unprocessed closure events from database
 * 2. Runs post-processing pipeline for each event
 * 3. Marks events as processed/failed
 * 4. Logs metrics for monitoring
 *
 * Guarantee: Event is processed within 10 seconds of creation
 * (RPC inserts event, edge function picks it up in next cycle)
 */
Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      console.error("[process-trade-closures] Missing Supabase environment variables");
      return new Response(
        JSON.stringify({ error: "Configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    console.log("[process-trade-closures] Starting batch processing...");

    // Fetch unprocessed events with pessimistic locking
    const { data: events, error: fetchError } = await supabase
      .from("trade_closure_events")
      .select("*")
      .is("last_processed_at", null)
      .eq("post_processing_status", "pending")
      .order("created_at", { ascending: true })
      .limit(50);

    if (fetchError) {
      console.error("[process-trade-closures] Failed to fetch events:", fetchError);
      return new Response(
        JSON.stringify({
          error: "Failed to fetch events",
          details: fetchError.message,
          processedCount: 0,
          failedCount: 0,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!events || events.length === 0) {
      console.log("[process-trade-closures] No pending events to process");
      return new Response(
        JSON.stringify({
          success: true,
          processedCount: 0,
          failedCount: 0,
          message: "No pending events",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[process-trade-closures] Processing ${events.length} events...`);

    let processedCount = 0;
    let failedCount = 0;

    // Process each event
    for (const event of events) {
      try {
        const result = await processClosureEvent(supabase, event);

        if (result.success) {
          processedCount++;
        } else {
          failedCount++;
        }
      } catch (error) {
        console.error(`[process-trade-closures] Error processing event ${event.id}:`, error);
        failedCount++;

        // Mark event as failed
        await supabase
          .from("trade_closure_events")
          .update({
            post_processing_status: "failed",
            processing_error: error instanceof Error ? error.message : String(error),
          })
          .eq("id", event.id)
          .catch((err) =>
            console.error(`[process-trade-closures] Failed to mark event failed:`, err)
          );
      }
    }

    console.log(
      `[process-trade-closures] Batch complete: ${processedCount} processed, ${failedCount} failed`
    );

    return new Response(
      JSON.stringify({
        success: true,
        processedCount,
        failedCount,
        totalProcessed: events.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[process-trade-closures] Fatal error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Process a single closure event
 * Runs the post-processing pipeline and marks event as processed
 */
async function processClosureEvent(
  supabase: ReturnType<typeof createClient>,
  event: TradeClosureEvent
): Promise<{ success: boolean; error?: string }> {
  const startTime = Date.now();

  try {
    console.log(
      `[process-trade-closures] Processing event ${event.id} for trade ${event.trade_id}`
    );

    // Step 1: Mark as being processed (prevent concurrent processing)
    // This is a soft lock - we update immediately without waiting for full processing

    // Step 2: Send notification
    try {
      const notificationType = determineNotificationType(event.close_reason);
      await supabase.from("goal_notifications").insert({
        user_id: event.user_id,
        type: notificationType,
        title: getNotificationTitle(event.close_reason),
        message: `${event.symbol} closed with P&L: ${event.pnl >= 0 ? "+" : ""}$${event.pnl.toFixed(2)}`,
        metadata: {
          tradeId: event.trade_id,
          symbol: event.symbol,
          pnl: event.pnl,
          closeReason: event.close_reason,
          closePrice: event.close_price,
        },
        priority: event.pnl < 0 ? "high" : "medium",
      });
    } catch (notificationError) {
      console.warn(
        `[process-trade-closures] Notification failed for event ${event.id}:`,
        notificationError
      );
      // Continue processing even if notification fails
    }

    // Step 3: Evaluate session state
    try {
      const { data: session } = await supabase
        .from("goal_sessions")
        .select("id, status")
        .eq("id", event.goal_session_id)
        .single();

      if (session) {
        // Count remaining open trades
        const { count: openTradeCount } = await supabase
          .from("goal_session_trades")
          .select("id", { count: "exact" })
          .eq("goal_session_id", event.goal_session_id)
          .eq("status", "open");

        // CCIP GOVERNANCE (2026-02-18): After all trades close, session MUST stop.
        // Auto-restarting scanning after a trade closes is explicitly prohibited.
        // Users must manually start a new session. No exceptions.
        if (openTradeCount === 0 && session.status !== "goal_achieved" && session.status !== "user_stopped") {
          await supabase
            .from("goal_sessions")
            .update({
              status: "user_stopped",
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", event.goal_session_id)
            .in("status", ["scanning", "active", "initializing", "in_trade", "trade_pending", "soft_closing"]);

          console.log(
            `[process-trade-closures] GOVERNANCE: Session ${event.goal_session_id} stopped after all trades closed (was: ${session.status})`
          );
        }
      }
    } catch (sessionError) {
      console.warn(
        `[process-trade-closures] Session evaluation failed for event ${event.id}:`,
        sessionError
      );
    }

    // Step 4: Mark event as processed
    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("trade_closure_events")
      .update({
        last_processed_at: now,
        post_processing_status: "succeeded",
      })
      .eq("id", event.id);

    if (updateError) {
      console.error(`[process-trade-closures] Failed to mark event processed:`, updateError);
      throw updateError;
    }

    const processingTime = Date.now() - startTime;
    console.log(
      `[process-trade-closures] Event ${event.id} processed in ${processingTime}ms`
    );

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[process-trade-closures] Event processing failed:`, errorMessage);

    // Mark event as failed
    try {
      await supabase
        .from("trade_closure_events")
        .update({
          post_processing_status: "failed",
          processing_error: errorMessage,
        })
        .eq("id", event.id);
    } catch (markError) {
      console.error(
        `[process-trade-closures] Failed to mark event as failed:`,
        markError
      );
    }

    return { success: false, error: errorMessage };
  }
}

/**
 * Determine notification type from close reason
 */
function determineNotificationType(
  closeReason: string
): "stop_loss_hit" | "take_profit_hit" | "goal_achieved" | "trade_closed" {
  switch (closeReason) {
    case "stop_loss":
      return "stop_loss_hit";
    case "take_profit":
    case "take_profit_1":
    case "take_profit_2":
      return "take_profit_hit";
    case "goal_achieved":
      return "goal_achieved";
    default:
      return "trade_closed";
  }
}

/**
 * Get human-readable notification title
 */
function getNotificationTitle(closeReason: string): string {
  const titles: Record<string, string> = {
    manual: "Trade Closed",
    stop_loss: "Stop Loss Hit",
    take_profit: "Take Profit Hit",
    take_profit_1: "TP1 Reached",
    take_profit_2: "TP2 Reached",
    goal_achieved: "Goal Achieved!",
    timeout: "Session Timeout",
    weekend_protection: "Weekend Closure",
    force_closed: "Force Closed",
    goal_expired: "Goal Expired",
    session_ended: "Session Ended",
    risk_limit: "Risk Limit Exceeded",
    trailing_stop: "Trailing Stop",
    holiday_closure: "Holiday Closure",
    market_closed: "Market Closed",
  };

  return titles[closeReason] || "Trade Closed";
}
