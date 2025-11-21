#!/usr/bin/env node

/**
 * Quick 200-Candle Backfill Script
 *
 * This script generates only the last 200 candles per pair/timeframe
 * for quick chart display. Much faster than full 3-month backfill.
 *
 * Total candles: 200 × 5 pairs × 7 timeframes = 7,000 candles
 * Execution time: ~1-2 minutes
 */

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing Supabase credentials in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const SYMBOLS = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30'];
const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
const CANDLES_PER_COMBO = 200;

const TIMEFRAME_DB_MAP = {
  'M1': '1m',
  'M5': '5m',
  'M15': '15m',
  'M30': '30m',
  'H1': '1h',
  'H4': '4h',
  'D1': 'd1'
};

const TIMEFRAME_MINUTES = {
  'M1': 1,
  'M5': 5,
  'M15': 15,
  'M30': 30,
  'H1': 60,
  'H4': 240,
  'D1': 1440
};

/**
 * Normalize timestamp to candle boundary
 */
function normalizeTimestamp(timestamp, intervalMinutes) {
  const date = new Date(timestamp);
  const minutes = date.getUTCMinutes();
  const hours = date.getUTCHours();
  const totalMinutes = hours * 60 + minutes;
  const normalizedMinutes = Math.floor(totalMinutes / intervalMinutes) * intervalMinutes;

  date.setUTCMinutes(normalizedMinutes);
  date.setUTCSeconds(0);
  date.setUTCMilliseconds(0);

  return date;
}

/**
 * Get realistic base prices for each symbol
 */
function getBasePrice(symbol) {
  const basePrices = {
    'EURUSD': 1.0850,
    'GBPUSD': 1.2650,
    'USDJPY': 149.50,
    'XAUUSD': 2050.00,
    'US30': 38500.00
  };
  return basePrices[symbol] || 1.0000;
}

/**
 * Get realistic volatility for each symbol
 */
function getVolatility(symbol) {
  const volatilities = {
    'EURUSD': 0.0003,
    'GBPUSD': 0.0004,
    'USDJPY': 0.05,
    'XAUUSD': 2.00,
    'US30': 100.00
  };
  return volatilities[symbol] || 0.0001;
}

/**
 * Get decimal precision for each symbol
 */
function getPrecision(symbol) {
  const precisions = {
    'EURUSD': 5,
    'GBPUSD': 5,
    'USDJPY': 3,
    'XAUUSD': 2,
    'US30': 2
  };
  return precisions[symbol] || 5;
}

/**
 * Generate 200 candles going back from now
 */
async function generate200Candles(symbol, timeframe) {
  const dbTimeframe = TIMEFRAME_DB_MAP[timeframe];
  const intervalMinutes = TIMEFRAME_MINUTES[timeframe];
  const basePrice = getBasePrice(symbol);
  const volatility = getVolatility(symbol);
  const precision = getPrecision(symbol);

  const now = new Date();
  const latestCandleTime = normalizeTimestamp(now, intervalMinutes);

  const candles = [];
  let currentPrice = basePrice;

  for (let i = CANDLES_PER_COMBO - 1; i >= 0; i--) {
    const candleStartTime = new Date(latestCandleTime.getTime() - (i * intervalMinutes * 60 * 1000));
    const candleEndTime = new Date(candleStartTime.getTime() + intervalMinutes * 60 * 1000);

    const priceChange = (Math.random() - 0.5) * volatility * 2;
    const open = currentPrice;
    const close = currentPrice + priceChange;

    const highVolatility = Math.abs(priceChange) * (1 + Math.random() * 0.5);
    const lowVolatility = Math.abs(priceChange) * (1 + Math.random() * 0.5);

    const high = Math.max(open, close) + highVolatility;
    const low = Math.min(open, close) - lowVolatility;

    candles.push({
      symbol,
      timeframe: dbTimeframe,
      open_time: candleStartTime.toISOString(),
      close_time: candleEndTime.toISOString(),
      open: parseFloat(open.toFixed(precision)),
      high: parseFloat(high.toFixed(precision)),
      low: parseFloat(low.toFixed(precision)),
      close: parseFloat(close.toFixed(precision)),
      volume: Math.floor(Math.random() * 10000) + 1000,
      data_source: 'quick_backfill'
    });

    currentPrice = close;
  }

  return candles;
}

/**
 * Insert candles into database with conflict handling
 */
async function insertCandles(candles) {
  if (candles.length === 0) return { inserted: 0, errors: 0 };

  const batchSize = 100;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < candles.length; i += batchSize) {
    const batch = candles.slice(i, i + batchSize);

    const { error } = await supabase
      .from('forex_candles')
      .upsert(batch, {
        onConflict: 'symbol,timeframe,open_time',
        ignoreDuplicates: false
      });

    if (error) {
      console.error(`    ❌ Batch error:`, error.message);
      errors += batch.length;
    } else {
      inserted += batch.length;
    }
  }

  return { inserted, errors };
}

/**
 * Main execution
 */
async function quickBackfill() {
  console.log('\n' + '='.repeat(70));
  console.log('⚡ QUICK 200-CANDLE BACKFILL');
  console.log('='.repeat(70));
  console.log('\nGenerating last 200 candles per pair/timeframe for quick chart display');
  console.log(`Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`Timeframes: ${TIMEFRAMES.join(', ')}`);
  console.log(`Candles per combo: ${CANDLES_PER_COMBO}`);
  console.log(`Total candles: ${SYMBOLS.length * TIMEFRAMES.length * CANDLES_PER_COMBO}\n`);

  const startTime = Date.now();
  const totalTasks = SYMBOLS.length * TIMEFRAMES.length;
  let completed = 0;
  let failed = 0;
  let totalCandlesInserted = 0;

  for (const symbol of SYMBOLS) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`📈 ${symbol}`);
    console.log('='.repeat(70));

    for (const timeframe of TIMEFRAMES) {
      const taskNum = completed + failed + 1;
      process.stdout.write(`[${taskNum}/${totalTasks}] ${symbol} ${timeframe}: Generating... `);

      try {
        const candles = await generate200Candles(symbol, timeframe);
        process.stdout.write(`Inserting... `);

        const result = await insertCandles(candles);
        console.log(`✅ ${result.inserted} candles`);

        totalCandlesInserted += result.inserted;
        completed++;

      } catch (error) {
        console.log(`❌ ${error.message}`);
        failed++;
      }
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n' + '='.repeat(70));
  console.log('📊 SUMMARY');
  console.log('='.repeat(70));
  console.log(`Duration: ${duration}s`);
  console.log(`✅ Completed: ${completed}/${totalTasks}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📦 Total candles: ${totalCandlesInserted}`);
  console.log('\n✅ Quick backfill complete! Charts should now display data.\n');
}

quickBackfill()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
