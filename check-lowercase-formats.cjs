const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  console.log('Checking lowercase timeframe formats:\n');
  
  const lowercaseFormats = ['1h', '30m', '15m', '5m', '1m'];
  
  for (const tf of lowercaseFormats) {
    const { data, count } = await supabase
      .from('forex_candles')
      .select('open_time', { count: 'exact' })
      .eq('symbol', 'EURUSD')
      .eq('timeframe', tf);
    
    console.log(tf + ':', count || 0, 'candles');
  }
  
  console.log('\nChecking uppercase formats for comparison:');
  const uppercaseFormats = ['H1', 'M30', 'M15', 'M5', 'M1'];
  
  for (const tf of uppercaseFormats) {
    const { data, count } = await supabase
      .from('forex_candles')
      .select('open_time', { count: 'exact' })
      .eq('symbol', 'EURUSD')
      .eq('timeframe', tf);
    
    console.log(tf + ':', count || 0, 'candles');
  }
}

check();
