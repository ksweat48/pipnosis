const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  console.log('Checking what timeframe names exist in database:\n');
  
  const { data, error } = await supabase
    .from('forex_candles')
    .select('timeframe')
    .eq('symbol', 'EURUSD');
  
  if (error) {
    console.error('Error:', error.message);
    return;
  }
  
  const uniqueTimeframes = [...new Set(data.map(d => d.timeframe))];
  console.log('Unique timeframe values for EURUSD:');
  uniqueTimeframes.forEach(tf => console.log('  -', tf));
  
  console.log('\nCount by timeframe:');
  for (const tf of uniqueTimeframes) {
    const { count } = await supabase
      .from('forex_candles')
      .select('*', { count: 'exact', head: true })
      .eq('symbol', 'EURUSD')
      .eq('timeframe', tf);
    console.log('  ' + tf + ':', count);
  }
}

check();
