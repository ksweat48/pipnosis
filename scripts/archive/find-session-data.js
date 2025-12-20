#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function findSessions() {
  console.log('\n🔍 FINDING SESSION DATA\n');
  console.log('=' .repeat(60));

  // Try all possible session tables
  const tables = [
    'synthetic_backtest_sessions',
    'synthetic_sessions',
    'backtest_sessions',
    'daily_session_results',
    'trade_sessions',
    'auto_backtest_sessions'
  ];

  for (const table of tables) {
    try {
      const { data, count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact' })
        .limit(5);

      if (error) {
        console.log('\n❌ ' + table + ': Error - ' + error.message);
      } else {
        console.log('\n✅ ' + table + ': ' + (count || 0) + ' records');
        if (data && data.length > 0) {
          console.log('\n   Sample record:');
          console.log('   ' + JSON.stringify(data[0], null, 2).replace(/\n/g, '\n   '));
        }
      }
    } catch (err) {
      console.log('\n⚠️  ' + table + ': Table may not exist');
    }
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

findSessions().catch(console.error);
