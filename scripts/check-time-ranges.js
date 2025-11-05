import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkRanges() {
  const symbols = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];
  const timeframes = ['M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

  console.log('Time ranges for each symbol/timeframe:\n');

  for (const symbol of symbols) {
    console.log(`${symbol}:`);
    for (const timeframe of timeframes) {
      const { data } = await supabase
        .from('forex_candles')
        .select('open_time')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .order('open_time', { ascending: true })
        .limit(1);

      const { data: latest } = await supabase
        .from('forex_candles')
        .select('open_time')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .order('open_time', { ascending: false })
        .limit(1);

      const { count } = await supabase
        .from('forex_candles')
        .select('*', { count: 'exact', head: true })
        .eq('symbol', symbol)
        .eq('timeframe', timeframe);

      const oldest = data && data[0] ? new Date(data[0].open_time).toISOString().slice(0, 19) : 'N/A';
      const newest = latest && latest[0] ? new Date(latest[0].open_time).toISOString().slice(0, 19) : 'N/A';

      console.log(`  ${timeframe.padEnd(5)} - Count: ${String(count || 0).padStart(3)} | ${oldest} to ${newest}`);
    }
    console.log('');
  }
}

checkRanges();
