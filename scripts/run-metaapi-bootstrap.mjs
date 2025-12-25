#!/usr/bin/env node

/**
 * MetaAPI Bootstrap Runner
 * Uses MetaAPI for both crypto and index symbols
 * (Binance is geo-blocked with HTTP 451)
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
config({ path: join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const metaApiToken = process.env.METAAPI_TOKEN;
const metaApiAccountId = process.env.METAAPI_ACCOUNT_ID;
const metaApiRegion = process.env.METAAPI_REGION || 'new-york';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials in .env file');
  process.exit(1);
}

if (!metaApiToken || !metaApiAccountId) {
  console.error('❌ Missing MetaAPI credentials in .env file');
  console.error('   Required: METAAPI_TOKEN, METAAPI_ACCOUNT_ID');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Only symbols available in MetaAPI (verified via list-metaapi-symbols.mjs)
const ALL_SYMBOLS = [
  'BTCUSD',
  'ETHUSD',
  'NAS100',
  'SPX500'
];

console.log('⚠️  Note: SOLUSD and BNBUSD are not available in your MetaAPI broker');
console.log('   Only BTCUSD, ETHUSD, NAS100, SPX500 will be bootstrapped');
console.log('');

const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
const DAYS_TO_FETCH = 7;

function getTimeframeMinutes(timeframe) {
  const map = {
    'M1': 1,
    'M5': 5,
    'M15': 15,
    'M30': 30,
    'H1': 60,
    'H4': 240,
    'D1': 1440
  };
  return map[timeframe] || 5;
}

async function fetchMetaApiCandles(symbol, timeframe, startTime, endTime) {
  try {
    const url = `https://mt-client-api-v1.${metaApiRegion}.agiliumtrade.ai/users/current/accounts/${metaApiAccountId}/historical-market-data/symbols/${symbol}/timeframes/${timeframe}/candles`;

    const params = new URLSearchParams({
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      limit: '1000'
    });

    const response = await fetch(`${url}?${params}`, {
      method: 'GET',
      headers: {
        'auth-token': metaApiToken,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      return { error: `HTTP ${response.status}`, data: [] };
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      return { error: 'Invalid response format', data: [] };
    }

    return { error: null, data };

  } catch (error) {
    return { error: error.message, data: [] };
  }
}

async function bootstrapSymbol(symbol, timeframe) {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - (DAYS_TO_FETCH * 24 * 60 * 60 * 1000));

  const { error, data: metaCandles } = await fetchMetaApiCandles(symbol, timeframe, startTime, endTime);

  if (error || metaCandles.length === 0) {
    return { success: false, count: 0, error: error || 'No data' };
  }

  const candles = metaCandles.map((candle) => {
    const openTime = new Date(candle.time);
    const timeframeMinutes = getTimeframeMinutes(timeframe);
    const closeTime = new Date(openTime.getTime() + timeframeMinutes * 60 * 1000);

    return {
      symbol,
      timeframe,
      open_time: openTime.toISOString(),
      close_time: closeTime.toISOString(),
      open: parseFloat(candle.open),
      high: parseFloat(candle.high),
      low: parseFloat(candle.low),
      close: parseFloat(candle.close),
      volume: parseFloat(candle.tickVolume || candle.volume || 0),
    };
  });

  const { error: dbError } = await supabase
    .from('market_data_m5')
    .upsert(candles, {
      onConflict: 'symbol,timeframe,open_time',
      ignoreDuplicates: false
    });

  if (dbError) {
    return { success: false, count: 0, error: dbError.message };
  }

  return { success: true, count: candles.length, error: null };
}

async function runBootstrap() {
  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║      Bootstrapping All Symbols via MetaAPI (Local Execution)         ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Symbols: ${ALL_SYMBOLS.join(', ')}`);
  console.log(`Timeframes: ${TIMEFRAMES.join(', ')}`);
  console.log(`Days to fetch: ${DAYS_TO_FETCH}`);
  console.log('');

  let totalSuccess = 0;
  let totalFailed = 0;
  let totalCandles = 0;

  for (const symbol of ALL_SYMBOLS) {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📊 ${symbol}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    for (const timeframe of TIMEFRAMES) {
      process.stdout.write(`  ${timeframe}... `);

      const result = await bootstrapSymbol(symbol, timeframe);

      if (result.success) {
        console.log(`✅ ${result.count} candles`);
        totalSuccess++;
        totalCandles += result.count;
      } else {
        console.log(`❌ ${result.error}`);
        totalFailed++;
      }

      // Rate limit: 500ms between requests to respect MetaAPI limits
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('');
  }

  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║                         Bootstrap Complete!                           ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`✅ Successful: ${totalSuccess}/${ALL_SYMBOLS.length * TIMEFRAMES.length}`);
  console.log(`❌ Failed: ${totalFailed}`);
  console.log(`📊 Total candles saved: ${totalCandles.toLocaleString()}`);
  console.log('');
}

// Run the bootstrap
runBootstrap()
  .then(() => {
    console.log('✨ All done! Your symbols now have historical data.');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Open the Pipnosis app');
    console.log('  2. Select any new symbol (BTCUSD, NAS100, etc.)');
    console.log('  3. The chart should display historical candles');
    console.log('  4. Real-time updates work automatically');
    console.log('');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
