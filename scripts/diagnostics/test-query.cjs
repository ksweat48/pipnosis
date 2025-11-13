const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
  // Query for 'H1' (what verify script uses)
  const { count: h1Count } = await supabase
    .from('forex_candles')
    .select('*', { count: 'exact', head: true })
    .eq('symbol', 'EURUSD')
    .eq('timeframe', 'H1');
  
  // Query for '1h' (lowercase)
  const { count: oneHCount } = await supabase
    .from('forex_candles')
    .select('*', { count: 'exact', head: true })
    .eq('symbol', 'EURUSD')
    .eq('timeframe', '1h');
  
  console.log('EURUSD H1 (uppercase):', h1Count);
  console.log('EURUSD 1h (lowercase):', oneHCount);
  console.log('Total:', (h1Count || 0) + (oneHCount || 0));
}

test();
