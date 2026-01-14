import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://nzisgxdlydihlwsvonfy.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56aXNneGRseWRpaGx3c3ZvbmZ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTU5NTU0MCwiZXhwIjoyMDc1MTcxNTQwfQ.Bas3dKkvMSzBPAK4zUJ24JC-T0-bcLQeJ458KYv-X5U'
);

console.log('═══════════════════════════════════════════════════════════════════════════');
console.log('  COMPLETE FORENSIC TRADE INVESTIGATION');
console.log('  User: ksweat48@gmail.com');
console.log('  Trade: GBPUSD SELL');
console.log('  Date: January 13, 2025 (~8:56 PM entry, 10:18 PM exit)');
console.log('  Loss: -$297.78');
console.log('  Pattern: multi_symbol_best_opportunity | Conviction: 90% | Rank: Autonomous AI');
console.log('═══════════════════════════════════════════════════════════════════════════\n');

const userId = '91905a02-cf9e-4537-9920-98a4b790830a';

// Search for the trade
const { data: trades } = await supabase
  .from('goal_session_trades')
  .select('*')
  .eq('user_id', userId)
  .eq('symbol', 'GBPUSD')
  .eq('direction', 'sell')
  .gte('opened_at', '2025-01-13 20:00:00')
  .lte('opened_at', '2025-01-14 00:00:00')
  .order('opened_at', { ascending: false});

if (!trades || trades.length === 0) {
  console.log('No exact match found. Searching for GBPUSD sell trades with -$297.78 loss...\n');
  
  const { data: byLoss } = await supabase
    .from('goal_session_trades')
    .select('*')
    .eq('user_id', userId)
    .eq('symbol', 'GBPUSD')
    .eq('direction', 'sell')
    .lt('profit_loss', -295)
    .gt('profit_loss', -300)
    .order('opened_at', { ascending: false});
  
  if (!byLoss || byLoss.length === 0) {
    console.log('No trade found with matching criteria. Listing all GBPUSD trades...\n');
    
    const { data: all } = await supabase
      .from('goal_session_trades')
      .select('*')
      .eq('user_id', userId)
      .eq('symbol', 'GBPUSD')
      .order('opened_at', { ascending: false})
      .limit(10);
    
    if (all && all.length > 0) {
      console.log('Found ' + all.length + ' GBPUSD trades:\n');
      all.forEach((t, i) => {
        console.log((i+1) + '. ' + t.direction.toUpperCase() + ' | Opened: ' + t.opened_at + ' | Closed: ' + (t.closed_at || 'Open') + ' | P&L: $' + (t.profit_loss || 0));
      });
    } else {
      console.log('No GBPUSD trades found for this user.');
    }
    process.exit(0);
  }
  
  trades.push(...byLoss);
}

console.log('✓ Found ' + trades.length + ' matching trade(s)\n');

for (const trade of trades) {
  console.log('\n══════════════════════════════════════════════════════════════════════════');
  console.log('  TRADE DETAILS');
  console.log('══════════════════════════════════════════════════════════════════════════\n');
  
  console.log('🆔 TRADE IDENTIFICATION');
  console.log('  Trade ID:', trade.id);
  console.log('  Session ID:', trade.goal_session_id);
  console.log('');
  
  console.log('📊 EXECUTION DATA');
  console.log('  Symbol:', trade.symbol);
  console.log('  Direction:', trade.direction.toUpperCase());
  console.log('  Entry Price:', trade.entry_price);
  console.log('  Exit Price:', trade.exit_price);
  console.log('  Position Size:', trade.position_size, 'lots');
  console.log('  Opened At:', trade.opened_at);
  console.log('  Closed At:', trade.closed_at);
  console.log('');
  
  console.log('🎯 RISK MANAGEMENT');
  console.log('  Stop Loss:', trade.stop_loss);
  console.log('  Take Profit:', trade.take_profit);
  console.log('  Take Profit 1:', trade.tp1_price || 'N/A');
  console.log('  Take Profit 2:', trade.tp2_price || 'N/A');
  console.log('  Risk Dollars:', trade.risk_dollars);
  console.log('');
  
  console.log('💰 OUTCOME');
  console.log('  Profit/Loss: $' + (trade.profit_loss || 0));
  console.log('  Status:', trade.status);
  console.log('  Close Reason:', trade.close_reason || 'N/A');
  console.log('  Close Reason Detail:', trade.close_reason_detail || 'N/A');
  console.log('  Max Profit:', trade.max_profit || 0);
  console.log('  Max Drawdown:', trade.max_drawdown || 0);
  console.log('  Total Pips:', trade.total_pips || 0);
  console.log('');
  
  console.log('🤖 AI STRATEGY & CONFIDENCE');
  console.log('  AI Strategy:', trade.ai_strategy_used || 'N/A');
  console.log('  AI Confidence:', trade.ai_confidence ? trade.ai_confidence + '%' : 'N/A');
  console.log('  Confidence Score:', trade.confidence_score || 'N/A');
  console.log('  Setup Type:', trade.setup_type || 'N/A');
  console.log('  Entry Mode:', trade.entry_mode || 'N/A');
  console.log('  Regime Bucket:', trade.regime_bucket || 'N/A');
  console.log('');
  
  if (trade.ai_reasoning) {
    console.log('══════════════════════════════════════════════════════════════════════════');
    console.log('  ALPHA AI REASONING (From Trade Record)');
    console.log('══════════════════════════════════════════════════════════════════════════\n');
    console.log(trade.ai_reasoning);
    console.log('');
  }
  
  // Get AI Trade Journal
  const { data: journals } = await supabase
    .from('ai_trade_journal')
    .select('*')
    .eq('trade_id', trade.id);
  
  if (journals && journals.length > 0) {
    const journal = journals[0];
    console.log('══════════════════════════════════════════════════════════════════════════');
    console.log('  AI TRADE JOURNAL');
    console.log('══════════════════════════════════════════════════════════════════════════\n');
    
    console.log('📝 COMPLETE JOURNAL ENTRY:\n');
    console.log(JSON.stringify(journal, null, 2));
    console.log('');
  } else {
    console.log('⚠️  No AI trade journal entry found for this trade\n');
  }
  
  // Get Goal Session
  if (trade.goal_session_id) {
    const { data: sessions } = await supabase
      .from('goal_sessions')
      .select('*')
      .eq('id', trade.goal_session_id);
    
    if (sessions && sessions.length > 0) {
      const session = sessions[0];
      console.log('══════════════════════════════════════════════════════════════════════════');
      console.log('  GOAL SESSION CONTEXT');
      console.log('══════════════════════════════════════════════════════════════════════════\n');
      
      console.log('Session ID:', session.id);
      console.log('Status:', session.status);
      console.log('Target Value: $' + (session.target_value || 0));
      console.log('Current Progress: $' + (session.current_progress || 0));
      console.log('Created:', session.created_at);
      console.log('Updated:', session.updated_at);
      if (session.completed_at) {
        console.log('Completed:', session.completed_at);
      }
      console.log('');
    }
  }
  
  // Get AI Decisions
  const { data: decisions } = await supabase
    .from('ai_trade_decisions')
    .select('*')
    .eq('user_id', userId)
    .eq('symbol', 'GBPUSD')
    .gte('created_at', '2025-01-13 20:00:00')
    .lte('created_at', '2025-01-14 00:00:00')
    .order('created_at', { ascending: false});
  
  if (decisions && decisions.length > 0) {
    console.log('══════════════════════════════════════════════════════════════════════════');
    console.log('  AI DECISION LOGS (Jan 13, 2025)');
    console.log('══════════════════════════════════════════════════════════════════════════\n');
    
    decisions.forEach((d, i) => {
      console.log('Decision #' + (i+1) + ':');
      console.log('  ID:', d.id);
      console.log('  Direction:', d.trade_direction);
      console.log('  Confidence:', d.confidence_score + '%');
      console.log('  Strategy:', d.strategy_used);
      console.log('  Type:', d.decision_type);
      console.log('  Approved:', d.approved);
      console.log('  Executed:', d.executed);
      console.log('  Created:', d.created_at);
      if (d.reasoning) {
        console.log('  Reasoning:', d.reasoning);
      }
      console.log('');
    });
  }
  
  // Get Learning Metrics
  const { data: metrics } = await supabase
    .from('ai_learning_metrics')
    .select('*')
    .eq('trade_id', trade.id);
  
  if (metrics && metrics.length > 0) {
    console.log('══════════════════════════════════════════════════════════════════════════');
    console.log('  POST-TRADE LEARNING METRICS');
    console.log('══════════════════════════════════════════════════════════════════════════\n');
    
    const metric = metrics[0];
    console.log('Strategy Used:', metric.strategy_used);
    console.log('Predicted Confidence:', metric.predicted_confidence + '%');
    console.log('Actual Outcome:', metric.actual_outcome);
    console.log('Predicted P&L: $' + (metric.predicted_pnl || 0));
    console.log('Actual P&L: $' + (metric.actual_pnl || 0));
    console.log('Accuracy Score:', metric.accuracy_score);
    if (metric.lessons_learned) {
      console.log('\nLessons Learned:');
      console.log(metric.lessons_learned);
    }
    console.log('');
  }
}

console.log('═══════════════════════════════════════════════════════════════════════════');
console.log('  INVESTIGATION COMPLETE');
console.log('═══════════════════════════════════════════════════════════════════════════\n');
