const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function checkAutoBacktestData() {
  console.log('\n=== AUTO-BACKTEST DATA INVESTIGATION ===\n');

  // 1. Check synthetic_backtest_sessions
  console.log('1. Checking synthetic_backtest_sessions...');
  const { data: sessions, error: sessionsError } = await supabase
    .from('synthetic_backtest_sessions')
    .select('id, session_name, status, total_trades, win_rate, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  if (sessionsError) {
    console.error('Error fetching sessions:', sessionsError);
  } else {
    console.log(`Found ${sessions?.length || 0} recent synthetic backtest sessions`);
    sessions?.forEach(s => {
      console.log(`  - ${s.session_name} | Status: ${s.status} | Trades: ${s.total_trades} | WR: ${s.win_rate}% | ${new Date(s.created_at).toLocaleString()}`);
    });
  }

  // 2. Check if these sessions have AI learning data
  console.log('\n2. Checking ai_learning_insights linked to synthetic sessions...');
  const { data: insights, error: insightsError } = await supabase
    .from('ai_learning_insights')
    .select('id, synthetic_session_id, insight_type, symbol, confidence_score, created_at')
    .not('synthetic_session_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10);

  if (insightsError) {
    console.error('Error fetching insights:', insightsError);
  } else {
    console.log(`Found ${insights?.length || 0} insights linked to synthetic sessions`);
    insights?.forEach(i => {
      console.log(`  - Type: ${i.insight_type} | Symbol: ${i.symbol} | Confidence: ${i.confidence_score}% | Session: ${i.synthetic_session_id?.substring(0, 8)}...`);
    });
  }

  // 3. Check ai_trade_analysis
  console.log('\n3. Checking ai_trade_analysis with synthetic trades...');
  const { data: analyses, error: analysesError } = await supabase
    .from('ai_trade_analysis')
    .select('id, synthetic_trade_id, symbol, outcome, pnl, created_at')
    .not('synthetic_trade_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10);

  if (analysesError) {
    console.error('Error fetching analyses:', analysesError);
  } else {
    console.log(`Found ${analyses?.length || 0} trade analyses for synthetic trades`);
    analyses?.forEach(a => {
      console.log(`  - Symbol: ${a.symbol} | Outcome: ${a.outcome} | P&L: ${a.pnl} | ${new Date(a.created_at).toLocaleString()}`);
    });
  }

  // 4. Check ai_performance_evolution
  console.log('\n4. Checking ai_performance_evolution...');
  const { data: evolution, error: evolutionError } = await supabase
    .from('ai_performance_evolution')
    .select('id, measurement_date, strategy_name, total_trades, win_rate, ai_decisions_made')
    .order('measurement_date', { ascending: false })
    .limit(5);

  if (evolutionError) {
    console.error('Error fetching evolution:', evolutionError);
  } else {
    console.log(`Found ${evolution?.length || 0} performance evolution records`);
    evolution?.forEach(e => {
      console.log(`  - Date: ${e.measurement_date} | Strategy: ${e.strategy_name} | Trades: ${e.total_trades} | WR: ${e.win_rate}% | AI Decisions: ${e.ai_decisions_made}`);
    });
  }

  // 5. Check auto_backtest_controller
  console.log('\n5. Checking auto_backtest_controller status...');
  const { data: controller, error: controllerError } = await supabase
    .from('auto_backtest_controller')
    .select('*')
    .maybeSingle();

  if (controllerError) {
    console.error('Error fetching controller:', controllerError);
  } else if (controller) {
    console.log(`Controller Status: ${controller.status}`);
    console.log(`Total Backtests Completed: ${controller.total_backtests_completed}`);
    console.log(`Is Active: ${controller.is_active}`);
  }

  // 6. Check backtest_progress_tracking
  console.log('\n6. Checking backtest_progress_tracking...');
  const { data: progress, error: progressError } = await supabase
    .from('backtest_progress_tracking')
    .select('backtest_id, status, trades_executed, current_win_rate, completed_at')
    .in('status', ['completed', 'failed'])
    .order('completed_at', { ascending: false })
    .limit(10);

  if (progressError) {
    console.error('Error fetching progress:', progressError);
  } else {
    console.log(`Found ${progress?.length || 0} completed/failed backtest progress records`);
    progress?.forEach(p => {
      console.log(`  - Backtest: ${p.backtest_id?.substring(0, 8)}... | Status: ${p.status} | Trades: ${p.trades_executed} | WR: ${p.current_win_rate}%`);
    });
  }

  console.log('\n=== INVESTIGATION COMPLETE ===\n');
}

checkAutoBacktestData().catch(console.error);
