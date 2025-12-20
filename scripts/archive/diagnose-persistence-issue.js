#!/usr/bin/env node

/**
 * Diagnostic Script: Check Candle Data Persistence
 *
 * This script diagnoses why candle data is not persisting between page loads.
 * It checks:
 * 1. Recent price data collection
 * 2. Recent candle creation
 * 3. Timeframe format consistency
 * 4. Data source tracking
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];

async function checkRecentPrices() {
  console.log('\n📊 Checking recent price collection (last 30 minutes)...\n');

  const { data, error } = await supabase
    .from('realtime_prices')
    .select('symbol, created_at, source')
    .gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('❌ Error querying realtime_prices:', error.message);
    return;
  }

  if (!data || data.length === 0) {
    console.error('❌ NO PRICE DATA in last 30 minutes - Netlify function not running!');
    return;
  }

  const bySymbol = {};
  data.forEach(price => {
    if (!bySymbol[price.symbol]) {
      bySymbol[price.symbol] = { count: 0, lastTime: price.created_at, source: price.source };
    }
    bySymbol[price.symbol].count++;
  });

  console.log('Price Collection Status:');
  SYMBOLS.forEach(symbol => {
    if (bySymbol[symbol]) {
      const minutesAgo = Math.round((Date.now() - new Date(bySymbol[symbol].lastTime).getTime()) / 60000);
      console.log(`  ✅ ${symbol}: ${bySymbol[symbol].count} prices, last ${minutesAgo}min ago (${bySymbol[symbol].source})`);
    } else {
      console.log(`  ❌ ${symbol}: NO DATA`);
    }
  });
}

async function checkRecentCandles() {
  console.log('\n🕯️  Checking recent candle creation (last 24 hours)...\n');

  const { data, error } = await supabase
    .from('forex_candles')
    .select('symbol, timeframe, open_time, data_source')
    .gte('open_time', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('open_time', { ascending: false })
    .limit(1000);

  if (error) {
    console.error('❌ Error querying forex_candles:', error.message);
    return;
  }

  if (!data || data.length === 0) {
    console.error('❌ NO CANDLE DATA in last 24 hours - Aggregator not working!');
    return;
  }

  const bySymbolTimeframe = {};
  data.forEach(candle => {
    const key = `${candle.symbol}_${candle.timeframe}`;
    if (!bySymbolTimeframe[key]) {
      bySymbolTimeframe[key] = {
        count: 0,
        lastTime: candle.open_time,
        source: candle.data_source || 'unknown'
      };
    }
    bySymbolTimeframe[key].count++;
  });

  console.log('Candle Creation Status:');
  SYMBOLS.forEach(symbol => {
    console.log(`\n  ${symbol}:`);
    ['M5', '5m', 'm5', 'M1', '1m', 'm1', 'H1', '1h', 'h1'].forEach(tf => {
      const key = `${symbol}_${tf}`;
      if (bySymbolTimeframe[key]) {
        const minutesAgo = Math.round((Date.now() - new Date(bySymbolTimeframe[key].lastTime).getTime()) / 60000);
        console.log(`    ✅ ${tf}: ${bySymbolTimeframe[key].count} candles, last ${minutesAgo}min ago (${bySymbolTimeframe[key].source})`);
      }
    });
  });
}

async function checkTimeframeFormats() {
  console.log('\n📋 Checking timeframe format consistency...\n');

  const { data, error } = await supabase
    .from('forex_candles')
    .select('timeframe')
    .limit(10000);

  if (error) {
    console.error('❌ Error querying timeframes:', error.message);
    return;
  }

  const formats = new Set();
  data.forEach(row => formats.add(row.timeframe));

  console.log('Timeframe formats found in database:');
  Array.from(formats).sort().forEach(tf => {
    console.log(`  - ${tf}`);
  });

  const hasUppercase = Array.from(formats).some(tf => /^[A-Z]/.test(tf));
  const hasLowercase = Array.from(formats).some(tf => /^[a-z]/.test(tf));
  const hasNumber = Array.from(formats).some(tf => /^\d/.test(tf));

  if (hasUppercase && hasLowercase) {
    console.log('\n⚠️  WARNING: Mixed case formats detected - this causes query issues!');
  }
  if (hasNumber) {
    console.log('\n⚠️  WARNING: Number-prefixed formats detected - should be letter-prefixed!');
  }
}

async function checkDataSources() {
  console.log('\n📡 Checking data sources...\n');

  const { data, error } = await supabase
    .from('forex_candles')
    .select('data_source')
    .gte('open_time', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .limit(10000);

  if (error) {
    console.error('❌ Error querying data sources:', error.message);
    return;
  }

  const sources = {};
  data.forEach(row => {
    const source = row.data_source || 'null';
    sources[source] = (sources[source] || 0) + 1;
  });

  console.log('Data sources (last 24h):');
  Object.entries(sources).sort((a, b) => b[1] - a[1]).forEach(([source, count]) => {
    console.log(`  - ${source}: ${count} candles`);
  });

  if (sources['netlify_aggregator']) {
    console.log('\n✅ Netlify aggregator is creating candles!');
  } else {
    console.log('\n❌ Netlify aggregator NOT creating candles - function may be failing!');
  }
}

async function runDiagnostics() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔍 CANDLE PERSISTENCE DIAGNOSTIC REPORT');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Timestamp: ${new Date().toISOString()}`);

  await checkRecentPrices();
  await checkRecentCandles();
  await checkTimeframeFormats();
  await checkDataSources();

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('RECOMMENDATIONS:');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('1. If NO price data: Check Netlify function logs for continuous-price-collector');
  console.log('2. If prices but NO candles: Check continuous-candle-aggregator logs');
  console.log('3. If mixed timeframe formats: Run standardization migration');
  console.log('4. If NO netlify_aggregator source: Functions are not executing\n');
}

runDiagnostics().catch(console.error);
