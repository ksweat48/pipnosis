const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function checkConfig() {
  console.log('Checking Supabase configuration...\n');
  console.log('URL:', process.env.VITE_SUPABASE_URL);
  console.log('Anon Key present:', !!process.env.VITE_SUPABASE_ANON_KEY);
  
  const { data: cronJobs, error: cronError } = await supabase
    .rpc('cron.job', {});

  console.log('\nTrying to check cron jobs...');
  if (cronError) {
    console.log('Cannot access cron jobs (expected):', cronError.message);
  }

  const { count, error: countError } = await supabase
    .from('realtime_prices')
    .select('*', { count: 'exact', head: true });

  console.log('\nTotal records in realtime_prices:', count);

  const { data: allSymbols, error: symError } = await supabase
    .from('realtime_prices')
    .select('symbol')
    .order('created_at', { ascending: false })
    .limit(100);

  if (allSymbols && allSymbols.length > 0) {
    const symbolCounts = {};
    allSymbols.forEach(function(s) {
      symbolCounts[s.symbol] = (symbolCounts[s.symbol] || 0) + 1;
    });
    console.log('\nSymbol distribution in last 100 records:');
    Object.keys(symbolCounts).forEach(function(sym) {
      console.log('  ' + sym + ': ' + symbolCounts[sym]);
    });
  }
}

checkConfig().then(function() { process.exit(0); }).catch(function(err) {
  console.error(err);
  process.exit(1);
});
