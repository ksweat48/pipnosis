#!/usr/bin/env node

/**
 * Admin Recovery Script for greenmorris.83@gmail.com
 * Uses direct SQL to unstick sessions (bypasses RLS)
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const USER_ID = 'e6f3399f-deff-43af-b0fc-6ad8ad5ccb88';
const STUCK_SESSIONS = [
  'c8c8ae49-ec68-4cb3-be7d-8dba259e41f7',
  'aa729b92-a717-4cd5-b224-c5b5b5de4e1e'
];

async function unstickSessionManual(sessionId) {
  console.log(`\n🔧 Manually unsticking session: ${sessionId}`);

  try {
    // Step 1: Get session info
    const { data: session, error: sessionError } = await supabase
      .from('goal_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      console.error(`   ❌ Session not found: ${sessionError?.message}`);
      return false;
    }

    console.log(`   📋 Current status: ${session.status}`);
    console.log(`   📋 Target: $${session.target_value}`);

    // Step 2: Check for open trades
    const { data: openTrades, error: tradesError } = await supabase
      .from('goal_session_trades')
      .select('id')
      .eq('goal_session_id', sessionId)
      .eq('status', 'open');

    if (tradesError) {
      console.error(`   ❌ Error checking trades: ${tradesError.message}`);
      return false;
    }

    if (openTrades && openTrades.length > 0) {
      console.error(`   ⛔ Cannot unstick: ${openTrades.length} open trade(s) exist`);
      return false;
    }

    console.log(`   ✅ No open trades`);

    // Step 3: Calculate PnL from trades
    const { data: trades, error: pnlError } = await supabase
      .from('goal_session_trades')
      .select('profit_loss, status')
      .eq('goal_session_id', sessionId);

    const closedTrades = trades?.filter(t => t.status === 'closed') || [];
    const totalPnL = closedTrades.reduce((sum, t) => sum + (t.profit_loss || 0), 0);

    console.log(`   📊 Closed trades: ${closedTrades.length}`);
    console.log(`   📊 Total PnL: $${totalPnL.toFixed(2)}`);

    // Step 4: Update session to user_stopped
    const { error: updateError } = await supabase
      .from('goal_sessions')
      .update({
        status: 'user_stopped',
        awaiting_continuation_confirmation: false,
        continuation_confirmation_expires_at: null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId);

    if (updateError) {
      console.error(`   ❌ Failed to update session: ${updateError.message}`);
      return false;
    }

    console.log(`   ✅ Session updated to user_stopped`);

    // Step 5: Dismiss pending modals
    const { error: modalError } = await supabase
      .from('pending_user_modals')
      .update({
        dismissed_at: new Date().toISOString(),
        user_action: 'admin_recovery'
      })
      .eq('goal_session_id', sessionId)
      .is('dismissed_at', null);

    if (modalError) {
      console.warn(`   ⚠️  Warning: Could not dismiss modals: ${modalError.message}`);
    } else {
      console.log(`   ✅ Pending modals dismissed`);
    }

    // Step 6: Create notification for user
    const { error: notifError } = await supabase
      .from('goal_notifications')
      .insert({
        goal_session_id: sessionId,
        user_id: USER_ID,
        type: 'session_ended',
        priority: 'medium',
        title: '🔧 Session Recovered',
        message: `Your stuck session was recovered by admin. ${closedTrades.length} trade${closedTrades.length !== 1 ? 's' : ''} completed. Final: $${totalPnL.toFixed(2)}`,
        metadata: {
          close_reason: 'admin_recovery',
          previous_status: session.status,
          trades_in_session: closedTrades.length,
          final_pnl: totalPnL,
          target_value: session.target_value,
          recovered_at: new Date().toISOString()
        },
        channels: ['in_app']
      });

    if (notifError) {
      console.warn(`   ⚠️  Warning: Could not create notification: ${notifError.message}`);
    } else {
      console.log(`   ✅ Recovery notification created`);
    }

    console.log(`   ✨ Session successfully recovered!`);
    return true;

  } catch (err) {
    console.error(`   ❌ Exception: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log('🔧 Admin Recovery for greenmorris.83@gmail.com');
  console.log('='.repeat(80));

  let successCount = 0;
  let failCount = 0;

  for (const sessionId of STUCK_SESSIONS) {
    const success = await unstickSessionManual(sessionId);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('📊 RECOVERY SUMMARY:');
  console.log(`   ✅ Successfully recovered: ${successCount} session(s)`);
  console.log(`   ❌ Failed: ${failCount} session(s)`);
  console.log('='.repeat(80));

  if (successCount > 0) {
    console.log('\n✨ User account has been refreshed!');
    console.log('   The user can now start new trading sessions.');
  }

  if (failCount > 0) {
    console.log('\n⚠️  Some sessions could not be recovered.');
    console.log('   Please check the errors above.');
  }
}

main().catch(console.error);
