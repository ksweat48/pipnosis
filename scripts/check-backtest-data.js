#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function checkData() {
  console.log('\n🔍 Checking Backtest Data Sources...\n');

  // Check synthetic_sessions
  const { data: sessions } = await supabase
    .from('synthetic_sessions')
    .select('id, user_id, session_name, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  console.log('📊 synthetic_sessions: ' + (sessions ? sessions.length : 0) + ' records');
  if (sessions && sessions.length > 0) {
    console.log('   Latest: ' + sessions[0].session_name);
    console.log('   User ID: ' + sessions[0].user_id);
    console.log('   Date: ' + sessions[0].created_at);
  }

  // Check synthetic_trades
  const { data: trades } = await supabase
    .from('synthetic_trades')
    .select('id, user_id, symbol, outcome')
    .order('opened_at', { ascending: false })
    .limit(5);

  console.log('\n📈 synthetic_trades: ' + (trades ? trades.length : 0) + ' records');

  // Check ai_learning_insights
  const { data: insights } = await supabase
    .from('ai_learning_insights')
    .select('id, user_id, insight_title')
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('\n🧠 ai_learning_insights: ' + (insights ? insights.length : 0) + ' records');

  // Check daily_session_results
  const { data: dailyResults } = await supabase
    .from('daily_session_results')
    .select('*')
    .order('session_date', { ascending: false })
    .limit(5);

  console.log('\n📅 daily_session_results: ' + (dailyResults ? dailyResults.length : 0) + ' records');

  // Check auto_backtest_global_state
  const { data: autoState } = await supabase
    .from('auto_backtest_global_state')
    .select('*')
    .limit(1)
    .maybeSingle();

  console.log('\n🤖 auto_backtest_global_state:');
  if (autoState) {
    console.log('   User ID: ' + autoState.user_id);
    console.log('   Total months: ' + autoState.total_months_completed);
    console.log('   Current day: ' + autoState.current_day_in_month + '/30');
    console.log('   Last day: ' + (autoState.last_day_session_name || 'N/A'));
  } else {
    console.log('   No data');
  }

  console.log('\n');
}

checkData().catch(console.error);
