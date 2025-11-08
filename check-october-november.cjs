const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  console.log('Checking October 16 - November 7, 2025 (when ALL timeframes have data):\n');
  
  const timeframes = ['H1', 'M30', 'M15', 'M5', 'M1'];
  
  for (const tf of timeframes) {
    const { count } = await supabase
      .from('forex_candles')
      .select('*', { count: 'exact', head: true })
      .eq('symbol', 'EURUSD')
      .eq('timeframe', tf)
      .gte('open_time', '2025-10-16T00:00:00Z')
      .lte('open_time', '2025-11-07T23:59:59Z');
    
    const required = {
      'H1': 100,
      'M30': 200,
      'M15': 300,
      'M5': 500,
      'M1': 500
    };
    
    const status = count >= required[tf] ? '✅' : '❌';
    console.log(status, tf + ':', count, 'candles (need', required[tf] + ')');
  }
}

check();
