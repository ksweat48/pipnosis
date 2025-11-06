#!/usr/bin/env node

/**
 * Aggregate Existing Realtime Ticks to Candles
 *
 * This script aggregates the existing realtime_prices data into forex_candles
 * for all symbols and timeframes. This is a one-time operation to seed the
 * historical candles from the tick data we've already been collecting.
 *
 * Usage:
 *   node scripts/aggregate-existing-ticks-to-candles.js
 */

import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';

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

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];
const TIMEFRAMES = [
  { name: 'M1', minutes: 1 },
  { name: 'M5', minutes: 5 },
  { name: 'M15', minutes: 15 },
  { name: 'M30', minutes: 30 },
  { name: 'H1', minutes: 60 },
  { name: 'H4', minutes: 240 },
  { name: 'D1', minutes: 1440 }
];

console.log('🚀 Aggregate Existing Ticks to Candles\n');
console.log('This will aggregate all existing realtime_prices data into forex_candles');
console.log('for all symbols and timeframes.\n');

async function checkAvailableData() {
  console.log('🔍 Checking available tick data...\n');

  const { data, error } = await supabase
    .from('realtime_prices')
    .select('symbol, created_at')
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.error('Error checking data:', error.message);
    return null;
  }

  if (!data || data.length === 0) {
    console.log('⚠️ No tick data found in realtime_prices table');
    console.log('   The continuous-price-poller needs to run first to collect data.\n');
    return null;
  }

  const { data: allData, error: countError } = await supabase
    .from('realtime_prices')
    .select('symbol', { count: 'exact', head: true });

  if (countError) {
    console.error('Error counting data:', countError.message);
    return null;
  }

  const oldestTick = new Date(data[0].created_at);
  const now = new Date();
  const hoursOfData = (now - oldestTick) / (1000 * 60 * 60);

  console.log(`📊 Found tick data:`);
  console.log(`   Total ticks: ${allData.count || 0}`);
  console.log(`   Oldest tick: ${oldestTick.toISOString()}`);
  console.log(`   Data span: ${hoursOfData.toFixed(1)} hours\n`);

  return oldestTick;
}

function aggregateTicksToCandles(ticks, timeframeMinutes) {
  const candles = new Map();

  ticks.forEach(tick => {
    const tickTime = new Date(tick.broker_time || tick.created_at).getTime();
    const intervalMs = timeframeMinutes * 60 * 1000;
    const candleStartMs = Math.floor(tickTime / intervalMs) * intervalMs;
    const candleStartTime = new Date(candleStartMs).toISOString();

    const bid = parseFloat(tick.bid);
    const ask = parseFloat(tick.ask);
    const midPrice = (bid + ask) / 2;

    if (!candles.has(candleStartTime)) {
      candles.set(candleStartTime, {
        open: midPrice,
        high: midPrice,
        low: midPrice,
        close: midPrice,
        volume: 0,
        prices: []
      });
    }

    const candle = candles.get(candleStartTime);
    candle.high = Math.max(candle.high, midPrice);
    candle.low = Math.min(candle.low, midPrice);
    candle.close = midPrice;
    candle.volume++;
    candle.prices.push(midPrice);
  });

  return Array.from(candles.entries()).map(([time, data]) => {
    const closeTime = new Date(new Date(time).getTime() + timeframeMinutes * 60 * 1000).toISOString();

    return {
      open_time: time,
      close_time: closeTime,
      open: data.open,
      high: data.high,
      low: data.low,
      close: data.close,
      volume: data.volume,
      tick_count: data.prices.length
    };
  }).sort((a, b) => new Date(a.open_time) - new Date(b.open_time));
}

async function aggregateForSymbol(symbol, startTime) {
  console.log(`\n📈 Processing ${symbol}...`);

  const { data: ticks, error } = await supabase
    .from('realtime_prices')
    .select('bid, ask, created_at, broker_time')
    .eq('symbol', symbol)
    .gte('created_at', startTime.toISOString())
    .order('created_at', { ascending: true });

  if (error) {
    console.error(`   ❌ Error fetching ticks: ${error.message}`);
    return;
  }

  if (!ticks || ticks.length === 0) {
    console.log(`   ⚠️ No ticks found`);
    return;
  }

  console.log(`   Found ${ticks.length} ticks to aggregate`);

  let totalCandlesCreated = 0;

  for (const timeframe of TIMEFRAMES) {
    const candles = aggregateTicksToCandles(ticks, timeframe.minutes);

    if (candles.length === 0) {
      console.log(`   ⚠️ ${timeframe.name}: No candles generated`);
      continue;
    }

    const candlesToInsert = candles.map(candle => ({
      symbol,
      timeframe: timeframe.name,
      ...candle
    }));

    const { error: insertError } = await supabase
      .from('forex_candles')
      .upsert(candlesToInsert, {
        onConflict: 'symbol,timeframe,open_time',
        ignoreDuplicates: false
      });

    if (insertError) {
      console.log(`   ❌ ${timeframe.name}: Error - ${insertError.message}`);
    } else {
      console.log(`   ✅ ${timeframe.name}: ${candles.length} candles created`);
      totalCandlesCreated += candles.length;
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`   Total: ${totalCandlesCreated} candles created across all timeframes`);
}

async function runAggregation() {
  try {
    const startTime = await checkAvailableData();

    if (!startTime) {
      console.log('❌ No data available to aggregate. Exiting.\n');
      process.exit(1);
    }

    console.log('🔄 Starting aggregation...');

    for (const symbol of SYMBOLS) {
      await aggregateForSymbol(symbol, startTime);
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log('\n✅ Aggregation complete!\n');
    console.log('🔍 Verifying candle counts...\n');
    await verifyData();

  } catch (error) {
    console.error('\n❌ Aggregation failed:', error.message);
    process.exit(1);
  }
}

async function verifyData() {
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
      const status = count >= 50 ? '✅' : count >= 10 ? '⚠️' : '❌';
      return `${status}${count}`.padEnd(8);
    });
    console.log(row + cells.join(''));
  });

  console.log('\n✅ = Good (50+ candles)');
  console.log('⚠️ = Limited (10-49 candles)');
  console.log('❌ = Very few (<10 candles)\n');

  console.log('📊 Next Steps:');
  console.log('  1. If candle counts are low, wait for more tick data to accumulate');
  console.log('  2. Refresh your browser at pipnosis.com/trade');
  console.log('  3. Select any symbol/timeframe to view historical candles\n');
}

runAggregation();
