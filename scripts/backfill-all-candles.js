#!/usr/bin/env node

/**
 * Historical Candle Backfill Script
 *
 * This script triggers the backfill-historical-candles edge function
 * to fetch real historical data from MetaAPI for all symbols and timeframes.
 *
 * Usage:
 *   node scripts/backfill-all-candles.js [days] [symbol] [timeframe]
 *
 * Examples:
 *   node scripts/backfill-all-candles.js              # Backfill 30 days for all symbols/timeframes
 *   node scripts/backfill-all-candles.js 60           # Backfill 60 days for all symbols/timeframes
 *   node scripts/backfill-all-candles.js 30 EURUSD    # Backfill 30 days for EURUSD only
 *   node scripts/backfill-all-candles.js 30 EURUSD M15 # Backfill 30 days for EURUSD M15 only
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

// Parse command line arguments
const days = parseInt(process.argv[2] || '30', 10);
const symbol = process.argv[3] || null;
const timeframe = process.argv[4] || null;

console.log('🚀 Historical Candle Backfill Tool\n');
console.log('Configuration:');
console.log(`  Days back: ${days}`);
console.log(`  Symbol: ${symbol || 'ALL (XAUUSD, US30, EURUSD, GBPUSD, USDJPY)'}`);
console.log(`  Timeframe: ${timeframe || 'ALL (M1, M5, M15, M30, H1, H4, D1)'}`);
console.log('');

async function runBackfill() {
  try {
    const params = new URLSearchParams();
    params.append('days', days.toString());
    if (symbol) params.append('symbol', symbol);
    if (timeframe) params.append('timeframe', timeframe);

    const url = `${SUPABASE_URL}/functions/v1/backfill-historical-candles?${params.toString()}`;

    console.log('📡 Calling backfill edge function...');
    console.log(`   URL: ${url.replace(SUPABASE_ANON_KEY, 'XXX')}\n`);

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

    // Now verify the data
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
      .select('symbol, timeframe')
      .gte('open_time', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString());

    if (error) {
      console.error('Error verifying data:', error.message);
      return;
    }

    if (!data || data.length === 0) {
      console.log('⚠️ No candles found in database');
      return;
    }

    // Group by symbol and timeframe
    const counts = {};
    data.forEach(row => {
      const key = `${row.symbol}_${row.timeframe}`;
      counts[key] = (counts[key] || 0) + 1;
    });

    // Display results
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
        const status = count >= 50 ? '✅' : '⚠️';
        return `${status}${count}`.padEnd(8);
      });
      console.log(row + cells.join(''));
    });

    console.log('\n✅ = Ready for AI (50+ candles)');
    console.log('⚠️ = Insufficient data\n');

  } catch (error) {
    console.error('Error verifying data:', error.message);
  }
}

// Run the backfill
runBackfill();
