const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  console.log('Checking ALL timeframes in database:\n');
  
  const { data } = await supabase
    .from('forex_candles')
    .select('timeframe, symbol');
  
  const combinations = {};
  
  data.forEach(row => {
    const key = row.symbol + '_' + row.timeframe;
    combinations[key] = (combinations[key] || 0) + 1;
  });
  
  const symbols = [...new Set(data.map(d => d.symbol))].sort();
  const timeframes = [...new Set(data.map(d => d.timeframe))].sort();
  
  console.log('All unique timeframes:', timeframes.join(', '));
  console.log('All symbols:', symbols.join(', '));
  console.log('\nData by symbol/timeframe:');
  
  for (const symbol of symbols) {
    console.log('\n' + symbol + ':');
    for (const tf of timeframes) {
      const key = symbol + '_' + tf;
      const count = combinations[key] || 0;
      if (count > 0) {
        console.log('  ' + tf + ':', count + ' candles');
      }
    }
  }
}

check();
