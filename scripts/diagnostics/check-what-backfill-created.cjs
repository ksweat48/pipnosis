const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  console.log('What did the TradingView backfill actually create?\n');
  
  const uppercase = ['H1', 'M30', 'M15', 'M5', 'M1', 'H4', 'D1', 'W1'];
  
  for (const tf of uppercase) {
    const { count } = await supabase
      .from('forex_candles')
      .select('*', { count: 'exact', head: true })
      .eq('symbol', 'EURUSD')
      .eq('timeframe', tf);
    
    if (count && count > 0) {
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
      
      const earliest = data[0].open_time.split('T')[0];
      const latestDate = latest[0].open_time.split('T')[0];
      
      console.log(tf + ':', count, 'candles from', earliest, 'to', latestDate);
    } else {
      console.log(tf + ': 0 candles - NEVER CREATED');
    }
  }
}

check();
