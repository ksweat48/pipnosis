import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { action } = await req.json();

    if (action === 'start') {
      return await handleStart(supabase, user.id);
    } else if (action === 'stop') {
      return await handleStop(supabase, user.id);
    } else if (action === 'status') {
      return await handleStatus(supabase, user.id);
    } else {
      return new Response(
        JSON.stringify({ error: "Invalid action. Use 'start', 'stop', or 'status'" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error: any) {
    console.error('[Auto-Backtest Control] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function handleStart(supabase: any, userId: string): Promise<Response> {
  console.log(`[Auto-Backtest Control] Starting controller for user ${userId}`);

  const { data: existing } = await supabase
    .from('auto_backtest_controller')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let controllerId: string;

  if (existing && existing.is_active) {
    await supabase
      .from('auto_backtest_controller')
      .update({
        status: 'running',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', existing.id);

    controllerId = existing.id;
  } else {
    const { data: newController } = await supabase
      .from('auto_backtest_controller')
      .insert({
        user_id: userId,
        status: 'running',
        is_active: true,
        started_at: new Date().toISOString()
      })
      .select()
      .single();

    controllerId = newController.id;
  }

  const { data: config } = await supabase
    .from('auto_backtest_config')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (!config) {
    await supabase
      .from('auto_backtest_config')
      .insert({ user_id: userId });
  }

  return new Response(
    JSON.stringify({
      success: true,
      message: 'Auto-backtest controller started',
      controllerId
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function handleStop(supabase: any, userId: string): Promise<Response> {
  console.log(`[Auto-Backtest Control] Stopping controller for user ${userId}`);

  const { data: controller } = await supabase
    .from('auto_backtest_controller')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (!controller) {
    return new Response(
      JSON.stringify({ success: true, message: 'No active controller found' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  await supabase
    .from('auto_backtest_controller')
    .update({
      status: 'stopped',
      is_active: false,
      stopped_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', controller.id);

  await supabase
    .from('auto_backtest_queue')
    .update({
      status: 'cancelled'
    })
    .eq('user_id', userId)
    .eq('status', 'pending');

  return new Response(
    JSON.stringify({
      success: true,
      message: 'Auto-backtest controller stopped',
      controllerId: controller.id
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function handleStatus(supabase: any, userId: string): Promise<Response> {
  const { data: controller } = await supabase
    .from('auto_backtest_controller')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!controller) {
    return new Response(
      JSON.stringify({
        success: true,
        controller: null,
        message: 'No controller found'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const { data: queueStats } = await supabase
    .from('auto_backtest_queue')
    .select('status')
    .eq('user_id', userId);

  const stats = {
    pending: queueStats?.filter(j => j.status === 'pending').length || 0,
    processing: queueStats?.filter(j => j.status === 'processing').length || 0,
    completed: queueStats?.filter(j => j.status === 'completed').length || 0,
    failed: queueStats?.filter(j => j.status === 'failed').length || 0
  };

  return new Response(
    JSON.stringify({
      success: true,
      controller: {
        id: controller.id,
        status: controller.status,
        isActive: controller.is_active,
        totalBacktestsCompleted: controller.total_backtests_completed,
        consecutiveRuns: controller.consecutive_runs,
        currentCycleCount: controller.current_cycle_count,
        cooldownActive: controller.cooldown_active,
        cooldownEndsAt: controller.cooldown_ends_at,
        cooldownReason: controller.cooldown_reason,
        systemStressScore: controller.system_stress_score,
        pausedForLiveTrade: controller.paused_for_live_trade,
        startedAt: controller.started_at,
        stoppedAt: controller.stopped_at
      },
      queueStats: stats
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
