#!/usr/bin/env node

/**
 * Generate Sample Candle Data
 *
 * Creates realistic sample candle data for testing when historical data sources are unavailable.
 * This is a temporary solution to get charts displaying while waiting for proper data backfill.
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

const SYMBOLS = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30'];
const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

// Base prices for each symbol
const BASE_PRICES = {
  'EURUSD': 1.08500,
  'GBPUSD': 1.26500,
  'USDJPY': 149.500,
  'XAUUSD': 2650.00,
  'US30': 43500.0
};

// Timeframe intervals in minutes
const TIMEFRAME_MINUTES = {
  'M1': 1,
  'M5': 5,
  'M15': 15,
  'M30': 30,
  'H1': 60,
  'H4': 240,
  'D1': 1440
};

function generateCandles(symbol, timeframe, count = 100) {
  const basePrice = BASE_PRICES[symbol];
  const interval = TIMEFRAME_MINUTES[timeframe];
  const candles = [];

  const now = new Date();

  for (let i = count - 1; i >= 0; i--) {
    const openTime = new Date(now.getTime() - (i * interval * 60 * 1000));
    const closeTime = new Date(openTime.getTime() + (interval * 60 * 1000));

    // Add some realistic price movement
    const trend = Math.sin(i / 10) * 0.001;
    const volatility = Math.random() * 0.0005;

    const open = basePrice + trend + (Math.random() - 0.5) * volatility;
    const movement = (Math.random() - 0.5) * volatility * 2;
    const close = open + movement;
    const high = Math.max(open, close) + Math.random() * volatility * 0.5;
    const low = Math.min(open, close) - Math.random() * volatility * 0.5;

    candles.push({
      symbol,
      timeframe,
      open_time: openTime.toISOString(),
      close_time: closeTime.toISOString(),
      open: open.toFixed(5),
      high: high.toFixed(5),
      low: low.toFixed(5),
      close: close.toFixed(5),
      volume: Math.floor(Math.random() * 1000 + 100)
    });
  }

  return candles;
}

async function insertCandles(candles, batchSize = 50) {
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < candles.length; i += batchSize) {
    const batch = candles.slice(i, i + batchSize);

    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/forex_candles`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=ignore-duplicates'
        },
        body: JSON.stringify(batch)
      });

      if (response.ok) {
        inserted += batch.length;
        process.stdout.write(`\r  Inserted: ${inserted}/${candles.length} candles`);
      } else {
        const error = await response.text();
        console.error(`\n  Batch error: ${error}`);
        errors += batch.length;
      }

      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`\n  Insert error: ${error.message}`);
      errors += batch.length;
    }
  }

  console.log('');
  return { inserted, errors };
}

async function main() {
  console.log('🚀 Sample Candle Data Generator\n');
  console.log('Generating realistic sample data for testing...\n');
  console.log(`Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`Timeframes: ${TIMEFRAMES.join(', ')}`);
  console.log('Candles per combination: 100\n');

  let totalInserted = 0;
  let totalErrors = 0;

  for (const symbol of SYMBOLS) {
    console.log(`\n📊 Processing ${symbol}:`);

    for (const timeframe of TIMEFRAMES) {
      process.stdout.write(`  ${timeframe.padEnd(4)} - Generating...`);

      const candles = generateCandles(symbol, timeframe, 100);

      process.stdout.write(` Inserting...`);
      const { inserted, errors } = await insertCandles(candles);

      const status = errors === 0 ? '✅' : errors < candles.length ? '⚠️' : '❌';
      console.log(`\r  ${status} ${timeframe.padEnd(4)} - ${inserted} inserted, ${errors} errors`);

      totalInserted += inserted;
      totalErrors += errors;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Summary:');
  console.log(`  Total candles inserted: ${totalInserted}`);
  console.log(`  Total errors: ${totalErrors}`);
  console.log('='.repeat(60));
  console.log('\n✅ Sample data generation complete!');
  console.log('\nYou can now view charts at: https://pipnosis.com/trade');
  console.log('\nNote: This is sample data. Run the TradingView backfill script');
  console.log('for real historical data when ready.');
}

main().catch(error => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
