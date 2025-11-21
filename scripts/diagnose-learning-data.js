#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function diagnose() {
  console.log('\n🔍 DIAGNOSING LEARNING CENTER DATA\n');
  console.log('=' .repeat(60));

  // Check all possible data sources
  const tables = [
    'synthetic_sessions',
    'synthetic_trades',
    'ai_learning_insights',
    'ai_trade_analysis',
    'ai_pattern_discoveries',
    'daily_session_results',
    'auto_backtest_global_state',
    'llm_layer_kpis',
    'avoid_pattern_kpis',
    'continuous_learning_kpis',
    'ai_mastery_kpis',
    'strategy_evolution_kpis'
  ];

  console.log('\n📊 TABLE RECORD COUNTS:\n');

  for (const table of tables) {
    try {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });

      if (error) {
        console.log('   ' + table.padEnd(35) + ' ❌ Error: ' + error.message);
      } else {
        const recordCount = count || 0;
        const status = recordCount > 0 ? '✅' : '⚠️';
        console.log('   ' + table.padEnd(35) + ' ' + status + ' ' + recordCount + ' records');
      }
    } catch (err) {
      console.log('   ' + table.padEnd(35) + ' ❌ Exception: ' + err.message);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n📝 DIAGNOSIS:\n');

  const { count: sessionCount } = await supabase
    .from('synthetic_sessions')
    .select('*', { count: 'exact', head: true });

  const { count: tradeCount } = await supabase
    .from('synthetic_trades')
    .select('*', { count: 'exact', head: true });

  const { count: insightCount } = await supabase
    .from('ai_learning_insights')
    .select('*', { count: 'exact', head: true });

  if (sessionCount === 0 && tradeCount === 0) {
    console.log('❌ NO BACKTEST DATA FOUND');
    console.log('\nPossible reasons:');
    console.log('   1. Auto-backtest never actually ran');
    console.log('   2. Running in browser (no database access from browser backtests)');
    console.log('   3. Different environment/database than expected');
    console.log('   4. Data was cleared or never saved');
    console.log('\nSOLUTION:');
    console.log('   → Start a new auto-backtest from the UI');
    console.log('   → Go to "AI Training & Backtesting Lab"');
    console.log('   → Enable "Auto-Backtest Mode"');
    console.log('   → Let it run at least 1 day');
    console.log('   → Data will populate automatically with the fix in place');
  } else if (sessionCount > 0 && insightCount === 0) {
    console.log('⚠️ BACKTESTS RAN BUT NO LEARNING DATA GENERATED');
    console.log('\nYou have ' + sessionCount + ' sessions and ' + tradeCount + ' trades');
    console.log('but 0 learning insights.');
    console.log('\nThis means AI Learning Engine did not analyze the trades.');
    console.log('The fix is in place now - run a new backtest to generate data.');
  } else {
    console.log('✅ DATA EXISTS - READY FOR KPI AGGREGATION');
    console.log('\nYou have:');
    console.log('   • ' + sessionCount + ' backtest sessions');
    console.log('   • ' + tradeCount + ' trades');
    console.log('   • ' + insightCount + ' learning insights');
    console.log('\nRun: node scripts/backfill-learning-center-kpis.js');
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

diagnose().catch(console.error);
