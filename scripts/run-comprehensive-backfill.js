#!/usr/bin/env node

/**
 * Comprehensive Historical Backfill Script
 *
 * This script triggers the comprehensive-backfill edge function to fetch
 * all available historical data from the earliest available date to present
 * for all symbols and timeframes.
 *
 * Usage:
 *   node scripts/run-comprehensive-backfill.js [symbol] [timeframe]
 *
 * Examples:
 *   node scripts/run-comprehensive-backfill.js              # All symbols, all timeframes
 *   node scripts/run-comprehensive-backfill.js EURUSD       # EURUSD only, all timeframes
 *   node scripts/run-comprehensive-backfill.js EURUSD M15   # EURUSD M15 only
 */

import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Error: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in .env');
  process.exit(1);
}

const symbol = process.argv[2] || null;
const timeframe = process.argv[3] || null;

console.log('🚀 Comprehensive Historical Backfill Tool\n');
console.log('This will fetch ALL available historical data from the earliest');
console.log('available date to the present candle.\n');
console.log('Configuration:');
console.log(`  Symbol: ${symbol || 'ALL (XAUUSD, US30, EURUSD, GBPUSD, USDJPY)'}`);
console.log(`  Timeframe: ${timeframe || 'ALL (M1, M5, M15, M30, H1, H4, D1, W1)'}`);
console.log('');
console.log('Maximum backfill depths by timeframe:');
console.log('  M1:  30 days');
console.log('  M5:  60 days');
console.log('  M15: 90 days');
console.log('  M30: 120 days');
console.log('  H1:  180 days');
console.log('  H4:  365 days (1 year)');
console.log('  D1:  730 days (2 years)');
console.log('  W1:  1825 days (5 years)');
console.log('');

async function runBackfill() {
  try {
    const params = new URLSearchParams();
    if (symbol) params.append('symbol', symbol);
    if (timeframe) params.append('timeframe', timeframe);

    const url = `${SUPABASE_URL}/functions/v1/comprehensive-backfill?${params.toString()}`;

    console.log('📡 Calling comprehensive backfill edge function...');
    console.log('⏳ This may take several minutes depending on the amount of data...\n');

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

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ BACKFILL COMPLETED!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('Summary:');
    console.log(`  Status: ${result.success ? '✅ Success' : '❌ Failed'}`);
    console.log(`  Duration: ${result.durationMinutes} minutes`);
    console.log(`  Symbols processed: ${result.symbolsProcessed}`);
    console.log(`  Timeframes processed: ${result.timeframesProcessed}`);
    console.log(`  Total candles: ${result.totalCandlesProcessed.toLocaleString()}`);
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
          const status = r.complete ? '✅' : '❌';
          const oldestDate = r.oldestCandle ? new Date(r.oldestCandle).toISOString().split('T')[0] : 'N/A';
          const newestDate = r.newestCandle ? new Date(r.newestCandle).toISOString().split('T')[0] : 'N/A';

          console.log(`    ${status} ${r.timeframe.padEnd(4)} - ${r.totalCandles.toLocaleString().padStart(7)} candles | ${oldestDate} to ${newestDate}`);

          if (r.errors.length > 0) {
            console.log(`       ⚠️ Errors: ${r.errors.join(', ')}`);
          }
        });
        console.log('');
      }
    }

    // Verify data in database
    console.log('🔍 Verifying data in database...\n');
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

    const symbols = symbol ? [symbol] : ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];
    const timeframes = timeframe ? [timeframe] : ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'];

    console.log('┌────────────┬─────────┬──────────────┬──────────────┬───────────────┐');
    console.log('│ Symbol     │ TF      │ Total        │ Oldest       │ Newest        │');
    console.log('├────────────┼─────────┼──────────────┼──────────────┼───────────────┤');

    for (const sym of symbols) {
      for (const tf of timeframes) {
        const { data, error } = await supabase
          .from('forex_candles')
          .select('open_time')
          .eq('symbol', sym)
          .eq('timeframe', tf)
          .order('open_time');

        if (error) {
          console.error(`Error fetching ${sym} ${tf}:`, error.message);
          continue;
        }

        if (!data || data.length === 0) {
          console.log(`│ ${sym.padEnd(10)} │ ${tf.padEnd(7)} │ ${String(0).padStart(12)} │ ${'N/A'.padEnd(12)} │ ${'N/A'.padEnd(13)} │`);
          continue;
        }

        const oldest = new Date(data[0].open_time).toISOString().split('T')[0];
        const newest = new Date(data[data.length - 1].open_time).toISOString().split('T')[0];
        const count = data.length;

        console.log(`│ ${sym.padEnd(10)} │ ${tf.padEnd(7)} │ ${count.toLocaleString().padStart(12)} │ ${oldest.padEnd(12)} │ ${newest.padEnd(13)} │`);
      }
    }

    console.log('└────────────┴─────────┴──────────────┴──────────────┴───────────────┘\n');

  } catch (error) {
    console.error('Error verifying data:', error.message);
  }
}

runBackfill();
