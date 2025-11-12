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

    console.log('[Auto-Backtest Executor] Starting job processing...');

    const { data: pendingJobs, error: jobsError } = await supabase
      .from('auto_backtest_queue')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(5);

    if (jobsError) {
      throw new Error(`Failed to fetch pending jobs: ${jobsError.message}`);
    }

    if (!pendingJobs || pendingJobs.length === 0) {
      console.log('[Auto-Backtest Executor] No pending jobs found');
      return new Response(
        JSON.stringify({ message: 'No pending jobs', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results = [];

    for (const job of pendingJobs) {
      try {
        console.log(`[Auto-Backtest Executor] Processing job ${job.id} for user ${job.user_id}`);

        const startTime = Date.now();

        await supabase
          .from('auto_backtest_queue')
          .update({
            status: 'processing',
            started_at: new Date().toISOString()
          })
          .eq('id', job.id);

        const backtestResult = await executeSyntheticBacktest(supabase, job);

        const processingDuration = Date.now() - startTime;

        await supabase
          .from('auto_backtest_queue')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            processing_duration_ms: processingDuration,
            session_id: backtestResult.sessionId,
            result_win_rate: backtestResult.winRate,
            result_total_pnl: backtestResult.totalPnL,
            result_total_trades: backtestResult.totalTrades
          })
          .eq('id', job.id);

        await incrementControllerBacktestCount(supabase, job.user_id, processingDuration);

        console.log(`[Auto-Backtest Executor] Job ${job.id} completed successfully`);
        results.push({
          jobId: job.id,
          status: 'completed',
          sessionId: backtestResult.sessionId,
          winRate: backtestResult.winRate,
          totalPnL: backtestResult.totalPnL
        });

      } catch (error: any) {
        console.error(`[Auto-Backtest Executor] Error processing job ${job.id}:`, error);

        await supabase
          .from('auto_backtest_queue')
          .update({
            status: 'failed',
            error_message: error.message,
            completed_at: new Date().toISOString()
          })
          .eq('id', job.id);

        await recordJobError(supabase, job.user_id);

        results.push({
          jobId: job.id,
          status: 'failed',
          error: error.message
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed: pendingJobs.length, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[Auto-Backtest Executor] Fatal error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function executeSyntheticBacktest(supabase: any, job: any): Promise<any> {
  const backtestId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const startDate = new Date(job.start_date);
  const endDate = new Date(job.end_date);

  // Initialize progress tracking
  await initializeProgressTracking(supabase, backtestId, job.user_id);

  try {
    console.log(`[Auto-Backtest Executor] Generating synthetic data for ${job.session_name}...`);

    await logStep(supabase, backtestId, job.user_id, 'Starting synthetic data generation', 'phase_start');

    const generationId = await generateSyntheticData(supabase, job, sessionId, backtestId);

    await updateProgress(supabase, backtestId, job.user_id, {
      current_step: 'Creating backtest session',
      progress_percentage: 40,
      phase: 'processing'
    });

    console.log(`[Auto-Backtest Executor] Running backtest simulation for ${job.session_name}...`);

    const backtestSessionId = await createBacktestSession(supabase, job, sessionId, generationId);

    await updateProgress(supabase, backtestId, job.user_id, {
      current_step: 'Simulating trades',
      progress_percentage: 60,
      phase: 'analyzing'
    });

    const trades = await simulateTrades(supabase, job, generationId, backtestSessionId, backtestId);

    await updateProgress(supabase, backtestId, job.user_id, {
      current_step: 'Calculating metrics',
      progress_percentage: 90,
      phase: 'completing',
      trades_executed: trades.length
    });

    const metrics = calculateBacktestMetrics(trades, 10000);

    await updateBacktestSession(supabase, backtestSessionId, metrics);

    // Mark as completed
    await updateProgress(supabase, backtestId, job.user_id, {
      current_step: 'Backtest completed',
      progress_percentage: 100,
      phase: 'completed',
      status: 'completed',
      trades_executed: metrics.totalTrades,
      winning_trades: metrics.winningTrades,
      losing_trades: metrics.losingTrades
    });

    await logStep(supabase, backtestId, job.user_id, 'Backtest completed successfully', 'phase_end', 'completed');

    return {
      sessionId: backtestSessionId,
      syntheticGenerationId: generationId,
      totalTrades: metrics.totalTrades,
      winRate: metrics.winRate,
      totalPnL: metrics.totalPnL,
      finalBalance: metrics.finalBalance
    };
  } catch (error: any) {
    // Mark as failed
    await updateProgress(supabase, backtestId, job.user_id, {
      current_step: 'Backtest failed',
      status: 'failed'
    });

    await logStep(supabase, backtestId, job.user_id, 'Backtest failed', 'error', 'failed', error.message);

    throw error;
  }
}

async function generateSyntheticData(supabase: any, job: any, sessionId: string, backtestId: string): Promise<string> {
  const generationId = crypto.randomUUID();
  const startDate = new Date(job.start_date);
  const endDate = new Date(job.end_date);

  const { error: generationError } = await supabase
    .from('synthetic_generations')
    .insert({
      id: generationId,
      user_id: job.user_id,
      symbols: job.symbols,
      timeframes: ['H1', 'M5', 'M1'],
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      market_scenario: job.market_scenario || 'mixed',
      status: 'completed',
      candles_generated: 500,
      completed_at: new Date().toISOString()
    });

  if (generationError) throw generationError;

  const candles = [];
  const hoursCount = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60));
  const totalCandles = Math.min(hoursCount, 500);
  let currentTime = new Date(startDate);
  let currentPrice = 1.1000;

  // Update progress: starting generation
  await updateProgress(supabase, backtestId, job.user_id, {
    current_step: 'Generating synthetic candles',
    progress_percentage: 10,
    phase: 'loading',
    total_candles: totalCandles,
    current_candle: 0
  });

  for (let i = 0; i < totalCandles; i++) {
    const volatility = 0.0002;
    const trend = (Math.random() - 0.5) * volatility * 2;

    currentPrice += trend;

    const open = currentPrice;
    const high = currentPrice + Math.random() * volatility;
    const low = currentPrice - Math.random() * volatility;
    const close = low + Math.random() * (high - low);

    candles.push({
      synthetic_session_id: generationId,
      symbol: job.symbols[0] || 'EURUSD',
      timeframe: 'H1',
      open_time: currentTime.toISOString(),
      close_time: new Date(currentTime.getTime() + 60 * 60 * 1000).toISOString(),
      open: open.toFixed(5),
      high: high.toFixed(5),
      low: low.toFixed(5),
      close: close.toFixed(5),
      volume: Math.floor(Math.random() * 1000)
    });

    currentTime = new Date(currentTime.getTime() + 60 * 60 * 1000);
    currentPrice = close;

    // Update progress every 50 candles
    if (i % 50 === 0 || i === totalCandles - 1) {
      const progressPercent = 10 + Math.floor((i / totalCandles) * 30); // 10% to 40%
      await updateProgress(supabase, backtestId, job.user_id, {
        current_step: `Generating synthetic candles (${i + 1}/${totalCandles})`,
        progress_percentage: progressPercent,
        phase: 'loading',
        current_candle: i + 1,
        total_candles: totalCandles
      });
    }
  }

  if (candles.length > 0) {
    const { error: candlesError } = await supabase
      .from('synthetic_candles')
      .insert(candles);

    if (candlesError) throw candlesError;
  }

  await logStep(supabase, backtestId, job.user_id, `Generated ${candles.length} synthetic candles`, 'checkpoint', 'completed');

  return generationId;
}

async function createBacktestSession(supabase: any, job: any, sessionId: string, generationId: string): Promise<string> {
  const backtestSessionId = crypto.randomUUID();

  const { error } = await supabase
    .from('synthetic_backtest_sessions')
    .insert({
      id: backtestSessionId,
      user_id: job.user_id,
      synthetic_generation_id: generationId,
      session_name: job.session_name,
      symbols: job.symbols,
      start_date: job.start_date,
      end_date: job.end_date,
      risk_mode: job.risk_level,
      confidence_threshold: job.confidence_threshold,
      initial_balance: 10000,
      total_trades: 0,
      winning_trades: 0,
      losing_trades: 0,
      breakeven_trades: 0,
      total_pnl: 0,
      final_balance: 10000,
      win_rate: 0,
      avg_win: 0,
      avg_loss: 0,
      profit_factor: 0,
      sharpe_ratio: 0,
      max_drawdown: 0,
      max_drawdown_percent: 0,
      signals_generated: 0,
      signals_executed: 0,
      signals_skipped: 0,
      created_at: new Date().toISOString()
    });

  if (error) throw error;
  return backtestSessionId;
}

async function simulateTrades(supabase: any, job: any, generationId: string, sessionId: string, backtestId: string): Promise<any[]> {
  const { data: candles } = await supabase
    .from('synthetic_candles')
    .select('*')
    .eq('synthetic_session_id', generationId)
    .order('open_time', { ascending: true });

  if (!candles || candles.length === 0) return [];

  const trades = [];
  const numTrades = Math.floor(Math.random() * 10) + 5;

  for (let i = 0; i < numTrades && i < candles.length - 1; i++) {
    const entryCandle = candles[Math.floor(Math.random() * (candles.length - 1))];
    const exitIndex = candles.findIndex(c => c.open_time === entryCandle.open_time) + 1 + Math.floor(Math.random() * 5);
    const exitCandle = candles[Math.min(exitIndex, candles.length - 1)];

    const direction = Math.random() > 0.5 ? 'long' : 'short';
    const entryPrice = parseFloat(entryCandle.close);
    const exitPrice = parseFloat(exitCandle.close);

    const pips = direction === 'long'
      ? (exitPrice - entryPrice) * 10000
      : (entryPrice - exitPrice) * 10000;

    const pnl = pips * 10;
    const outcome = pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven';

    const trade = {
      session_id: sessionId,
      symbol: job.symbols[0] || 'EURUSD',
      direction,
      entry_time: entryCandle.open_time,
      entry_price: entryPrice,
      exit_time: exitCandle.open_time,
      exit_price: exitPrice,
      position_size: 0.1,
      stop_loss: direction === 'long' ? entryPrice - 0.0020 : entryPrice + 0.0020,
      take_profit: direction === 'long' ? entryPrice + 0.0040 : entryPrice - 0.0040,
      pnl,
      pips,
      outcome,
      exit_reason: outcome === 'win' ? 'take_profit' : 'stop_loss',
      confidence_score: 75 + Math.random() * 15,
      created_at: new Date().toISOString()
    };

    trades.push(trade);

    // Update progress for each trade
    const wins = trades.filter(t => t.outcome === 'win').length;
    const losses = trades.filter(t => t.outcome === 'loss').length;
    const progressPercent = 60 + Math.floor((i / numTrades) * 30); // 60% to 90%

    await updateProgress(supabase, backtestId, job.user_id, {
      current_step: `Simulating trades (${i + 1}/${numTrades})`,
      progress_percentage: progressPercent,
      phase: 'analyzing',
      trades_executed: trades.length,
      winning_trades: wins,
      losing_trades: losses
    });
  }

  if (trades.length > 0) {
    await supabase.from('synthetic_backtest_trades').insert(trades);
  }

  await logStep(supabase, backtestId, job.user_id, `Simulated ${trades.length} trades`, 'checkpoint', 'completed');

  return trades;
}

function calculateBacktestMetrics(trades: any[], initialBalance: number): any {
  const totalTrades = trades.length;
  const wins = trades.filter(t => t.outcome === 'win');
  const losses = trades.filter(t => t.outcome === 'loss');
  const breakevens = trades.filter(t => t.outcome === 'breakeven');

  const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);
  const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;
  const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length) : 0;
  const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : 0;

  return {
    totalTrades,
    winningTrades: wins.length,
    losingTrades: losses.length,
    breakevenTrades: breakevens.length,
    totalPnL,
    finalBalance: initialBalance + totalPnL,
    winRate,
    avgWin,
    avgLoss,
    profitFactor,
    sharpeRatio: 0,
    maxDrawdown: 0,
    maxDrawdownPercent: 0
  };
}

async function updateBacktestSession(supabase: any, sessionId: string, metrics: any): Promise<void> {
  await supabase
    .from('synthetic_backtest_sessions')
    .update(metrics)
    .eq('id', sessionId);
}

async function incrementControllerBacktestCount(supabase: any, userId: string, processingDuration: number): Promise<void> {
  const { data: controller } = await supabase
    .from('auto_backtest_controller')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .single();

  if (controller) {
    await supabase
      .from('auto_backtest_controller')
      .update({
        total_backtests_completed: controller.total_backtests_completed + 1,
        current_cycle_count: controller.current_cycle_count + 1,
        consecutive_errors: 0,
        last_backtest_completed_at: new Date().toISOString(),
        last_database_response_ms: processingDuration,
        updated_at: new Date().toISOString()
      })
      .eq('id', controller.id);
  }
}

async function recordJobError(supabase: any, userId: string): Promise<void> {
  const { data: controller } = await supabase
    .from('auto_backtest_controller')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .single();

  if (controller) {
    await supabase
      .from('auto_backtest_controller')
      .update({
        consecutive_errors: controller.consecutive_errors + 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', controller.id);
  }
}

// Helper function to initialize progress tracking
async function initializeProgressTracking(supabase: any, backtestId: string, userId: string): Promise<void> {
  await supabase.rpc('update_backtest_progress', {
    p_backtest_id: backtestId,
    p_user_id: userId,
    p_current_step: 'Initializing backtest',
    p_progress_percentage: 0,
    p_phase: 'initializing',
    p_status: 'running'
  });
}

// Helper function to update progress
async function updateProgress(supabase: any, backtestId: string, userId: string, updates: any): Promise<void> {
  const params: any = {
    p_backtest_id: backtestId,
    p_user_id: userId
  };

  if (updates.current_step !== undefined) params.p_current_step = updates.current_step;
  if (updates.progress_percentage !== undefined) params.p_progress_percentage = updates.progress_percentage;
  if (updates.current_candle !== undefined) params.p_current_candle = updates.current_candle;
  if (updates.total_candles !== undefined) params.p_total_candles = updates.total_candles;
  if (updates.phase !== undefined) params.p_phase = updates.phase;
  if (updates.trades_executed !== undefined) params.p_trades_executed = updates.trades_executed;
  if (updates.winning_trades !== undefined) params.p_winning_trades = updates.winning_trades;
  if (updates.losing_trades !== undefined) params.p_losing_trades = updates.losing_trades;
  if (updates.memory_usage_mb !== undefined) params.p_memory_usage_mb = updates.memory_usage_mb;
  if (updates.cpu_usage_percent !== undefined) params.p_cpu_usage_percent = updates.cpu_usage_percent;
  if (updates.status !== undefined) params.p_status = updates.status;

  await supabase.rpc('update_backtest_progress', params);
}

// Helper function to log execution steps
async function logStep(
  supabase: any,
  backtestId: string,
  userId: string,
  stepName: string,
  stepType: string = 'info',
  status: string = 'completed',
  message?: string
): Promise<void> {
  await supabase.rpc('log_backtest_step', {
    p_backtest_id: backtestId,
    p_user_id: userId,
    p_step_name: stepName,
    p_step_type: stepType,
    p_status: status,
    p_message: message
  });
}
