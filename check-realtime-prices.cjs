const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function checkRealtimePrices() {
  console.log('Checking realtime_prices table...\n');

  const { data: recentPrices, error: pricesError } = await supabase
    .from('realtime_prices')
    .select('symbol, bid, ask, broker_time, created_at')
    .eq('symbol', 'EURUSD')
    .order('created_at', { ascending: false })
    .limit(10);

  if (pricesError) {
    console.error('Error fetching prices:', pricesError);
    return;
  }

  const count = recentPrices ? recentPrices.length : 0;
  console.log('Found ' + count + ' recent EURUSD prices:');
  if (recentPrices) {
    recentPrices.forEach(function(p, i) {
      const age = Math.floor((Date.now() - new Date(p.created_at).getTime()) / 1000);
      console.log('  ' + (i + 1) + '. ' + p.bid + '/' + p.ask + ' - ' + age + 's ago (created: ' + p.created_at + ')');
    });
  }

  const { data: healthData, error: healthError } = await supabase
    .from('price_polling_health')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('\n\nRecent polling health records:');
  if (healthError) {
    console.error('Error:', healthError);
  } else if (healthData) {
    healthData.forEach(function(h, i) {
      const age = Math.floor((Date.now() - new Date(h.created_at).getTime()) / 1000);
      console.log('  ' + (i + 1) + '. ' + age + 's ago - Success: ' + h.successful_pairs + ', Failed: ' + h.failed_pairs + ', Duration: ' + h.total_duration_ms + 'ms');
      if (h.error_message) {
        console.log('     Error: ' + h.error_message);
      }
    });
  }

  console.log('\n\nTable is accessible:', !!recentPrices);
}

checkRealtimePrices().then(function() { process.exit(0); }).catch(function(err) {
  console.error(err);
  process.exit(1);
});
