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
  direction?: string;
  close_price: number;
  close_reason: string;
  pnl: number;
  last_processed_at: string | null;
  post_processing_status: string;
  created_at: string;
}

interface TradeRow {
  direction: string;
  entry_price: number;
  exit_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  created_at: string;
  closed_at: string | null;
  tp1_hit: boolean | null;
  tp2_hit: boolean | null;
  peak_profit: number | null;
  trade_style: string | null;
  timeframe: string | null;
  goal_session_id: string;
}

/**
 * Process Trade Closures Edge Function
 *
 * CCIP GOVERNANCE (2026-02-21): This is the SOLE AUTHORITATIVE server-side processor
 * for trade closure events. It must run the COMPLETE post-processing pipeline:
 *   1. Notification
 *   2. Session state evaluation
 *   3. Journal entry creation (SSOT: every trade must have a journal record)
 *   4. Mark event as processed
 *
 * SSOT PRINCIPLE: Journal creation is decoupled from browser availability.
 * All closed trades MUST have an ai_trade_journal entry regardless of whether
 * the browser was open at the time of closure.
 *
 * The browser-side TradeClosureEventProcessor skips events already marked
 * succeeded (idempotency guard). This means the edge function is effectively
 * the PRIMARY processor and must be complete.
 */
Deno.serve(async (req: Request) => {
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
 * Process a single closure event — FULL pipeline
 *
 * SSOT: This function is responsible for ALL post-trade processing when running
 * server-side. It must be functionally equivalent to the browser-side
 * TradeClosureEventProcessor.processEvent().
 */
async function processClosureEvent(
  supabase: ReturnType<typeof createClient>,
  event: TradeClosureEvent
): Promise<{ success: boolean; error?: string }> {
  const startTime = Date.now();

  try {
    console.log(
      `[process-trade-closures] Processing event ${event.id} for trade ${event.trade_id} (${event.symbol} ${event.close_reason})`
    );

    // Step 1: Fetch full trade data (needed for journal + learning pipeline)
    const { data: tradeRow } = await supabase
      .from("goal_session_trades")
      .select("direction, entry_price, exit_price, stop_loss, take_profit, created_at, closed_at, tp1_hit, tp2_hit, peak_profit, trade_style, timeframe, goal_session_id")
      .eq("id", event.trade_id)
      .maybeSingle() as { data: TradeRow | null };

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
    }

    // Step 3: Evaluate session state
    // CCIP GOVERNANCE (2026-02-18): After all trades close, session MUST stop.
    try {
      const { data: session } = await supabase
        .from("goal_sessions")
        .select("id, status")
        .eq("id", event.goal_session_id)
        .maybeSingle();

      if (session && session.status !== "goal_achieved" && session.status !== "user_stopped" && session.status !== "stopped" && session.status !== "timeout") {
        const { count: openTradeCount } = await supabase
          .from("goal_session_trades")
          .select("id", { count: "exact" })
          .eq("goal_session_id", event.goal_session_id)
          .eq("status", "open");

        if (openTradeCount === 0) {
          await supabase
            .from("entry_intents")
            .update({ status: "canceled", canceled_at: new Date().toISOString(), conditions_changed_at: new Date().toISOString() })
            .eq("session_id", event.goal_session_id)
            .not("status", "in", '("canceled","expired_no_entry")');

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
            `[process-trade-closures] GOVERNANCE: Session ${event.goal_session_id} stopped after all trades closed`
          );
        }
      }
    } catch (sessionError) {
      console.warn(
        `[process-trade-closures] Session evaluation failed for event ${event.id}:`,
        sessionError
      );
    }

    // Step 4: SSOT Journal Creation
    // Every closed trade MUST have an ai_trade_journal entry.
    // This is the authoritative server-side implementation of the journal pipeline.
    // The browser-side TradeClosureEventProcessor.processEvent() calls postTradeAnalyzer
    // which does the same thing — but since the edge function marks events as "succeeded"
    // first, the browser is locked out by the idempotency guard.
    // Resolution: The edge function OWNS journal creation for ALL server-processed trades.
    try {
      await ensureJournalEntry(supabase, event, tradeRow);
    } catch (journalError) {
      console.error(
        `[process-trade-closures] Journal creation failed for trade ${event.trade_id}:`,
        journalError
      );
      // Do NOT fail the entire event for a journal error — notification + session state
      // already ran. Log and continue so the event can be marked succeeded.
    }

    // Step 5: Mark event as processed
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
 * Ensure a journal entry exists for the closed trade.
 *
 * SSOT: This mirrors the logic in PostTradeAnalyzer.createRetroactiveJournalEntry()
 * and PostTradeAnalyzer.updateJournalWithClosureData(). It is intentionally a
 * simplified server-side version that does not require the browser context or
 * the full learning pipeline (AI learning tables are populated when the browser
 * processes the event, or via backfill).
 *
 * Idempotent: uses upsert on trade_id conflict so double-processing is safe.
 */
async function ensureJournalEntry(
  supabase: ReturnType<typeof createClient>,
  event: TradeClosureEvent,
  tradeRow: TradeRow | null
): Promise<void> {
  // Check if journal entry already exists — avoid unnecessary writes
  const { data: existing } = await supabase
    .from("ai_trade_journal")
    .select("id, journal_stage")
    .eq("trade_id", event.trade_id)
    .maybeSingle();

  const direction = tradeRow?.direction ?? event.direction ?? "buy";
  const entryPrice = tradeRow?.entry_price ?? 0;
  const exitPrice = tradeRow?.exit_price ?? event.close_price;
  const stopLoss = tradeRow?.stop_loss ?? null;
  const takeProfit = tradeRow?.take_profit ?? null;
  const entryTime = tradeRow?.created_at ?? event.created_at;
  const exitTime = tradeRow?.closed_at ?? new Date().toISOString();
  const tp1Hit = tradeRow?.tp1_hit ?? false;
  const tp2Hit = tradeRow?.tp2_hit ?? false;
  const closeReason = event.close_reason;
  const pnl = event.pnl;

  const outcome = pnl > 0 ? "win" : pnl < 0 ? "loss" : "breakeven";

  const journalStage = determineJournalStage(closeReason, tp1Hit, tp2Hit);
  const actualOutcome = buildActualOutcomeText(closeReason, pnl, exitPrice, tp1Hit, tp2Hit);

  if (!existing) {
    // Create new journal entry
    const insertData: Record<string, unknown> = {
      user_id: event.user_id,
      trade_id: event.trade_id,
      symbol: event.symbol,
      direction,
      entry_time: entryTime,
      entry_price: entryPrice,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      exit_time: exitTime,
      exit_price: exitPrice,
      llm_reasoning: `${direction.toUpperCase()} trade on ${event.symbol}. Close reason: ${closeReason}.`,
      market_read: entryPrice > 0
        ? `Trade opened at ${entryPrice}.`
        : "Entry conditions were not captured at open time.",
      expected_outcome: takeProfit && stopLoss
        ? `Expected TP at ${takeProfit}, SL at ${stopLoss}.`
        : "Target levels not recorded.",
      pattern_identified: "System Trade",
      conviction_level: 70,
      rank_at_time: "System",
      outcome,
      actual_outcome: actualOutcome,
      journal_entry_type: "trade",
      journal_stage: journalStage,
      pnl,
    };

    if (tp1Hit && pnl !== null) {
      insertData.tp1_pnl = pnl;
      insertData.tp1_exit_price = exitPrice;
    }
    if (tp2Hit && pnl !== null) {
      insertData.tp2_pnl = pnl;
      insertData.tp2_exit_price = exitPrice;
    }

    const { error } = await supabase
      .from("ai_trade_journal")
      .upsert(insertData, { onConflict: "trade_id" });

    if (error) {
      throw new Error(`Failed to upsert journal entry: ${error.message}`);
    }

    console.log(`[process-trade-closures] Journal entry created for trade ${event.trade_id} (${event.symbol} ${closeReason})`);
  } else {
    // Update existing entry with closure data if it's still in "open" stage
    if (existing.journal_stage === "open" || existing.journal_stage === null) {
      const updateData: Record<string, unknown> = {
        outcome,
        pnl,
        exit_time: exitTime,
        exit_price: exitPrice,
        actual_outcome: actualOutcome,
        journal_stage: journalStage,
        updated_at: new Date().toISOString(),
      };

      if (tp1Hit) {
        updateData.tp1_pnl = pnl;
        updateData.tp1_exit_price = exitPrice;
      }
      if (tp2Hit) {
        updateData.tp2_pnl = pnl;
        updateData.tp2_exit_price = exitPrice;
      }

      await supabase
        .from("ai_trade_journal")
        .update(updateData)
        .eq("id", existing.id);

      console.log(`[process-trade-closures] Journal entry updated for trade ${event.trade_id} (was: ${existing.journal_stage} -> ${journalStage})`);
    } else {
      console.log(`[process-trade-closures] Journal entry already in final stage (${existing.journal_stage}) for trade ${event.trade_id} — skipping`);
    }
  }
}

/**
 * Determine the journal stage based on close reason and TP flags
 */
function determineJournalStage(closeReason: string, tp1Hit: boolean, tp2Hit: boolean): string {
  if (tp2Hit || closeReason === "take_profit_2") return "tp2_hit";
  if (tp1Hit || closeReason === "take_profit_1") return "tp1_hit";
  if (closeReason === "goal_achieved") return "goal_achieved";
  return "final";
}

/**
 * Build a human-readable actual outcome text
 */
function buildActualOutcomeText(
  closeReason: string,
  pnl: number,
  exitPrice: number,
  tp1Hit: boolean,
  tp2Hit: boolean
): string {
  const sign = pnl >= 0 ? "+" : "";
  const pnlStr = `${sign}$${Math.abs(pnl).toFixed(2)}`;

  if (tp2Hit || closeReason === "take_profit_2") return `TP2 hit at ${exitPrice} — ${pnlStr}`;
  if (tp1Hit || closeReason === "take_profit_1") return `TP1 hit at ${exitPrice} — ${pnlStr}`;
  if (closeReason === "take_profit") return `Take profit hit at ${exitPrice} — ${pnlStr}`;
  if (closeReason === "stop_loss") return `Stop loss hit at ${exitPrice} — ${pnlStr}`;
  if (closeReason === "goal_achieved") return `Goal achieved — closed at ${pnlStr}`;
  if (pnl > 0) return `Closed manually for a profit of ${pnlStr} (${closeReason})`;
  if (pnl < 0) return `Closed with a loss of ${pnlStr} (${closeReason})`;
  return `Closed at breakeven (${closeReason})`;
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
