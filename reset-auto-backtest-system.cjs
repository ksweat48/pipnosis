#!/usr/bin/env node

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function resetSystem() {
  console.log('\n🔄 RESETTING AUTO-BACKTEST SYSTEM\n');
  console.log('='.repeat(80));

  try {
    // 1. Clear queue
    console.log('\n1. Clearing job queue...');
    const { error: queueError } = await supabase
      .from('auto_backtest_queue')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

    if (queueError) {
      console.error('   ❌ Error:', queueError.message);
    } else {
      console.log('   ✅ Queue cleared');
    }

    // 2. Reset controller
    console.log('\n2. Resetting controller...');
    const { error: controllerError } = await supabase
      .from('auto_backtest_controller')
      .update({
        current_cycle_count: 0,
        consecutive_errors: 0,
        cooldown_active: false,
        cooldown_ends_at: null,
        cooldown_reason: null,
        paused_for_live_trade: false,
        system_stress_score: 0,
        updated_at: new Date().toISOString()
      })
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Update all

    if (controllerError) {
      console.error('   ❌ Error:', controllerError.message);
    } else {
      console.log('   ✅ Controller reset');
    }

    // 3. Clear stuck progress tracking
    console.log('\n3. Clearing stuck progress tracking...');
    const { error: progressError } = await supabase
      .from('backtest_progress_tracking')
      .delete()
      .in('status', ['running', 'initializing']);

    if (progressError) {
      console.error('   ❌ Error:', progressError.message);
    } else {
      console.log('   ✅ Progress tracking cleared');
    }

    // 4. Show current stats
    console.log('\n4. Current system stats:');

    const { data: controller } = await supabase
      .from('auto_backtest_controller')
      .select('*')
      .maybeSingle();

    if (controller) {
      console.log(`   Total backtests: ${controller.total_backtests_completed}`);
      console.log(`   Current cycle: ${controller.current_cycle_count}/100`);
      console.log(`   Status: ${controller.status}`);
      console.log(`   Active: ${controller.is_active}`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('\n✅ SYSTEM RESET COMPLETE');
    console.log('\nNext steps:');
    console.log('1. Go to AI Training page');
    console.log('2. Click "Start Auto-Backtest"');
    console.log('3. Keep the dashboard open');
    console.log('4. Watch backtests run automatically every 10 seconds');
    console.log('\n');

  } catch (error) {
    console.error('\n❌ Error resetting system:', error);
  }
}

resetSystem();
