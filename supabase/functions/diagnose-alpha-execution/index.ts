import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface DiagnoseRequest {
  sessionId: string;
}

interface ExecutionBlockSummary {
  totalDecisions: number;
  successfulExecutions: number;
  blockedDecisions: number;
  topBlockReasons: Array<{ reason: string; count: number; severity: string }>;
  recoverable: number;
  lastBlockedAt: string | null;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    // Verify JWT and get user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_ANON_KEY") || ""
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.split(" ")[1]);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { sessionId } = body as DiagnoseRequest;

    if (!sessionId) {
      return new Response(JSON.stringify({ error: "sessionId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Query execution audit summary
    const { data: audits } = await supabase
      .from("alpha_execution_audit")
      .select("id, created_at, execution_success")
      .eq("user_id", user.id)
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (!audits || audits.length === 0) {
      return new Response(
        JSON.stringify({
          summary: {
            totalDecisions: 0,
            successfulExecutions: 0,
            blockedDecisions: 0,
            topBlockReasons: [],
            recoverable: 0,
            lastBlockedAt: null,
          },
          recentAudits: [],
          diagnostics: null,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get all blocks
    const auditIds = audits.map((a) => a.id);
    const { data: blocks } = await supabase
      .from("execution_block_reasons")
      .select("specific_reason, severity, recoverable, block_category")
      .in("audit_id", auditIds);

    const blockCounts: Record<
      string,
      { count: number; severity: string; recoverable: number; category: string }
    > = {};
    let totalRecoverable = 0;

    (blocks || []).forEach((block) => {
      if (!blockCounts[block.specific_reason]) {
        blockCounts[block.specific_reason] = {
          count: 0,
          severity: block.severity,
          recoverable: 0,
          category: block.block_category,
        };
      }
      blockCounts[block.specific_reason].count++;
      if (block.recoverable) {
        blockCounts[block.specific_reason].recoverable++;
        totalRecoverable++;
      }
    });

    const topReasons = Object.entries(blockCounts)
      .map(([reason, data]) => ({
        reason,
        count: data.count,
        severity: data.severity,
        category: data.category,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const lastBlocked = audits.find((a) => a.execution_success === false);

    const summary: ExecutionBlockSummary = {
      totalDecisions: audits.length,
      successfulExecutions: audits.filter((a) => a.execution_success === true).length,
      blockedDecisions: (blocks || []).length,
      topBlockReasons: topReasons,
      recoverable: totalRecoverable,
      lastBlockedAt: lastBlocked?.created_at || null,
    };

    // Get latest diagnostic snapshot
    const { data: diagnostic } = await supabase
      .from("alpha_decision_diagnostics")
      .select("*")
      .eq("user_id", user.id)
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Get recent audits with details
    const { data: recentAudits } = await supabase
      .from("alpha_execution_audit")
      .select("id, action, symbol, confidence, execution_success, created_at")
      .eq("user_id", user.id)
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(10);

    return new Response(
      JSON.stringify({
        summary,
        recentAudits,
        diagnostics: diagnostic,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Diagnostic error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
