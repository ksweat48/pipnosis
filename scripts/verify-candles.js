#!/usr/bin/env node

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

async function verify() {
  console.log('🔍 Verifying Candle Data\n');

  // Get total count
  const { count: totalCount, error: countError } = await supabase
    .from('forex_candles')
    .select('*', { count: 'exact', head: true });

  if (countError) {
    console.error('Error getting total count:', countError.message);
    return;
  }

  console.log(`Total candles in database: ${totalCount}\n`);

  // Get counts directly per symbol/timeframe using group by
  const symbols = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];
  const timeframes = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

  const counts = {};

  for (const symbol of symbols) {
    for (const timeframe of timeframes) {
      const { count, error } = await supabase
        .from('forex_candles')
        .select('*', { count: 'exact', head: true })
        .eq('symbol', symbol)
        .eq('timeframe', timeframe);

      if (!error) {
        const key = `${symbol}_${timeframe}`;
        counts[key] = count || 0;
      }
    }
  }

  console.log('Candle Counts by Symbol/Timeframe:\n');
  console.log('Symbol'.padEnd(10) + timeframes.map(tf => tf.padEnd(10)).join(''));
  console.log('-'.repeat(80));

  let readyCount = 0;
  let totalCombinations = symbols.length * timeframes.length;

  symbols.forEach(symbol => {
    const row = symbol.padEnd(10);
    const cells = timeframes.map(tf => {
      const key = `${symbol}_${tf}`;
      const count = counts[key] || 0;
      if (count >= 50) readyCount++;
      const status = count >= 50 ? '✅' : '⚠️';
      return `${status}${count}`.padEnd(10);
    });
    console.log(row + cells.join(''));
  });

  console.log('\n✅ = Ready for AI (50+ candles)');
  console.log('⚠️ = Insufficient data');
  console.log(`\n📊 AI Readiness: ${readyCount}/${totalCombinations} symbol/timeframe combinations ready\n`);

  if (readyCount === totalCombinations) {
    console.log('🎉 All symbols and timeframes have sufficient data for AI testing!\n');
  } else if (readyCount > 0) {
    console.log(`⚠️ ${totalCombinations - readyCount} combinations still need more data\n`);
  } else {
    console.log('❌ No combinations have sufficient data yet\n');
  }
}

verify();
