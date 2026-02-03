import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("[SessionIntelligenceUpdater] Starting real-time intelligence generation...");

    // Call the database function to update session intelligence
    const { error } = await supabase.rpc("update_session_intelligence");

    if (error) {
      console.error("[SessionIntelligenceUpdater] Error updating intelligence:", error);
      throw error;
    }

    console.log("[SessionIntelligenceUpdater] ✅ Session intelligence updated successfully");

    return new Response(
      JSON.stringify({
        success: true,
        message: "Session intelligence updated successfully",
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error: any) {
    console.error("[SessionIntelligenceUpdater] Fatal error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Failed to update session intelligence",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
