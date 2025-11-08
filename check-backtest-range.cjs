const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const startDate = '2025-10-16T00:00:00.000Z';
  const endDate = '2025-11-07T00:00:00.000Z';
  
  console.log('Checking data for backtest range:');
  console.log('Start:', startDate);
  console.log('End:', endDate);
  console.log('\nUsing UPPERCASE formats (H1, M5, M1):\n');
  
  const uppercaseFormats = ['H1', 'M5', 'M1'];
  
  for (const tf of uppercaseFormats) {
    const { data, count } = await supabase
      .from('forex_candles')
      .select('open_time', { count: 'exact' })
      .eq('symbol', 'EURUSD')
      .eq('timeframe', tf)
      .gte('open_time', startDate)
      .lte('open_time', endDate);
    
    console.log(tf + ':', count || 0, 'candles');
    if (data && data.length > 0) {
      console.log('  First:', data[0].open_time);
      console.log('  Last:', data[data.length - 1].open_time);
    }
  }
  
  console.log('\nUsing LOWERCASE formats (1h, 5m, 1m):\n');
  const lowercaseFormats = ['1h', '5m', '1m'];
  
  for (const tf of lowercaseFormats) {
    const { data, count } = await supabase
      .from('forex_candles')
      .select('open_time', { count: 'exact' })
      .eq('symbol', 'EURUSD')
      .eq('timeframe', tf)
      .gte('open_time', startDate)
      .lte('open_time', endDate);
    
    console.log(tf + ':', count || 0, 'candles');
    if (data && data.length > 0) {
      console.log('  First:', data[0].open_time);
      console.log('  Last:', data[data.length - 1].open_time);
    }
  }
  
  console.log('\nTesting specific query at 2025-10-16T00:00:00.000Z:');
  const testTime = '2025-10-16T00:00:00.000Z';
  
  for (const tf of uppercaseFormats) {
    const { data, count } = await supabase
      .from('forex_candles')
      .select('open_time', { count: 'exact' })
      .eq('symbol', 'EURUSD')
      .eq('timeframe', tf)
      .lte('open_time', testTime)
      .order('open_time', { ascending: false })
      .limit(100);
    
    console.log(tf + ' (before ' + testTime + '):', count || 0, 'candles');
  }
}

check();
