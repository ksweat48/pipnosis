#!/usr/bin/env node

/**
 * Diagnostic Script for greenmorris.83@gmail.com
 * Checks for stuck sessions and provides recovery options
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

const USER_EMAIL = 'greenmorris.83@gmail.com';

async function main() {
  console.log('🔍 Diagnosing sessions for:', USER_EMAIL);
  console.log('='.repeat(80));

  // Step 1: Get user ID
  const { data: users, error: userError } = await supabase
    .from('user_profiles')
    .select('id, email, created_at, account_balance')
    .eq('email', USER_EMAIL)
    .maybeSingle();

  if (userError || !users) {
    console.error('❌ User not found:', userError?.message || 'No user found');
    process.exit(1);
  }

  const userId = users.id;
  console.log(`✅ Found user: ${users.email}`);
  console.log(`   User ID: ${userId}`);
  console.log(`   Balance: $${users.account_balance}`);
  console.log(`   Created: ${users.created_at}`);
  console.log('');

  // Step 2: Check for active/stuck sessions
  const { data: sessions, error: sessionError } = await supabase
    .from('goal_sessions')
    .select(`
      id,
      status,
      created_at,
      updated_at,
      awaiting_continuation_confirmation,
      continuation_confirmation_expires_at,
      target_value,
      completed_at
    `)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(10);

  if (sessionError) {
    console.error('❌ Error fetching sessions:', sessionError.message);
    process.exit(1);
  }

  console.log(`📊 Found ${sessions?.length || 0} recent sessions:`);
  console.log('');

  let stuckSessions = [];

  for (const session of sessions || []) {
    const minutesStuck = ((Date.now() - new Date(session.updated_at).getTime()) / 1000 / 60).toFixed(1);
    const isStuck = ['awaiting_continuation', 'scanning', 'trade_pending'].includes(session.status) && minutesStuck > 5;

    console.log(`📋 Session ${session.id}`);
    console.log(`   Status: ${session.status} ${isStuck ? '⚠️ STUCK' : ''}`);
    console.log(`   Created: ${session.created_at}`);
    console.log(`   Updated: ${session.updated_at} (${minutesStuck} minutes ago)`);
    console.log(`   Target: $${session.target_value}`);
    console.log(`   Awaiting Continuation: ${session.awaiting_continuation_confirmation}`);
    if (session.continuation_confirmation_expires_at) {
      console.log(`   Continuation Expires: ${session.continuation_confirmation_expires_at}`);
    }

    if (isStuck) {
      stuckSessions.push(session);
    }

    // Get trades for this session
    const { data: trades } = await supabase
      .from('goal_session_trades')
      .select('id, status, symbol, direction, profit_loss')
      .eq('goal_session_id', session.id);

    const openTrades = trades?.filter(t => t.status === 'open') || [];
    const closedTrades = trades?.filter(t => t.status === 'closed') || [];

    console.log(`   Trades: ${trades?.length || 0} total, ${openTrades.length} open, ${closedTrades.length} closed`);

    if (openTrades.length > 0) {
      console.log(`   ⚠️ OPEN TRADES:`);
      openTrades.forEach(t => console.log(`      - ${t.symbol} ${t.direction} (${t.id})`));
    }

    console.log('');
  }

  // Step 3: Check for stuck entry intents
  const { data: entryIntents, error: intentError } = await supabase
    .from('entry_intents')
    .select('id, session_id, status, outcome_status, abandonment_reason, symbol, direction, created_at')
    .eq('user_id', userId)
    .eq('status', 'timeout')
    .is('outcome_status', null)
    .order('created_at', { ascending: false });

  if (!intentError && entryIntents && entryIntents.length > 0) {
    console.log(`⚠️ Found ${entryIntents.length} stuck entry intents:`);
    console.log('');

    for (const intent of entryIntents) {
      const minutesOld = ((Date.now() - new Date(intent.created_at).getTime()) / 1000 / 60).toFixed(1);
      console.log(`   📌 Intent ${intent.id}`);
      console.log(`      Symbol: ${intent.symbol} ${intent.direction}`);
      console.log(`      Status: ${intent.status}`);
      console.log(`      Created: ${intent.created_at} (${minutesOld} minutes ago)`);
      console.log('');
    }
  }

  // Step 4: Check for pending modals
  const { data: modals, error: modalError } = await supabase
    .from('pending_user_modals')
    .select('id, goal_session_id, modal_type, created_at')
    .eq('user_id', userId)
    .is('dismissed_at', null)
    .order('created_at', { ascending: false });

  if (!modalError && modals && modals.length > 0) {
    console.log(`⚠️ Found ${modals.length} pending modals:`);
    console.log('');

    for (const modal of modals) {
      const minutesOld = ((Date.now() - new Date(modal.created_at).getTime()) / 1000 / 60).toFixed(1);
      console.log(`   🔔 Modal ${modal.id}`);
      console.log(`      Type: ${modal.modal_type}`);
      console.log(`      Session: ${modal.goal_session_id}`);
      console.log(`      Created: ${modal.created_at} (${minutesOld} minutes ago)`);
      console.log('');
    }
  }

  // Summary and recommendations
  console.log('='.repeat(80));
  console.log('📊 SUMMARY:');
  console.log('');

  if (stuckSessions.length > 0) {
    console.log(`⚠️  ${stuckSessions.length} STUCK SESSION(S) FOUND`);
    console.log('');
    console.log('🔧 RECOMMENDED ACTIONS:');
    console.log('');

    for (const session of stuckSessions) {
      console.log(`Session ${session.id}:`);

      // Check if it has open trades
      const { data: trades } = await supabase
        .from('goal_session_trades')
        .select('id, status')
        .eq('goal_session_id', session.id)
        .eq('status', 'open');

      if (trades && trades.length > 0) {
        console.log(`   ⛔ Has ${trades.length} open trade(s) - must close trades first`);
        console.log(`   SQL: -- First close trades manually, then run unstick`);
      } else {
        console.log(`   ✅ No open trades - safe to unstick`);
        console.log(`   SQL: SELECT unstick_session('${session.id}');`);
      }
      console.log('');
    }
  } else {
    console.log('✅ No stuck sessions found');
  }

  if (entryIntents && entryIntents.length > 0) {
    console.log(`⚠️  ${entryIntents.length} STUCK ENTRY INTENT(S)`);
    console.log(`   SQL: UPDATE entry_intents SET status = 'canceled', canceled_at = NOW(), canceled_reason = 'admin_recovery', outcome_status = 'EXPIRED', abandonment_reason = 'TIMEOUT' WHERE user_id = '${userId}' AND status = 'timeout' AND outcome_status IS NULL;`);
    console.log('');
  }

  if (modals && modals.length > 0) {
    console.log(`⚠️  ${modals.length} PENDING MODAL(S)`);
    console.log(`   SQL: UPDATE pending_user_modals SET dismissed_at = NOW(), user_action = 'admin_recovery' WHERE user_id = '${userId}' AND dismissed_at IS NULL;`);
    console.log('');
  }

  console.log('='.repeat(80));
}

main().catch(console.error);
