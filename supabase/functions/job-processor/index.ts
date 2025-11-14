import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.53.0';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface BacktestPayload {
  symbol: string;
  timeframe: string;
  strategy: string;
  start_date: string;
  end_date: string;
  candle_count?: number;
}

interface JobRecord {
  id: string;
  job_type: string;
  payload: BacktestPayload;
  user_id: string;
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
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'process';

    // Health check endpoint
    if (action === 'health') {
      return new Response(
        JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Process next job
    if (action === 'process') {
      console.log('🔍 Checking for pending jobs...');

      // Get next pending job using SKIP LOCKED to prevent race conditions
      const { data: jobId, error: getJobError } = await supabase
        .rpc('get_next_pending_job');

      if (getJobError) {
        console.error('Error getting next job:', getJobError);
        throw getJobError;
      }

      if (!jobId) {
        console.log('✅ No pending jobs');
        return new Response(
          JSON.stringify({ message: 'No pending jobs', processed: false }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`📋 Processing job: ${jobId}`);

      // Get job details
      const { data: job, error: jobError } = await supabase
        .from('job_queue')
        .select('*')
        .eq('id', jobId)
        .single();

      if (jobError || !job) {
        console.error('Error fetching job details:', jobError);
        throw jobError;
      }

      const jobRecord = job as JobRecord;

      // Process based on job type
      let result;
      try {
        switch (jobRecord.job_type) {
          case 'backtest':
            result = await processBacktest(supabase, jobRecord);
            break;
          case 'ai_training':
            result = await processAITraining(supabase, jobRecord);
            break;
          case 'data_quality':
            result = await processDataQuality(supabase, jobRecord);
            break;
          default:
            throw new Error(`Unknown job type: ${jobRecord.job_type}`);
        }

        // Mark job as completed
        await supabase.rpc('complete_job', {
          p_job_id: jobId,
          p_status: 'completed',
          p_result: result,
        });

        console.log(`✅ Job ${jobId} completed successfully`);

        return new Response(
          JSON.stringify({
            message: 'Job completed successfully',
            jobId,
            result,
            processed: true,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

      } catch (error) {
        console.error(`❌ Job ${jobId} failed:`, error);

        // Mark job as failed
        await supabase.rpc('complete_job', {
          p_job_id: jobId,
          p_status: 'failed',
          p_error_message: error instanceof Error ? error.message : String(error),
        });

        // Retry if within retry limit
        const { error: retryError } = await supabase.rpc('retry_job', {
          p_job_id: jobId,
        });

        if (!retryError) {
          console.log(`🔄 Job ${jobId} scheduled for retry`);
        }

        throw error;
      }
    }

    // Manual job trigger endpoint
    if (action === 'trigger') {
      const { job_type, payload, priority } = await req.json();

      const { data: jobId, error } = await supabase.rpc('queue_job', {
        p_job_type: job_type,
        p_payload: payload,
        p_user_id: null, // System job
        p_priority: priority || 50,
      });

      if (error) throw error;

      return new Response(
        JSON.stringify({ message: 'Job queued successfully', jobId }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in job processor:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        processed: false,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Process a backtest job
async function processBacktest(supabase: any, job: JobRecord): Promise<any> {
  const payload = job.payload;
  console.log(`🎯 Running backtest for ${payload.symbol} on ${payload.timeframe}`);

  // Update progress: Fetching candles
  await supabase.rpc('update_job_progress', {
    p_job_id: job.id,
    p_progress_percentage: 10,
    p_message: 'Fetching historical candles',
  });

  // Fetch candles from database
  const { data: candles, error: candleError } = await supabase
    .from('forex_candles')
    .select('*')
    .eq('symbol', payload.symbol)
    .eq('timeframe', payload.timeframe)
    .gte('open_time', payload.start_date)
    .lte('open_time', payload.end_date)
    .order('open_time', { ascending: true });

  if (candleError) throw candleError;

  if (!candles || candles.length === 0) {
    throw new Error('No candles found for backtest period');
  }

  console.log(`📊 Processing ${candles.length} candles`);

  // Update progress: Running backtest
  await supabase.rpc('update_job_progress', {
    p_job_id: job.id,
    p_progress_percentage: 30,
    p_message: `Running backtest on ${candles.length} candles`,
  });

  // Execute backtest (simplified - call your actual backtest logic)
  const results = await executeBacktest(candles, payload.strategy);

  // Update progress: Saving results
  await supabase.rpc('update_job_progress', {
    p_job_id: job.id,
    p_progress_percentage: 80,
    p_message: 'Saving backtest results',
  });

  // Save backtest results
  const { error: saveError } = await supabase
    .from('synthetic_backtest_results')
    .insert({
      user_id: job.user_id,
      symbol: payload.symbol,
      timeframe: payload.timeframe,
      strategy_name: payload.strategy,
      ...results,
    });

  if (saveError) throw saveError;

  // Trigger AI learning from this backtest
  await supabase.rpc('queue_job', {
    p_job_type: 'ai_training',
    p_payload: { backtest_results: results, symbol: payload.symbol },
    p_user_id: job.user_id,
    p_priority: 75, // Higher priority for AI training
  });

  return results;
}

// Execute backtest logic (simplified)
async function executeBacktest(candles: any[], strategy: string): Promise<any> {
  let balance = 10000;
  let wins = 0;
  let losses = 0;
  const trades = [];

  // Simplified backtest logic - replace with your actual strategy
  for (let i = 20; i < candles.length; i++) {
    const candle = candles[i];
    const previousCandles = candles.slice(i - 20, i);

    // Simple moving average crossover strategy example
    const shortMA = previousCandles.slice(-5).reduce((sum, c) => sum + c.close, 0) / 5;
    const longMA = previousCandles.slice(-20).reduce((sum, c) => sum + c.close, 0) / 20;

    if (shortMA > longMA) {
      // Buy signal
      const entry = candle.close;
      const target = entry * 1.005; // 0.5% profit target
      const stopLoss = entry * 0.995; // 0.5% stop loss

      // Check next candle
      if (i + 1 < candles.length) {
        const nextCandle = candles[i + 1];
        if (nextCandle.high >= target) {
          wins++;
          balance += 50;
          trades.push({ type: 'win', profit: 50 });
        } else if (nextCandle.low <= stopLoss) {
          losses++;
          balance -= 50;
          trades.push({ type: 'loss', profit: -50 });
        }
      }
    }
  }

  const totalTrades = wins + losses;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const profitLoss = balance - 10000;

  return {
    total_trades: totalTrades,
    winning_trades: wins,
    losing_trades: losses,
    win_rate: winRate,
    total_profit_loss: profitLoss,
    final_balance: balance,
    trades: trades.slice(0, 100), // Store first 100 trades
    candles_processed: candles.length,
  };
}

// Process AI training job
async function processAITraining(supabase: any, job: JobRecord): Promise<any> {
  console.log('🤖 Processing AI training job');

  // Update progress
  await supabase.rpc('update_job_progress', {
    p_job_id: job.id,
    p_progress_percentage: 50,
    p_message: 'Training AI on backtest results',
  });

  // Extract patterns and insights from backtest results
  const payload = job.payload;
  const backtestResults = payload.backtest_results;

  // Calculate skill metrics
  const skillMetrics = {
    pattern_recognition: Math.min(100, backtestResults.win_rate * 1.2),
    risk_management: Math.min(100, (backtestResults.winning_trades / Math.max(1, backtestResults.losing_trades)) * 25),
    timing_accuracy: Math.min(100, backtestResults.win_rate),
    market_analysis: Math.min(100, 50 + (backtestResults.win_rate - 50)),
  };

  // Store AI learning record
  const { error: learningError } = await supabase
    .from('ai_skill_tracking')
    .upsert({
      user_id: job.user_id,
      skill_category: 'pattern_recognition',
      skill_level: skillMetrics.pattern_recognition,
      proficiency_score: skillMetrics.pattern_recognition,
      trades_analyzed: backtestResults.total_trades,
      learning_source: 'backtest',
    });

  if (learningError) throw learningError;

  return {
    message: 'AI training completed',
    skill_metrics: skillMetrics,
    trades_analyzed: backtestResults.total_trades,
  };
}

// Process data quality check job
async function processDataQuality(supabase: any, job: JobRecord): Promise<any> {
  console.log('🔍 Running data quality check');

  // Check for candle gaps
  const { data: gaps, error: gapError } = await supabase
    .rpc('detect_candle_gaps', { hours_back: 24 });

  if (gapError) throw gapError;

  return {
    gaps_found: gaps?.length || 0,
    timestamp: new Date().toISOString(),
  };
}
