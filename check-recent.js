import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { data } = await supabase
  .from('forex_candles')
  .select('*')
  .gte('open_time', new Date(Date.now() - 120 * 60 * 1000).toISOString())
  .order('open_time', { ascending: false })
  .limit(15);

console.log('\nRecent candles (last 2 hours):\n');
let complete = 0, incomplete = 0;
for (const c of data || []) {
  if (c.high !== c.low) {
    complete++;
    console.log('✅', c.symbol, c.timeframe, 'at', c.open_time.substring(11, 19));
  } else {
    incomplete++;
    console.log('❌', c.symbol, c.timeframe, 'at', c.open_time.substring(11, 19), '(no wicks)');
  }
}
console.log('\n📊 Complete:', complete, '| Incomplete:', incomplete);
if (complete + incomplete > 0) {
  console.log('Success rate:', ((complete / (complete + incomplete)) * 100).toFixed(1) + '%');
}
