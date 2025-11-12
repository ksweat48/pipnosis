import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface HealthMetrics {
  stressScore: number;
  databaseResponseMs: number;
  errorRatePercent: number;
  activeBacktests: number;
}

interface BacktestJobConfig {
  sessionName: string;
  userId: string;
  durationDays: number;
  riskLevel: 'low' | 'medium' | 'high';
  symbols: string[];
  startDate: string;
  endDate: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const timestamp = new Date().toISOString();
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[Auto-Backtest Runner] 🚀 EXECUTION CYCLE STARTED at ${timestamp}`);
    console.log(`${'='.repeat(80)}\n`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log('[Auto-Backtest Runner] ✅ Supabase client initialized');

    console.log('[Auto-Backtest Runner] 🔍 Fetching active controllers...');
    const { data: controllers, error: controllersError } = await supabase
      .from('auto_backtest_controller')
      .select('*')
      .eq('is_active', true)
      .eq('status', 'running');

    if (controllersError) {
      console.error('[Auto-Backtest Runner] ❌ Database error fetching controllers:', controllersError);
      throw new Error(`Failed to fetch controllers: ${controllersError.message}`);
    }

    console.log(`[Auto-Backtest Runner] Found ${controllers?.length || 0} active controller(s)`);

    if (!controllers || controllers.length === 0) {
      console.log('[Auto-Backtest Runner] ⚠️ No active controllers found - system is idle');
      console.log('[Auto-Backtest Runner] 💡 Tip: Make sure auto-backtest is started from the UI');
      return new Response(
        JSON.stringify({ message: 'No active controllers', timestamp: new Date().toISOString() }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results = [];

    for (const controller of controllers) {
      try {
        console.log(`\n${'~'.repeat(60)}`);
        console.log(`[Auto-Backtest Runner] 🎮 Processing Controller ${controller.id}`);
        console.log(`[Auto-Backtest Runner]   User: ${controller.user_id}`);
        console.log(`[Auto-Backtest Runner]   Status: ${controller.status}`);
        console.log(`[Auto-Backtest Runner]   Cycle: ${controller.current_cycle_count}`);
        console.log(`[Auto-Backtest Runner]   Total completed: ${controller.total_backtests_completed}`);
        console.log(`${'~'.repeat(60)}\n`);

        console.log('[Auto-Backtest Runner] 🔍 Checking for live trades...');
        const isLiveTradePaused = await checkLiveTrade(supabase, controller.user_id);
        if (isLiveTradePaused) {
          console.log(`[Auto-Backtest Runner] ⏸️ Controller ${controller.id} paused - live trade detected`);
          await updateControllerStatus(supabase, controller.id, 'paused_for_live_trade', {
            paused_for_live_trade: true,
          });
          continue;
        } else {
          console.log('[Auto-Backtest Runner] ✅ No live trades - proceeding');
        }

        if (controller.cooldown_active && controller.cooldown_ends_at) {
          const now = new Date();
          const cooldownEnd = new Date(controller.cooldown_ends_at);
          const remainingMs = cooldownEnd.getTime() - now.getTime();
          if (now < cooldownEnd) {
            const remainingMinutes = Math.ceil(remainingMs / 60000);
            console.log(`[Auto-Backtest Runner] ⏰ Controller ${controller.id} in cooldown for ${remainingMinutes} more minutes`);
            console.log(`[Auto-Backtest Runner]   Reason: ${controller.cooldown_reason}`);
            continue;
          } else {
            console.log(`[Auto-Backtest Runner] ✅ Cooldown expired, resuming controller ${controller.id}`);
            await endCooldown(supabase, controller.id);
          }
        }

        console.log('[Auto-Backtest Runner] 📊 Loading configuration...');
        const config = await loadConfig(supabase, controller.user_id);
        console.log('[Auto-Backtest Runner] Config:', {
          maxRuns: config.max_consecutive_runs,
          cooldownMinutes: config.standard_cooldown_minutes,
          durationDays: `${config.min_duration_days}-${config.max_duration_days}`
        });

        console.log('[Auto-Backtest Runner] 💚 Collecting health metrics...');
        const healthMetrics = await collectHealthMetrics(supabase, controller.id);
        console.log('[Auto-Backtest Runner] Health:', healthMetrics);
        await logHealthMetrics(supabase, controller.id, controller.user_id, healthMetrics);

        console.log('[Auto-Backtest Runner] ⚙️ Checking cooldown triggers...');
        const shouldCooldown = checkCooldownTriggers(healthMetrics, config, controller);
        if (shouldCooldown.triggered) {
          console.log(`[Auto-Backtest Runner] 🛑 Cooldown triggered: ${shouldCooldown.reason}`);
          console.log(`[Auto-Backtest Runner]   Duration: ${shouldCooldown.durationMinutes} minutes`);
          await startCooldown(supabase, controller.id, shouldCooldown.reason!, shouldCooldown.durationMinutes!);
          continue;
        } else {
          console.log('[Auto-Backtest Runner] ✅ Health checks passed');
        }

        if (controller.current_cycle_count >= config.max_consecutive_runs) {
          console.log(`[Auto-Backtest Runner] 🎯 Cycle complete: ${controller.current_cycle_count}/${config.max_consecutive_runs} backtests`);
          console.log(`[Auto-Backtest Runner] ⏰ Starting ${config.standard_cooldown_minutes}-minute cooldown`);
          await startCooldown(supabase, controller.id, 'cycle_complete', config.standard_cooldown_minutes);
          continue;
        }

        console.log('[Auto-Backtest Runner] 🎲 Generating new backtest job...');
        const jobConfig = generateBacktestJob(controller.user_id, config);
        console.log('[Auto-Backtest Runner] Job config:', {
          session: jobConfig.sessionName,
          duration: `${jobConfig.durationDays} days`,
          riskLevel: jobConfig.riskLevel,
          symbols: jobConfig.symbols.join(', '),
          dateRange: `${jobConfig.startDate.substring(0, 10)} to ${jobConfig.endDate.substring(0, 10)}`
        });

        console.log('[Auto-Backtest Runner] 📥 Queueing job to database...');
        await queueBacktestJob(supabase, jobConfig);
        console.log('[Auto-Backtest Runner] ✅ Job successfully queued!');

        results.push({
          controllerId: controller.id,
          userId: controller.user_id,
          status: 'job_queued',
          jobConfig
        });

      } catch (error: any) {
        console.error(`[Auto-Backtest Runner] ❌ ERROR processing controller ${controller.id}:`, error);
        console.error('[Auto-Backtest Runner] Error stack:', error.stack);
        await recordControllerError(supabase, controller.id);
        results.push({
          controllerId: controller.id,
          status: 'error',
          error: error.message
        });
      }
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`[Auto-Backtest Runner] ✅ EXECUTION CYCLE COMPLETED`);
    console.log(`[Auto-Backtest Runner] Processed: ${controllers.length} controller(s)`);
    console.log(`[Auto-Backtest Runner] Queued: ${results.filter(r => r.status === 'job_queued').length} job(s)`);
    console.log(`[Auto-Backtest Runner] Errors: ${results.filter(r => r.status === 'error').length}`);
    console.log(`${'='.repeat(80)}\n`);

    return new Response(
      JSON.stringify({ success: true, processed: controllers.length, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[Auto-Backtest Runner] 🚨 FATAL ERROR:', error);
    console.error('[Auto-Backtest Runner] Stack trace:', error.stack);
    return new Response(
      JSON.stringify({ success: false, error: error.message, timestamp: new Date().toISOString() }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function checkLiveTrade(supabase: any, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('simulated_positions')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'open')
    .limit(1);

  return !error && data && data.length > 0;
}

async function loadConfig(supabase: any, userId: string): Promise<any> {
  const { data, error } = await supabase
    .from('auto_backtest_config')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) {
    return {
      max_consecutive_runs: 100,
      standard_cooldown_minutes: 15,
      max_stress_score: 80,
      max_db_response_ms: 5000,
      max_error_rate_percent: 10,
      max_consecutive_errors: 3,
      min_duration_days: 1,
      max_duration_days: 3,
      delay_between_runs_min_seconds: 1,
      delay_between_runs_max_seconds: 20
    };
  }

  return data;
}

async function collectHealthMetrics(supabase: any, controllerId: string): Promise<HealthMetrics> {
  const dbStartTime = Date.now();
  await supabase.from('auto_backtest_controller').select('id').eq('id', controllerId).single();
  const dbResponseMs = Date.now() - dbStartTime;

  const { data: controller } = await supabase
    .from('auto_backtest_controller')
    .select('consecutive_errors')
    .eq('id', controllerId)
    .single();

  const errorCount = controller?.consecutive_errors || 0;

  let stressScore = 0;
  if (dbResponseMs > 1000) stressScore += 30;
  if (dbResponseMs > 3000) stressScore += 30;
  if (errorCount > 0) stressScore += errorCount * 10;
  stressScore = Math.min(100, stressScore);

  const errorRatePercent = errorCount > 0 ? Math.min(100, errorCount * 5) : 0;

  return {
    stressScore,
    databaseResponseMs: dbResponseMs,
    errorRatePercent,
    activeBacktests: 1
  };
}

async function logHealthMetrics(supabase: any, controllerId: string, userId: string, metrics: HealthMetrics): Promise<void> {
  await supabase
    .from('auto_backtest_health_log')
    .insert({
      user_id: userId,
      controller_id: controllerId,
      stress_score: metrics.stressScore,
      database_response_ms: metrics.databaseResponseMs,
      error_rate_percent: metrics.errorRatePercent,
      active_backtests: metrics.activeBacktests,
      action_taken: 'continue'
    });

  await supabase
    .from('auto_backtest_controller')
    .update({
      system_stress_score: metrics.stressScore,
      last_database_response_ms: metrics.databaseResponseMs,
      last_health_check_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', controllerId);
}

function checkCooldownTriggers(metrics: HealthMetrics, config: any, controller: any): { triggered: boolean; reason?: string; durationMinutes?: number } {
  if (metrics.stressScore >= config.max_stress_score) {
    return { triggered: true, reason: 'high_stress', durationMinutes: 15 };
  }

  if (metrics.databaseResponseMs >= config.max_db_response_ms) {
    return { triggered: true, reason: 'slow_database', durationMinutes: 10 };
  }

  if (metrics.errorRatePercent >= config.max_error_rate_percent) {
    return { triggered: true, reason: 'high_error_rate', durationMinutes: 10 };
  }

  if (controller.consecutive_errors >= config.max_consecutive_errors) {
    return { triggered: true, reason: 'consecutive_errors', durationMinutes: 20 };
  }

  return { triggered: false };
}

async function startCooldown(supabase: any, controllerId: string, reason: string, durationMinutes: number): Promise<void> {
  const now = new Date();
  const endsAt = new Date(now.getTime() + durationMinutes * 60000);

  await supabase
    .from('auto_backtest_controller')
    .update({
      status: 'cooldown',
      cooldown_active: true,
      cooldown_started_at: now.toISOString(),
      cooldown_ends_at: endsAt.toISOString(),
      cooldown_reason: reason,
      cooldown_duration_minutes: durationMinutes,
      current_cycle_count: 0,
      consecutive_errors: 0,
      updated_at: new Date().toISOString()
    })
    .eq('id', controllerId);
}

async function endCooldown(supabase: any, controllerId: string): Promise<void> {
  await supabase
    .from('auto_backtest_controller')
    .update({
      status: 'running',
      cooldown_active: false,
      cooldown_started_at: null,
      cooldown_ends_at: null,
      cooldown_reason: null,
      current_cycle_count: 0,
      updated_at: new Date().toISOString()
    })
    .eq('id', controllerId);
}

function generateBacktestJob(userId: string, config: any): BacktestJobConfig {
  const durationDays = Math.floor(Math.random() * (config.max_duration_days - config.min_duration_days + 1)) + config.min_duration_days;
  const riskLevels: ('low' | 'medium' | 'high')[] = ['low', 'medium', 'high'];
  const riskLevel = riskLevels[Math.floor(Math.random() * riskLevels.length)];
  const symbols = ['EURUSD', 'XAUUSD', 'GBPUSD', 'USDJPY', 'US30'];

  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - durationDays * 24 * 60 * 60 * 1000);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const sessionName = `Auto-BT-${timestamp}`;

  return {
    sessionName,
    userId,
    durationDays,
    riskLevel,
    symbols,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString()
  };
}

async function queueBacktestJob(supabase: any, job: BacktestJobConfig): Promise<void> {
  await supabase
    .from('auto_backtest_queue')
    .insert({
      user_id: job.userId,
      session_name: job.sessionName,
      symbols: job.symbols,
      start_date: job.startDate,
      end_date: job.endDate,
      risk_level: job.riskLevel,
      status: 'pending',
      created_at: new Date().toISOString()
    });
}

async function recordControllerError(supabase: any, controllerId: string): Promise<void> {
  const { data: controller } = await supabase
    .from('auto_backtest_controller')
    .select('consecutive_errors')
    .eq('id', controllerId)
    .single();

  const errorCount = (controller?.consecutive_errors || 0) + 1;

  await supabase
    .from('auto_backtest_controller')
    .update({
      consecutive_errors: errorCount,
      updated_at: new Date().toISOString()
    })
    .eq('id', controllerId);
}

async function updateControllerStatus(supabase: any, controllerId: string, status: string, updates: any = {}): Promise<void> {
  await supabase
    .from('auto_backtest_controller')
    .update({
      status,
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', controllerId);
}