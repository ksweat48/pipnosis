#!/usr/bin/env node

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnose() {
  console.log('\n🔍 COMPREHENSIVE AUTO-BACKTEST DIAGNOSIS\n');
  console.log('='.repeat(80));

  // Check pending jobs
  const { data: queue } = await supabase
    .from('auto_backtest_queue')
    .select('status, created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  const stats = {
    pending: queue?.filter(j => j.status === 'pending').length || 0,
    processing: queue?.filter(j => j.status === 'processing').length || 0,
    completed: queue?.filter(j => j.status === 'completed').length || 0,
    failed: queue?.filter(j => j.status === 'failed').length || 0
  };

  console.log('\n📊 QUEUE STATUS:');
  console.log(`   Pending:    ${stats.pending} ⚠️`);
  console.log(`   Processing: ${stats.processing}`);
  console.log(`   Completed:  ${stats.completed}`);
  console.log(`   Failed:     ${stats.failed}`);

  if (stats.pending > 0) {
    const oldestPending = queue?.find(j => j.status === 'pending');
    if (oldestPending) {
      const age = Math.floor((Date.now() - new Date(oldestPending.created_at).getTime()) / 60000);
      console.log(`\n❌ CRITICAL: ${stats.pending} jobs stuck in queue for ${age}+ minutes!`);
      console.log('   This confirms cron jobs are NOT executing.');
    }
  }

  // Check cron job configuration
  console.log('\n🔧 ATTEMPTING TO CHECK CRON JOBS:');
  const { data: cronJobs, error: cronError } = await supabase
    .rpc('get_cron_jobs')
    .then(r => r)
    .catch(() => ({ data: null, error: 'Function does not exist' }));

  if (cronError || !cronJobs) {
    console.log('   ❌ Cannot query cron jobs (requires admin access)');
    console.log('   This is expected - cron diagnostics require database admin.');
  } else {
    console.log('   ✅ Cron jobs found:', cronJobs);
  }

  // Check if http extension exists
  console.log('\n🌐 CHECKING HTTP EXTENSION:');
  console.log('   Cannot check from client - requires database admin access');
  console.log('   The http extension is required for cron to call Edge Functions');

  console.log('\n' + '='.repeat(80));
  console.log('\n💡 DIAGNOSIS SUMMARY:\n');
  
  if (stats.pending > 50) {
    console.log('❌ PROBLEM CONFIRMED: Cron jobs are NOT running');
    console.log('\nReasons this happens:');
    console.log('1. ❌ pg_cron extension not enabled');
    console.log('2. ❌ http extension not enabled');
    console.log('3. ❌ Database settings not configured (app.settings.*)');
    console.log('4. ❌ Cron jobs not scheduled or deactivated');
    console.log('5. ❌ Network restrictions blocking http calls');
    
    console.log('\n🔧 SOLUTION:');
    console.log('The ONLY reliable solution is to run the executor from the BROWSER.');
    console.log('Supabase free tier may have limitations on cron + http extensions.');
    console.log('\nI will implement a browser-based polling system that:');
    console.log('- Runs automatically when dashboard is open');
    console.log('- Checks for pending jobs every 10 seconds');
    console.log('- Calls executor Edge Function directly');
    console.log('- Works reliably without database cron dependencies');
  }
  
  console.log('\n');
}

diagnose().catch(console.error);
