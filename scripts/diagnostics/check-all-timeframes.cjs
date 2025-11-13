const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  console.log('Checking all timeframes for EURUSD in November 2025:\n');
  
  const timeframes = ['H1', 'M30', 'M15', 'M5', 'M1'];
  
  for (const tf of timeframes) {
    const { data } = await supabase
      .from('forex_candles')
      .select('open_time', { count: 'exact' })
      .eq('symbol', 'EURUSD')
      .eq('timeframe', tf)
      .gte('open_time', '2025-11-06T00:00:00Z')
      .lte('open_time', '2025-11-07T23:59:59Z');
    
    console.log(tf + ':', data ? data.length : 0, 'candles');
  }
  
  console.log('\nChecking what data we actually have:');
  for (const tf of timeframes) {
    const { data } = await supabase
      .from('forex_candles')
      .select('open_time')
      .eq('symbol', 'EURUSD')
      .eq('timeframe', tf)
      .order('open_time', { ascending: true })
      .limit(1);
    
    const { data: latest } = await supabase
      .from('forex_candles')
      .select('open_time')
      .eq('symbol', 'EURUSD')
      .eq('timeframe', tf)
      .order('open_time', { ascending: false })
      .limit(1);
    
    if (data && data.length > 0 && latest && latest.length > 0) {
      console.log(tf + ':', data[0].open_time, 'to', latest[0].open_time);
    }
  }
}

check();
