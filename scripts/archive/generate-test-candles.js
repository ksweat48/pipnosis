#!/usr/bin/env node

/**
 * Generate Test Candle Data
 *
 * This script generates synthetic historical candle data for testing the AI system.
 * It creates realistic-looking OHLC data based on current price levels with appropriate
 * volatility and trends.
 *
 * Usage:
 *   node scripts/generate-test-candles.js
 */

import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Error: Supabase credentials missing in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Symbol configurations with realistic price levels and volatility
const SYMBOLS = {
  'XAUUSD': { basePrice: 2650.00, volatility: 15.0, minPrice: 2600, maxPrice: 2700 },
  'US30': { basePrice: 42500.00, volatility: 250.0, minPrice: 42000, maxPrice: 43000 },
  'EURUSD': { basePrice: 1.0850, volatility: 0.0080, minPrice: 1.07, maxPrice: 1.10 },
  'GBPUSD': { basePrice: 1.2750, volatility: 0.0095, minPrice: 1.26, maxPrice: 1.29 },
  'USDJPY': { basePrice: 149.50, volatility: 0.85, minPrice: 148, maxPrice: 151 }
};

// Generate enough candles to reach 50+ for each timeframe
const TIMEFRAMES = [
  { name: 'M5', minutes: 5, candles: 100 },   // Need ~20-30 more per symbol
  { name: 'M15', minutes: 15, candles: 100 }, // Need ~40 more per symbol
  { name: 'M30', minutes: 30, candles: 100 }, // Need ~40 more per symbol
  { name: 'H1', minutes: 60, candles: 100 },  // Need ~45 more per symbol
  { name: 'H4', minutes: 240, candles: 100 }, // Need ~50 more per symbol
  { name: 'D1', minutes: 1440, candles: 80 }  // Need 50 per symbol
];

console.log('🚀 Generating Test Candle Data\n');

function generateRealisticCandle(symbol, basePrice, volatility, prevClose, timestamp, timeframeMinutes) {
  // Add some trending behavior
  const trendFactor = (Math.random() - 0.5) * 0.3;
  const randomWalk = (Math.random() - 0.5) * volatility;

  // Calculate open based on previous close with small gap
  const gapFactor = (Math.random() - 0.5) * volatility * 0.1;
  const open = prevClose + gapFactor;

  // Generate high and low with proper spread
  const rangeFactor = Math.random() * 0.5 + 0.5; // 0.5 to 1.0
  const candleRange = volatility * rangeFactor * (timeframeMinutes / 15); // Scale by timeframe

  const direction = Math.random() > 0.5 ? 1 : -1;
  const close = open + (randomWalk + trendFactor * volatility) * direction;

  // Ensure high and low bracket open and close
  const high = Math.max(open, close) + Math.random() * candleRange * 0.5;
  const low = Math.min(open, close) - Math.random() * candleRange * 0.5;

  // Ensure price stays within bounds
  const config = SYMBOLS[symbol];
  const boundedPrice = (price) => Math.max(config.minPrice, Math.min(config.maxPrice, price));

  return {
    symbol,
    open: boundedPrice(open),
    high: boundedPrice(high),
    low: boundedPrice(low),
    close: boundedPrice(close),
    volume: Math.floor(Math.random() * 1000) + 100,
    tick_count: Math.floor(Math.random() * 50) + 10
  };
}

async function generateCandlesForSymbol(symbol, config) {
  console.log(`📊 Generating candles for ${symbol}...`);

  let allCandles = [];

  for (const timeframe of TIMEFRAMES) {
    const candles = [];
    // Start from 30 days ago to ensure we have historical data
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - (30 * 24 * 60 * 60 * 1000));
    const intervalMs = timeframe.minutes * 60 * 1000;

    let currentPrice = config.basePrice;
    let currentTime = startTime.getTime();

    // Generate candles going forward in time
    while (candles.length < timeframe.candles && currentTime < endTime.getTime()) {
      const timestamp = new Date(currentTime);
      const candle = generateRealisticCandle(
        symbol,
        config.basePrice,
        config.volatility,
        currentPrice,
        timestamp,
        timeframe.minutes
      );

      candles.push({
        ...candle,
        timeframe: timeframe.name,
        open_time: timestamp.toISOString(),
        close_time: new Date(currentTime + intervalMs).toISOString()
      });

      currentPrice = candle.close;
      currentTime += intervalMs;
    }

    allCandles = allCandles.concat(candles);
    console.log(`  ✅ ${timeframe.name}: ${candles.length} candles`);
  }

  return allCandles;
}

async function saveCandlesToDatabase(candles) {
  console.log(`\n💾 Saving ${candles.length} candles to database...`);
  console.log(`  Date range: ${candles[0].open_time} to ${candles[candles.length-1].open_time}`);

  const batchSize = 500;
  let saved = 0;
  let errors = 0;
  let duplicates = 0;

  for (let i = 0; i < candles.length; i += batchSize) {
    const batch = candles.slice(i, i + batchSize);

    try {
      // Save to forex_candles with ignoreDuplicates to avoid conflicts with real data
      const { data: inserted, error: forexError } = await supabase
        .from('forex_candles')
        .upsert(batch, {
          onConflict: 'symbol,timeframe,open_time',
          ignoreDuplicates: true  // Don't overwrite real data
        })
        .select();

      if (forexError) {
        console.error(`  ❌ Error saving to forex_candles:`, forexError.message);
        errors++;
        continue;
      }

      const insertedCount = inserted ? inserted.length : batch.length;
      duplicates += (batch.length - insertedCount);

      // Save to market_data
      const marketDataBatch = batch.map(c => ({
        symbol: c.symbol,
        timeframe: c.timeframe,
        timestamp: c.open_time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume
      }));

      const { error: marketError } = await supabase
        .from('market_data')
        .upsert(marketDataBatch, {
          onConflict: 'symbol,timeframe,timestamp',
          ignoreDuplicates: false
        });

      if (marketError) {
        console.error(`  ⚠️ Warning saving to market_data:`, marketError.message);
      }

      saved += batch.length;
      process.stdout.write(`\r  Progress: ${saved}/${candles.length} candles saved`);

    } catch (error) {
      console.error(`\n  ❌ Batch save error:`, error.message);
      errors++;
    }
  }

  console.log(`\n  ✅ Saved ${saved} candles (${duplicates} duplicates skipped)${errors > 0 ? ` (${errors} errors)` : ''}`);
  return { saved, errors, duplicates };
}

async function verifyData() {
  console.log('\n🔍 Verifying candle data...\n');

  const { data, error } = await supabase
    .from('forex_candles')
    .select('symbol, timeframe')
    .order('symbol')
    .order('timeframe');

  if (error) {
    console.error('Error verifying:', error.message);
    return;
  }

  // Count by symbol and timeframe
  const counts = {};
  data.forEach(row => {
    const key = `${row.symbol}_${row.timeframe}`;
    counts[key] = (counts[key] || 0) + 1;
  });

  // Display results
  const symbols = Object.keys(SYMBOLS);
  const timeframes = TIMEFRAMES.map(tf => tf.name);

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
}

async function main() {
  try {
    const startTime = Date.now();
    let totalCandles = 0;

    for (const [symbol, config] of Object.entries(SYMBOLS)) {
      const candles = await generateCandlesForSymbol(symbol, config);
      const { saved } = await saveCandlesToDatabase(candles);
      totalCandles += saved;
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n✅ Generation Complete!`);
    console.log(`   Total candles: ${totalCandles}`);
    console.log(`   Duration: ${duration}s\n`);

    await verifyData();

    console.log('🎉 Test data generation successful!');
    console.log('   You can now test the AI trading system.\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
