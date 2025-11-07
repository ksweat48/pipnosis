#!/usr/bin/env node

/**
 * Backfill script for November 7, 2025 missing data (00:00 - current time)
 * Uses MetaAPI to fetch historical candles for today
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

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

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const metaapiToken = process.env.METAAPI_TOKEN;
const metaapiAccountId = process.env.METAAPI_ACCOUNT_ID;
const metaapiRegion = process.env.METAAPI_REGION || 'new-york';

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  process.exit(1);
}

if (!metaapiToken || !metaapiAccountId) {
  console.error('❌ Error: METAAPI_TOKEN and METAAPI_ACCOUNT_ID must be set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fetchCandlesFromMetaApi(symbol, timeframe, startTime, endTime) {
  const url = `https://mt-client-api-v1.${metaapiRegion}.agiliumtrade.ai/users/current/accounts/${metaapiAccountId}/historical-market-data/symbols/${symbol}/timeframes/${timeframe.name}/candles?startTime=${startTime.toISOString()}&endTime=${endTime.toISOString()}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'auth-token': metaapiToken,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();

      if (response.status === 404 || errorText.includes('NotFoundError')) {
        return { error: 'Symbol not available', candles: [] };
      }

      throw new Error(`MetaAPI error: ${response.status} - ${errorText}`);
    }

    const candles = await response.json();

    if (!Array.isArray(candles)) {
      return { error: 'Invalid response', candles: [] };
    }

    return {
      error: null,
      candles: candles.map(candle => ({
        symbol,
        timeframe: timeframe.name,
        open_time: candle.time,
        close_time: new Date(new Date(candle.time).getTime() + timeframe.minutes * 60000).toISOString(),
        open: parseFloat(candle.open),
        high: parseFloat(candle.high),
        low: parseFloat(candle.low),
        close: parseFloat(candle.close),
        volume: parseFloat(candle.tickVolume || 0)
      }))
    };
  } catch (error) {
    console.error(`  ❌ Error fetching ${symbol} ${timeframe.name}:`, error.message);
    return { error: error.message, candles: [] };
  }
}

async function insertCandles(candles) {
  if (candles.length === 0) return { inserted: 0, errors: 0 };

  try {
    const { error } = await supabase
      .from('forex_candles')
      .upsert(candles, {
        onConflict: 'symbol,timeframe,open_time',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('    ⚠️  Database error:', error.message);
      return { inserted: 0, errors: candles.length };
    }

    return { inserted: candles.length, errors: 0 };
  } catch (error) {
    console.error('    ⚠️  Insert error:', error.message);
    return { inserted: 0, errors: candles.length };
  }
}

async function backfillSymbolTimeframe(symbol, timeframe) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Processing ${symbol} - ${timeframe.name}`);
  console.log('='.repeat(70));

  // Fetch from start of day (00:00 UTC) to now
  const startTime = new Date('2025-11-07T00:00:00Z');
  const endTime = new Date(); // Now

  console.log(`  📅 Time range: ${startTime.toISOString()} to ${endTime.toISOString()}`);
  console.log(`  📡 Fetching candles from MetaAPI...`);

  const { error, candles } = await fetchCandlesFromMetaApi(symbol, timeframe, startTime, endTime);

  if (error) {
    console.log(`  ⚠️  ${error}`);
    return { symbol, timeframe: timeframe.name, status: 'error', reason: error, inserted: 0 };
  }

  console.log(`  ✅ Fetched ${candles.length} candles`);

  if (candles.length === 0) {
    console.log(`  ℹ️  No candles to insert`);
    return { symbol, timeframe: timeframe.name, status: 'no_data', inserted: 0 };
  }

  // Check for wicks
  let withWicks = 0;
  let withoutWicks = 0;

  candles.forEach(c => {
    const bodyHigh = Math.max(c.open, c.close);
    const bodyLow = Math.min(c.open, c.close);
    const hasWicks = c.high > bodyHigh || c.low < bodyLow;

    if (hasWicks) withWicks++;
    else withoutWicks++;
  });

  const wickPct = candles.length > 0 ? ((withWicks / candles.length) * 100).toFixed(1) : 0;
  console.log(`  📈 Quality: ${withWicks} with wicks (${wickPct}%), ${withoutWicks} without wicks`);

  console.log(`  💾 Inserting ${candles.length} candles...`);
  const { inserted, errors } = await insertCandles(candles);

  console.log(`  ✅ Inserted: ${inserted}, Errors: ${errors}`);

  return {
    symbol,
    timeframe: timeframe.name,
    status: 'success',
    fetched: candles.length,
    inserted,
    errors,
    wickPercentage: wickPct
  };
}

async function verifyBackfill() {
  console.log(`\n${'='.repeat(70)}`);
  console.log('VERIFICATION - Candle Counts for Nov 7, 2025');
  console.log('='.repeat(70));
  console.log();

  for (const symbol of SYMBOLS) {
    console.log(`${symbol}:`);
    for (const timeframe of TIMEFRAMES) {
      const { count } = await supabase
        .from('forex_candles')
        .select('*', { count: 'exact', head: true })
        .eq('symbol', symbol)
        .eq('timeframe', timeframe.name)
        .gte('open_time', '2025-11-07T00:00:00Z')
        .lt('open_time', '2025-11-08T00:00:00Z');

      const status = count > 0 ? '✅' : '❌';
      console.log(`  ${timeframe.name}: ${status} ${count || 0} candles`);
    }
    console.log();
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║       November 7, 2025 Data Backfill via MetaAPI                ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  const now = new Date();
  console.log(`Current time: ${now.toISOString()}`);
  console.log(`Backfilling data from 00:00 UTC to now\n`);

  console.log(`Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`Timeframes: ${TIMEFRAMES.map(tf => tf.name).join(', ')}`);
  console.log(`Total combinations: ${SYMBOLS.length * TIMEFRAMES.length}\n`);

  const results = [];
  let totalInserted = 0;
  let totalErrors = 0;

  const startTime = Date.now();

  for (const symbol of SYMBOLS) {
    for (const timeframe of TIMEFRAMES) {
      const result = await backfillSymbolTimeframe(symbol, timeframe);
      results.push(result);
      totalInserted += result.inserted || 0;
      totalErrors += result.errors || 0;

      // Small delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\n${'='.repeat(70)}`);
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(70));
  console.log(`Duration: ${duration} seconds`);
  console.log(`Total combinations processed: ${results.length}`);
  console.log(`Total candles inserted: ${totalInserted}`);
  console.log(`Total errors: ${totalErrors}`);

  const successful = results.filter(r => r.status === 'success').length;
  const errored = results.filter(r => r.status === 'error').length;
  const noData = results.filter(r => r.status === 'no_data').length;

  console.log(`\nStatus breakdown:`);
  console.log(`  ✅ Successful: ${successful}`);
  console.log(`  ⚠️  No data: ${noData}`);
  console.log(`  ❌ Errors: ${errored}`);

  await verifyBackfill();

  console.log('\n✨ Backfill complete! Your charts now have today\'s data.\n');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
