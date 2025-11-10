#!/usr/bin/env node

/**
 * Comprehensive Historical Data Backfill Using MetaAPI
 *
 * This script performs a complete historical data backfill using MetaAPI,
 * filling gaps, replacing incomplete candles, and extending historical data.
 *
 * Features:
 * - Smart gap detection and filling
 * - Incomplete candle replacement
 * - Optimized fetch limits per timeframe
 * - Progress tracking
 * - Data validation
 * - Safe upsert logic
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const METAAPI_TOKEN = process.env.METAAPI_TOKEN;
const METAAPI_ACCOUNT_ID = process.env.METAAPI_ACCOUNT_ID;
const METAAPI_REGION = process.env.METAAPI_REGION || 'new-york';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Error: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  process.exit(1);
}

if (!METAAPI_TOKEN || !METAAPI_ACCOUNT_ID) {
  console.error('❌ Error: METAAPI_TOKEN and METAAPI_ACCOUNT_ID must be set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PAIRS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];
const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'];

// Optimized fetch limits per timeframe for maximum coverage
const FETCH_LIMITS = {
  'M1': 7200,    // ~5 days
  'M5': 6048,    // ~3 weeks
  'M15': 5760,   // ~60 days (2 months)
  'M30': 4320,   // ~90 days (3 months)
  'H1': 4320,    // ~180 days (6 months)
  'H4': 2160,    // ~360 days (1 year)
  'D1': 365,     // ~1 year
  'W1': 260,     // ~5 years
};

const TIMEFRAME_MINUTES = {
  'M1': 1, 'M5': 5, 'M15': 15, 'M30': 30,
  'H1': 60, 'H4': 240, 'D1': 1440, 'W1': 10080
};

class BackfillStats {
  constructor() {
    this.totalFetched = 0;
    this.totalInserted = 0;
    this.totalUpdated = 0;
    this.gapsFilled = 0;
    this.incompleteReplaced = 0;
    this.errors = 0;
    this.startTime = Date.now();
    this.results = {};
  }

  addResult(symbol, timeframe, result) {
    const key = `${symbol}_${timeframe}`;
    this.results[key] = result;
    this.totalFetched += result.fetched || 0;
    this.totalInserted += result.inserted || 0;
    this.totalUpdated += result.updated || 0;
    this.gapsFilled += result.gapsFilled || 0;
    this.incompleteReplaced += result.incompleteReplaced || 0;
    if (result.status === 'error') this.errors++;
  }

  getDuration() {
    return ((Date.now() - this.startTime) / 1000).toFixed(2);
  }

  printSummary() {
    const totalTasks = Object.keys(this.results).length;
    const successRate = ((totalTasks - this.errors) / totalTasks * 100).toFixed(1);

    console.log('\n' + '='.repeat(70));
    console.log('COMPREHENSIVE BACKFILL SUMMARY');
    console.log('='.repeat(70));
    console.log(`Duration: ${this.getDuration()} seconds`);
    console.log(`Total candles fetched: ${this.totalFetched}`);
    console.log(`Total candles inserted (new): ${this.totalInserted}`);
    console.log(`Total candles updated (replaced incomplete): ${this.totalUpdated}`);
    console.log(`Gaps filled: ${this.gapsFilled}`);
    console.log(`Incomplete candles replaced: ${this.incompleteReplaced}`);
    console.log(`Errors: ${this.errors}`);
    console.log(`Success rate: ${successRate}%`);
  }
}

function getLastCompletedCandleTime(timeframe) {
  const now = new Date();
  const intervalMinutes = TIMEFRAME_MINUTES[timeframe];
  const intervalMs = intervalMinutes * 60 * 1000;

  const currentCandleStartMs = Math.floor(now.getTime() / intervalMs) * intervalMs;
  const lastCompletedMs = currentCandleStartMs - intervalMs;

  return new Date(lastCompletedMs);
}

async function getExistingCandleDetails(symbol, timeframe) {
  try {
    const { data, error } = await supabase
      .from('forex_candles')
      .select('open_time, open, high, low, close, volume')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .order('open_time', { ascending: true });

    if (error) throw error;

    if (!data || data.length === 0) {
      return {
        count: 0,
        earliest: null,
        latest: null,
        timestamps: new Set(),
        incompleteCandles: []
      };
    }

    const timestamps = new Set();
    const incompleteCandles = [];

    for (const candle of data) {
      timestamps.add(candle.open_time);

      // Check if candle is incomplete (invalid OHLC)
      if (!isCandleComplete(candle)) {
        incompleteCandles.push(candle.open_time);
      }
    }

    return {
      count: data.length,
      earliest: data[0].open_time,
      latest: data[data.length - 1].open_time,
      timestamps,
      incompleteCandles
    };
  } catch (error) {
    console.error(`⚠️  Error querying ${symbol} ${timeframe}:`, error.message);
    return {
      count: 0,
      earliest: null,
      latest: null,
      timestamps: new Set(),
      incompleteCandles: []
    };
  }
}

function isCandleComplete(candle) {
  try {
    const { open, high, low, close } = candle;
    const o = parseFloat(open);
    const h = parseFloat(high);
    const l = parseFloat(low);
    const c = parseFloat(close);

    // Check for valid OHLC relationship
    if (h < Math.max(o, c) || l > Math.min(o, c)) {
      return false;
    }

    // Check for zero or negative values
    if (o <= 0 || h <= 0 || l <= 0 || c <= 0) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

async function fetchMetaApiCandles(symbol, timeframe, limit) {
  try {
    const now = new Date();
    const intervalMinutes = TIMEFRAME_MINUTES[timeframe];
    const totalMinutes = limit * intervalMinutes;
    const startTime = new Date(now.getTime() - (totalMinutes * 60 * 1000));

    const url = `https://mt-client-api-v1.${METAAPI_REGION}.agiliumtrade.ai/users/current/accounts/${METAAPI_ACCOUNT_ID}/historical-market-data/symbols/${symbol}/timeframes/${timeframe}/candles?startTime=${startTime.toISOString()}`;

    console.log(`  📡 Fetching ${limit} ${timeframe} candles for ${symbol} from MetaAPI...`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'auth-token': METAAPI_TOKEN,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`  ❌ MetaAPI error: ${response.status} - ${errorText}`);
      return null;
    }

    const candles = await response.json();

    if (!Array.isArray(candles)) {
      console.error('  ❌ Invalid candle data from MetaAPI');
      return null;
    }

    console.log(`  ✅ Fetched ${candles.length} candles from MetaAPI`);

    // Filter to last completed candle
    const lastCompleted = getLastCompletedCandleTime(timeframe);
    const filtered = candles.filter(candle => {
      const candleTime = new Date(candle.time);
      return candleTime <= lastCompleted;
    });

    console.log(`  🔍 Filtered ${candles.length} -> ${filtered.length} candles (excluded in-progress)`);
    console.log(`  📅 Last completed candle time: ${lastCompleted.toISOString()}`);

    return filtered.slice(-limit).map(candle => ({
      symbol,
      timeframe,
      open_time: candle.time,
      close_time: new Date(
        new Date(candle.time).getTime() + intervalMinutes * 60000
      ).toISOString(),
      open: parseFloat(candle.open),
      high: parseFloat(candle.high),
      low: parseFloat(candle.low),
      close: parseFloat(candle.close),
      volume: parseFloat(candle.tickVolume || 0),
      data_source: 'metaapi_backfill'
    }));
  } catch (error) {
    console.error(`  ❌ Error fetching ${symbol} ${timeframe}:`, error.message);
    return null;
  }
}

async function upsertCandles(candles, existingDetails) {
  if (!candles || candles.length === 0) {
    return { inserted: 0, updated: 0, skipped: 0 };
  }

  const existingTimestamps = existingDetails.timestamps;
  const incompleteTimestamps = new Set(existingDetails.incompleteCandles);

  const newCandles = [];
  const updateCandles = [];

  for (const candle of candles) {
    const timestamp = candle.open_time;

    if (!existingTimestamps.has(timestamp)) {
      // New candle - insert
      newCandles.push(candle);
    } else if (incompleteTimestamps.has(timestamp)) {
      // Incomplete candle - update
      updateCandles.push(candle);
    }
  }

  let insertedCount = 0;
  let updatedCount = 0;

  // Insert new candles in batches
  if (newCandles.length > 0) {
    console.log(`  💾 Inserting ${newCandles.length} new candles...`);
    const batchSize = 100;
    for (let i = 0; i < newCandles.length; i += batchSize) {
      const batch = newCandles.slice(i, i + batchSize);
      try {
        const { error } = await supabase
          .from('forex_candles')
          .insert(batch);

        if (error) throw error;
        insertedCount += batch.length;
      } catch (error) {
        console.error(`    ⚠️  Batch insert error:`, error.message);
      }
    }
  }

  // Update incomplete candles
  if (updateCandles.length > 0) {
    console.log(`  🔄 Updating ${updateCandles.length} incomplete candles...`);
    for (const candle of updateCandles) {
      try {
        const { error } = await supabase
          .from('forex_candles')
          .update({
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
            data_source: candle.data_source
          })
          .eq('symbol', candle.symbol)
          .eq('timeframe', candle.timeframe)
          .eq('open_time', candle.open_time);

        if (error) throw error;
        updatedCount++;
      } catch (error) {
        console.error(`    ⚠️  Update error:`, error.message);
      }
    }
  }

  const skippedCount = candles.length - insertedCount - updatedCount;

  return {
    inserted: insertedCount,
    updated: updatedCount,
    skipped: skippedCount
  };
}

async function backfillSymbolTimeframe(symbol, timeframe) {
  console.log('\n' + '='.repeat(70));
  console.log(`Processing ${symbol} - ${timeframe}`);
  console.log('='.repeat(70));

  // Get existing data details
  const existing = await getExistingCandleDetails(symbol, timeframe);
  console.log(`  📊 Existing candles: ${existing.count}`);

  if (existing.earliest) {
    console.log(`  📅 Earliest: ${existing.earliest}`);
    console.log(`  📅 Latest: ${existing.latest}`);
  }

  if (existing.incompleteCandles.length > 0) {
    console.log(`  ⚠️  Incomplete candles: ${existing.incompleteCandles.length}`);
  }

  // Fetch from MetaAPI
  const fetchLimit = FETCH_LIMITS[timeframe] || 5000;
  const candles = await fetchMetaApiCandles(symbol, timeframe, fetchLimit);

  if (!candles) {
    return {
      symbol,
      timeframe,
      status: 'error',
      reason: 'fetch_failed',
      fetched: 0
    };
  }

  // Upsert candles
  const upsertResult = await upsertCandles(candles, existing);

  console.log(`  ✅ Inserted: ${upsertResult.inserted}, Updated: ${upsertResult.updated}, Skipped: ${upsertResult.skipped}`);

  return {
    symbol,
    timeframe,
    status: 'success',
    fetched: candles.length,
    inserted: upsertResult.inserted,
    updated: upsertResult.updated,
    gapsFilled: upsertResult.inserted,
    incompleteReplaced: upsertResult.updated
  };
}

async function verifyFinalState() {
  console.log('\n' + '='.repeat(70));
  console.log('FINAL VERIFICATION - Candle Counts and Data Quality');
  console.log('='.repeat(70) + '\n');

  const header = 'Symbol'.padEnd(10) + TIMEFRAMES.map(tf => tf.padEnd(12)).join('');
  console.log(header);
  console.log('-'.repeat(100));

  for (const symbol of PAIRS) {
    let row = symbol.padEnd(10);
    for (const timeframe of TIMEFRAMES) {
      const details = await getExistingCandleDetails(symbol, timeframe);
      const count = details.count;
      const incomplete = details.incompleteCandles.length;

      let status;
      if (count >= 100 && incomplete === 0) {
        status = '✅';
      } else if (count >= 50) {
        status = '⚠️';
      } else {
        status = '❌';
      }

      let display = `${status}${count}`;
      if (incomplete > 0) {
        display += `(${incomplete})`;
      }
      row += display.padEnd(12);
    }
    console.log(row);
  }

  console.log('\n✅ = Excellent (100+ complete candles)');
  console.log('⚠️ = Good (50+ candles)');
  console.log('❌ = Needs more data (<50 candles)');
  console.log('(n) = n incomplete candles found\n');
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║  Comprehensive MetaAPI Historical Data Backfill                   ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  console.log(`Symbols: ${PAIRS.join(', ')}`);
  console.log(`Timeframes: ${TIMEFRAMES.join(', ')}`);
  console.log(`Total combinations: ${PAIRS.length * TIMEFRAMES.length}\n`);

  console.log('Fetch limits per timeframe:');
  for (const [tf, limit] of Object.entries(FETCH_LIMITS)) {
    console.log(`  ${tf}: ${limit} candles`);
  }

  console.log('\nStarting backfill...\n');

  const stats = new BackfillStats();

  for (const symbol of PAIRS) {
    for (const timeframe of TIMEFRAMES) {
      const result = await backfillSymbolTimeframe(symbol, timeframe);
      stats.addResult(symbol, timeframe, result);

      // Rate limiting - be nice to MetaAPI
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  // Print summary
  stats.printSummary();

  // Verify final state
  await verifyFinalState();

  console.log('\n✨ Backfill complete! Your historical data is now comprehensive and complete.\n');
}

main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
