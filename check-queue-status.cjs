#!/usr/bin/env node

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkQueueStatus() {
  console.log('\n🔍 AUTO-BACKTEST QUEUE STATUS CHECK\n');
  console.log('='.repeat(80));

  // Check queue statistics
  const { data: queueJobs, error: queueError } = await supabase
    .from('auto_backtest_queue')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  if (queueError) {
    console.error('❌ Error fetching queue:', queueError);
    return;
  }

  const pending = queueJobs.filter(j => j.status === 'pending');
  const processing = queueJobs.filter(j => j.status === 'processing');
  const completed = queueJobs.filter(j => j.status === 'completed');
  const failed = queueJobs.filter(j => j.status === 'failed');

  console.log('\n📊 QUEUE STATISTICS:');
  console.log(`   Pending:    ${pending.length}`);
  console.log(`   Processing: ${processing.length}`);
  console.log(`   Completed:  ${completed.length}`);
  console.log(`   Failed:     ${failed.length}`);
  console.log(`   Total:      ${queueJobs.length}`);

  if (pending.length > 0) {
    console.log('\n⚠️  PENDING JOBS DETECTED:');
    pending.slice(0, 5).forEach((job, i) => {
      console.log(`   ${i + 1}. ${job.session_name}`);
      console.log(`      Created: ${new Date(job.created_at).toLocaleString()}`);
      console.log(`      Risk: ${job.risk_level}, Symbols: ${job.symbols?.join(', ')}`);
    });
    console.log('\n❌ PROBLEM: Jobs are queued but not being executed!');
    console.log('   The auto-backtest-executor Edge Function is not processing them.');
  }

  if (processing.length > 0) {
    console.log('\n🔄 JOBS CURRENTLY PROCESSING:');
    processing.forEach((job, i) => {
      console.log(`   ${i + 1}. ${job.session_name}`);
      console.log(`      Started: ${new Date(job.started_at).toLocaleString()}`);
    });
  }

  // Check active controllers
  const { data: controllers } = await supabase
    .from('auto_backtest_controller')
    .select('*')
    .eq('is_active', true);

  console.log('\n🎮 ACTIVE CONTROLLERS:');
  if (controllers && controllers.length > 0) {
    controllers.forEach(c => {
      console.log(`   User: ${c.user_id}`);
      console.log(`   Status: ${c.status}`);
      console.log(`   Cycle: ${c.current_cycle_count}/100`);
      console.log(`   Total Backtests: ${c.total_backtests_completed}`);
      console.log(`   Cooldown: ${c.cooldown_active ? 'Yes' : 'No'}`);
    });
  } else {
    console.log('   None active');
  }

  // Check progress tracking
  const { data: progress } = await supabase
    .from('backtest_progress_tracking')
    .select('*')
    .eq('status', 'running')
    .limit(5);

  console.log('\n📈 ACTIVE PROGRESS TRACKING:');
  if (progress && progress.length > 0) {
    progress.forEach(p => {
      console.log(`   Backtest: ${p.backtest_id}`);
      console.log(`   Phase: ${p.phase}, Progress: ${p.progress_percentage}%`);
      console.log(`   Step: ${p.current_step}`);
    });
  } else {
    console.log('   No active backtests in progress');
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n💡 DIAGNOSIS:');
  if (pending.length > 0) {
    console.log('   ❌ Jobs are being CREATED but NOT EXECUTED');
    console.log('   ❌ The auto-backtest-executor needs to be triggered');
    console.log('\n🔧 SOLUTION:');
    console.log('   The browser job monitor should call the executor Edge Function.');
    console.log('   Check browser console for job monitor logs.');
  } else if (completed.length > 0) {
    console.log('   ✅ System appears to be working');
    console.log('   Recent jobs have been completed successfully');
  } else {
    console.log('   ⚠️  No jobs in queue - runner may not be creating them');
  }
  console.log('\n');
}

checkQueueStatus().catch(console.error);
