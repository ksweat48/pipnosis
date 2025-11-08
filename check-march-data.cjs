const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  console.log('Checking March 2025 data for EURUSD:\n');
  
  // Check uppercase
  const uppercase = ['H1', 'M30', 'M15', 'M5', 'M1'];
  console.log('UPPERCASE (what TradingView backfill should have created):');
  for (const tf of uppercase) {
    const { count } = await supabase
      .from('forex_candles')
      .select('*', { count: 'exact', head: true })
      .eq('symbol', 'EURUSD')
      .eq('timeframe', tf)
      .gte('open_time', '2025-03-03T00:00:00Z')
      .lte('open_time', '2025-03-31T23:59:59Z');
    
    console.log('  ' + tf + ':', count || 0, 'candles');
  }
  
  // Check lowercase
  const lowercase = ['1h', '30m', '15m', '5m', '1m'];
  console.log('\nLOWERCASE (what Flow V2 is looking for):');
  for (const tf of lowercase) {
    const { count } = await supabase
      .from('forex_candles')
      .select('*', { count: 'exact', head: true })
      .eq('symbol', 'EURUSD')
      .eq('timeframe', tf)
      .gte('open_time', '2025-03-03T00:00:00Z')
      .lte('open_time', '2025-03-31T23:59:59Z');
    
    console.log('  ' + tf + ':', count || 0, 'candles');
  }
}

check();
