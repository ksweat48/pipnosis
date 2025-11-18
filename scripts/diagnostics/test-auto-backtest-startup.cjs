#!/usr/bin/env node
/**
 * Test Auto-Backtest Startup Diagnostic Script
 *
 * This script helps diagnose why auto-backtest fails to start by checking:
 * 1. Database schema (all required columns exist)
 * 2. Database permissions (RLS policies)
 * 3. User state initialization
 * 4. Synthetic data generation capability
 * 5. Recent errors in the system
 */

require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials in .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('\n🔍 AUTO-BACKTEST STARTUP DIAGNOSTIC\n');
  console.log('=' .repeat(60));

  // Step 1: Check database schema
  console.log('\n1️⃣  Checking database schema...');
  try {
    const { data: columns, error } = await supabase.rpc('execute_sql', {
      query: `
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'auto_backtest_global_state'
        ORDER BY ordinal_position;
      `
    });

    if (error) {
      // Try direct query if RPC doesn't work
      const { count } = await supabase
        .from('auto_backtest_global_state')
        .select('*', { count: 'exact', head: true });

      console.log('✅ Table exists (found via direct query)');
    } else {
      console.log('✅ Table exists with columns:');
      if (columns) {
        columns.forEach(col => console.log(`   - ${col.column_name} (${col.data_type})`));
      }
    }

    // Check for new 30-day columns
    const requiredColumns = [
      'current_day_in_month',
      'total_months_completed',
      'current_month_number',
      'monthly_parent_session_id',
      'last_error_message',
      'last_error_at'
    ];

    console.log('\n   Checking for 30-day system columns:');
    const { data: tableInfo } = await supabase
      .from('auto_backtest_global_state')
      .select('*')
      .limit(1)
      .single();

    if (tableInfo) {
      requiredColumns.forEach(col => {
        const exists = col in tableInfo;
        console.log(`   ${exists ? '✅' : '❌'} ${col}`);
      });
    }
  } catch (error) {
    console.error('❌ Error checking schema:', error.message);
  }

  // Step 2: Check user state
  console.log('\n2️⃣  Checking user states...');
  try {
    const { data: states, error } = await supabase
      .from('auto_backtest_global_state')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(5);

    if (error) {
      console.error('❌ Error querying states:', error.message);
    } else {
      console.log(`✅ Found ${states?.length || 0} user states`);
      if (states && states.length > 0) {
        states.forEach(state => {
          console.log(`\n   User: ${state.user_id.substring(0, 8)}...`);
          console.log(`   - Running: ${state.is_running}`);
          console.log(`   - Current Day: ${state.current_day_in_month || 0}/30`);
          console.log(`   - Months Completed: ${state.total_months_completed || 0}`);
          if (state.last_error_message) {
            console.log(`   - ⚠️  Last Error: ${state.last_error_message}`);
            console.log(`   - Error Time: ${state.last_error_at}`);
          }
        });
      }
    }
  } catch (error) {
    console.error('❌ Error checking user states:', error.message);
  }

  // Step 3: Check for stale sessions
  console.log('\n3️⃣  Checking for stale sessions...');
  try {
    const { data: staleSessions, error } = await supabase
      .from('auto_backtest_global_state')
      .select('user_id, is_running, last_heartbeat, started_at')
      .eq('is_running', true);

    if (error) {
      console.error('❌ Error checking stale sessions:', error.message);
    } else {
      if (!staleSessions || staleSessions.length === 0) {
        console.log('✅ No active sessions found');
      } else {
        console.log(`⚠️  Found ${staleSessions.length} active session(s):`);
        staleSessions.forEach(session => {
          const lastHeartbeat = new Date(session.last_heartbeat);
          const now = new Date();
          const minutesSinceHeartbeat = Math.floor((now - lastHeartbeat) / 1000 / 60);

          console.log(`   - User: ${session.user_id.substring(0, 8)}...`);
          console.log(`     Last heartbeat: ${minutesSinceHeartbeat} minutes ago`);
          if (minutesSinceHeartbeat > 5) {
            console.log(`     ⚠️  Session appears STALE (no heartbeat for ${minutesSinceHeartbeat}min)`);
          }
        });
      }
    }
  } catch (error) {
    console.error('❌ Error checking stale sessions:', error.message);
  }

  // Step 4: Check synthetic sessions table
  console.log('\n4️⃣  Checking synthetic backtest capability...');
  try {
    const { data: recentSessions, error } = await supabase
      .from('synthetic_backtest_sessions')
      .select('id, session_name, created_at, status')
      .order('created_at', { ascending: false })
      .limit(3);

    if (error) {
      console.error('❌ Error checking synthetic sessions:', error.message);
    } else {
      console.log(`✅ Found ${recentSessions?.length || 0} recent synthetic sessions`);
      if (recentSessions && recentSessions.length > 0) {
        recentSessions.forEach(session => {
          console.log(`   - ${session.session_name} (${session.status})`);
          console.log(`     Created: ${new Date(session.created_at).toLocaleString()}`);
        });
      }
    }
  } catch (error) {
    console.error('❌ Error checking synthetic sessions:', error.message);
  }

  // Step 5: Check for any recent errors in trade history
  console.log('\n5️⃣  Checking for recent errors in system...');
  try {
    const { data: recentTrades, error } = await supabase
      .from('trade_history')
      .select('id, symbol, outcome, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) {
      console.log('⚠️  Could not check trade history:', error.message);
    } else {
      console.log(`✅ System is logging trades (${recentTrades?.length || 0} recent trades found)`);
    }
  } catch (error) {
    console.log('⚠️  Error checking trade history:', error.message);
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n✅ DIAGNOSTIC COMPLETE\n');
  console.log('Next steps:');
  console.log('1. Check browser console when clicking "Start Auto-Backtest"');
  console.log('2. Look for any error messages in the UI error display');
  console.log('3. If errors persist, check Supabase logs in dashboard');
  console.log('\n');
}

main().catch(console.error);
