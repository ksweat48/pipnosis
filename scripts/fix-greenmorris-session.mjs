#!/usr/bin/env node

/**
 * Recovery Script for greenmorris.83@gmail.com
 * Unsticks the 2 sessions found in awaiting_continuation status
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

const STUCK_SESSIONS = [
  'c8c8ae49-ec68-4cb3-be7d-8dba259e41f7',
  'aa729b92-a717-4cd5-b224-c5b5b5de4e1e'
];

async function unstickSession(sessionId) {
  console.log(`\n🔧 Attempting to unstick session: ${sessionId}`);

  try {
    const { data, error } = await supabase.rpc('unstick_session', {
      p_session_id: sessionId
    });

    if (error) {
      console.error(`   ❌ Error: ${error.message}`);
      return false;
    }

    if (data && data.success) {
      console.log(`   ✅ Success: ${data.message}`);
      console.log(`   📊 Previous status: ${data.previous_status}`);
      console.log(`   📊 New status: ${data.new_status}`);
      console.log(`   📊 Trades: ${data.trades_count}`);
      console.log(`   📊 Final PnL: $${data.final_pnl}`);
      return true;
    } else {
      console.error(`   ❌ Failed: ${data?.error || 'Unknown error'}`);
      return false;
    }
  } catch (err) {
    console.error(`   ❌ Exception: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log('🔧 Starting recovery for greenmorris.83@gmail.com');
  console.log('='.repeat(80));

  let successCount = 0;
  let failCount = 0;

  for (const sessionId of STUCK_SESSIONS) {
    const success = await unstickSession(sessionId);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('📊 RECOVERY SUMMARY:');
  console.log(`   ✅ Successfully unstuck: ${successCount} session(s)`);
  console.log(`   ❌ Failed: ${failCount} session(s)`);
  console.log('='.repeat(80));

  if (successCount > 0) {
    console.log('\n✨ User sessions have been recovered!');
    console.log('   The user can now start new trading sessions.');
  }

  if (failCount > 0) {
    console.log('\n⚠️  Some sessions could not be automatically recovered.');
    console.log('   Manual intervention may be required.');
  }
}

main().catch(console.error);
