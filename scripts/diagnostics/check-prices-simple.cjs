const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function checkPrices() {
  console.log('\nChecking realtime_prices table...\n');
  
  const { data, error, count } = await supabase
    .from('realtime_prices')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('Total rows:', count);
  
  if (error) {
    console.log('Error:', error);
  } else if (!data || data.length === 0) {
    console.log('❌ Table is empty');
  } else {
    console.log('✅ Found data:');
    data.forEach((row, i) => {
      console.log(`  ${i + 1}. ${row.symbol}: ${row.bid}/${row.ask} at ${row.created_at}`);
    });
  }
}

checkPrices().catch(console.error);
