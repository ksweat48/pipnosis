const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  console.log('Finding EARLIEST data for each timeframe:\n');
  
  const formats = [
    { name: 'H1', format: 'H1' },
    { name: 'M5', format: 'M5' },
    { name: 'M1', format: 'M1' },
    { name: '1h', format: '1h' },
    { name: '5m', format: '5m' },
    { name: '1m', format: '1m' }
  ];
  
  for (const fmt of formats) {
    const { data } = await supabase
      .from('forex_candles')
      .select('open_time')
      .eq('symbol', 'EURUSD')
      .eq('timeframe', fmt.format)
      .order('open_time', { ascending: true })
      .limit(1);
    
    if (data && data.length > 0) {
      console.log(fmt.name + ' earliest:', data[0].open_time);
    } else {
      console.log(fmt.name + ': NO DATA');
    }
  }
  
  console.log('\nBacktest start date: 2025-10-16T00:00:00.000Z');
  console.log('\nConclusion:');
  console.log('- H1 data starts in Feb 2025, so there IS data before Oct 16');
  console.log('- M5 data starts in Oct 16, so there is NO data before Oct 16');
  console.log('- M1 data starts in Nov 5, so there is NO data before Oct 16');
  console.log('\nThis is why Flow V2 cannot find M5/M1 candles at the backtest start!');
}

check();
