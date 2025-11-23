#!/usr/bin/env node

/**
 * Initial 200 Candle Backfill Script
 *
 * One-time script to populate forex_candles table with 200 historical candles
 * from MetaAPI for all symbols and timeframes.
 *
 * Usage:
 *   node scripts/initial-200-candle-backfill.js
 */

import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Error: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in .env');
  process.exit(1);
}

const CANDLE_LIMIT = 200;

console.log('🚀 Initial 200 Candle Backfill\n');
console.log('This will fetch 200 historical candles for each symbol/timeframe combination.\n');
console.log('Symbols: XAUUSD, US30, EURUSD, GBPUSD, USDJPY');
console.log('Timeframes: M1, M5, M15, M30, H1, H4, D1');
console.log(`Candles per combination: ${CANDLE_LIMIT}\n`);

async function runBackfill() {
  try {
    const params = new URLSearchParams();
    params.append('limit', CANDLE_LIMIT.toString());

    const url = `${SUPABASE_URL}/functions/v1/backfill-historical-candles?${params.toString()}`;

    console.log('📡 Calling backfill edge function...\n');

    const startTime = Date.now();

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    console.log('\n✅ Backfill Completed!\n');
    console.log('Summary:');
    console.log(`  Status: ${result.success ? '✅ Success' : '❌ Failed'}`);
    console.log(`  Duration: ${duration}s`);
    console.log(`  Symbols processed: ${result.symbolsProcessed}`);
    console.log(`  Timeframes processed: ${result.timeframesProcessed}`);
    console.log(`  Total candles fetched: ${result.totalCandlesFetched}`);
    console.log(`  Total candles saved: ${result.totalCandlesSaved}`);
    console.log(`  Errors: ${result.totalErrors}`);
    console.log('');

    if (result.results && result.results.length > 0) {
      console.log('Detailed Results:\n');

      const groupedResults = {};
      result.results.forEach(r => {
        if (!groupedResults[r.symbol]) {
          groupedResults[r.symbol] = [];
        }
        groupedResults[r.symbol].push(r);
      });

      for (const [sym, results] of Object.entries(groupedResults)) {
        console.log(`  ${sym}:`);
        results.forEach(r => {
          const status = r.candlesSaved > 0 ? '✅' : (r.errors.length > 0 ? '❌' : '⚠️');
          console.log(`    ${status} ${r.timeframe.padEnd(4)} - ${r.candlesSaved} candles saved${r.errors.length > 0 ? ' (errors: ' + r.errors.join(', ') + ')' : ''}`);
        });
      }
      console.log('');
    }

    console.log('🔍 Verifying candle counts in database...\n');
    await verifyData();

  } catch (error) {
    console.error('\n❌ Backfill failed:', error.message);
    process.exit(1);
  }
}

async function verifyData() {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const { data, error } = await supabase
      .from('forex_candles')
      .select('symbol, timeframe');

    if (error) {
      console.error('Error verifying data:', error.message);
      return;
    }

    if (!data || data.length === 0) {
      console.log('⚠️ No candles found in database');
      return;
    }

    const counts = {};
    data.forEach(row => {
      const key = `${row.symbol}_${row.timeframe}`;
      counts[key] = (counts[key] || 0) + 1;
    });

    const symbols = [...new Set(data.map(d => d.symbol))].sort();
    const timeframes = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

    console.log('Candle Counts by Symbol/Timeframe:\n');
    console.log('Symbol'.padEnd(10) + timeframes.map(tf => tf.padEnd(8)).join(''));
    console.log('-'.repeat(70));

    symbols.forEach(symbol => {
      const row = symbol.padEnd(10);
      const cells = timeframes.map(tf => {
        const key = `${symbol}_${tf}`;
        const count = counts[key] || 0;
        const status = count >= 150 ? '✅' : count >= 100 ? '⚠️' : '❌';
        return `${status}${count}`.padEnd(8);
      });
      console.log(row + cells.join(''));
    });

    console.log('\n✅ = Good (150+ candles)');
    console.log('⚠️ = Moderate (100-149 candles)');
    console.log('❌ = Low (<100 candles)\n');

    console.log('📊 Next Steps:');
    console.log('  1. Refresh your browser at pipnosis.com/trade');
    console.log('  2. Select any symbol/timeframe');
    console.log('  3. You should now see historical candles on the chart!\n');

  } catch (error) {
    console.error('Error verifying data:', error.message);
  }
}

runBackfill();
