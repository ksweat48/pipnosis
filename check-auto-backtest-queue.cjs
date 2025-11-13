const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function checkQueue() {
  console.log('\n=== AUTO-BACKTEST QUEUE STATUS ===\n');

  // Check queue
  const { data: queue, error: queueError } = await supabase
    .from('auto_backtest_queue')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  if (queueError) {
    console.error('Error fetching queue:', queueError);
  } else {
    console.log(`Total queue items: ${queue ? queue.length : 0}`);
    if (queue && queue.length > 0) {
      const pending = queue.filter(j => j.status === 'pending').length;
      const processing = queue.filter(j => j.status === 'processing').length;
      const completed = queue.filter(j => j.status === 'completed').length;
      const failed = queue.filter(j => j.status === 'failed').length;
      
      console.log(`  Pending: ${pending}`);
      console.log(`  Processing: ${processing}`);
      console.log(`  Completed: ${completed}`);
      console.log(`  Failed: ${failed}`);
      
      console.log('\nRecent queue items:');
      queue.slice(0, 10).forEach(j => {
        console.log(`  - ${j.status.toUpperCase()} | Symbol: ${j.symbol} | ${j.start_date} to ${j.end_date} | Created: ${new Date(j.created_at).toLocaleString()}`);
      });
    }
  }

  // Check controller
  const { data: controller } = await supabase
    .from('auto_backtest_controller')
    .select('*')
    .maybeSingle();

  if (controller) {
    console.log('\n=== CONTROLLER STATUS ===');
    console.log(`Status: ${controller.status}`);
    console.log(`Is Active: ${controller.is_active}`);
    console.log(`Total Backtests Completed: ${controller.total_backtests_completed}`);
    console.log(`Current Cycle: ${controller.current_cycle_count} / ${controller.max_consecutive_runs}`);
  }

  console.log('\n=== COMPLETE ===\n');
}

checkQueue().catch(console.error);
