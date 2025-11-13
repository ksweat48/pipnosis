const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data } = await supabase
    .from('forex_candles')
    .select('open_time')
    .eq('symbol', 'EURUSD')
    .eq('timeframe', 'H1')
    .order('open_time', { ascending: true });
  
  if (data && data.length > 0) {
    const first = data[0].open_time;
    const last = data[data.length - 1].open_time;
    console.log('EURUSD H1:', data.length, 'candles');
    console.log('  From:', first);
    console.log('  To:', last);
  }
  
  const { data: nov } = await supabase
    .from('forex_candles')
    .select('open_time')
    .eq('symbol', 'EURUSD')
    .eq('timeframe', 'H1')
    .gte('open_time', '2025-11-06T00:00:00Z')
    .lte('open_time', '2025-11-07T23:59:59Z');
  
  console.log('\nNov 6-7, 2025:', nov ? nov.length : 0, 'candles');
}

check();
