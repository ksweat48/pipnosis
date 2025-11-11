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
  const sessionId = crypto.randomUUID();
  const startDate = new Date(job.start_date);
  const endDate = new Date(job.end_date);

  console.log(`[Auto-Backtest Executor] Generating synthetic data for ${job.session_name}...`);

  const generationId = await generateSyntheticData(supabase, job, sessionId);

  console.log(`[Auto-Backtest Executor] Running backtest simulation for ${job.session_name}...`);

  const backtestSessionId = await createBacktestSession(supabase, job, sessionId, generationId);

  const trades = await simulateTrades(supabase, job, generationId, backtestSessionId);

  const metrics = calculateBacktestMetrics(trades, 10000);

  await updateBacktestSession(supabase, backtestSessionId, metrics);

  return {
    sessionId: backtestSessionId,
    syntheticGenerationId: generationId,
    totalTrades: metrics.totalTrades,
    winRate: metrics.winRate,
    totalPnL: metrics.totalPnL,
    finalBalance: metrics.finalBalance
  };
}

async function generateSyntheticData(supabase: any, job: any, sessionId: string): Promise<string> {
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
  let currentTime = new Date(startDate);
  let currentPrice = 1.1000;

  for (let i = 0; i < Math.min(hoursCount, 500); i++) {
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
  }

  if (candles.length > 0) {
    const { error: candlesError } = await supabase
      .from('synthetic_candles')
      .insert(candles);

    if (candlesError) throw candlesError;
  }

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

async function simulateTrades(supabase: any, job: any, generationId: string, sessionId: string): Promise<any[]> {
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
  }

  if (trades.length > 0) {
    await supabase.from('synthetic_backtest_trades').insert(trades);
  }

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
