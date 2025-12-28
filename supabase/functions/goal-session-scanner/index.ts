import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ScanRequest {
  sessionId?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const payload: ScanRequest = await req.json();
    console.log('[Goal Scanner] Invoked with sessionId:', payload.sessionId);

    // Query for active sessions that need scanning
    const query = supabase
      .from('goal_sessions')
      .select('id, user_id, target_value, current_progress, status, next_scan_time')
      .in('status', ['scanning', 'trade_pending']);

    // If specific session requested, filter to that
    if (payload.sessionId) {
      query.eq('id', payload.sessionId);
    }

    const { data: sessions, error } = await query;

    if (error) {
      console.error('[Goal Scanner] Error querying sessions:', error);
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Failed to query sessions',
          error: error.message,
          scanned: 0,
          results: [],
        }),
        { 
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!sessions || sessions.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No active sessions to scan',
          scanned: 0,
          results: [],
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Goal Scanner] Found ${sessions.length} session(s) to scan`);

    // Update next_scan_time for scanned sessions
    const nextScanTime = new Date();
    nextScanTime.setMinutes(nextScanTime.getMinutes() + 1); // Scan again in 1 minute

    for (const session of sessions) {
      await supabase
        .from('goal_sessions')
        .update({
          last_scan_time: new Date().toISOString(),
          next_scan_time: nextScanTime.toISOString(),
        })
        .eq('id', session.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Scanned ${sessions.length} session(s)`,
        scanned: sessions.length,
        results: sessions.map(s => ({
          sessionId: s.id,
          status: s.status,
          nextScanTime: nextScanTime.toISOString(),
        })),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[Goal Scanner] Unexpected error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Scanner encountered an error',
        error: error instanceof Error ? error.message : 'Unknown error',
        scanned: 0,
        results: [],
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
