#!/usr/bin/env node

/**
 * Targeted Backfill for Nov 7, 2025 Corrupted Candles (00:00-14:10 UTC)
 *
 * This script replaces corrupted candles with proper OHLC data from MetaAPI.
 * It targets the specific time window where candles are missing wicks.
 *
 * Usage:
 *   node scripts/backfill-nov7-targeted.js [--dry-run]
 *
 * Examples:
 *   node scripts/backfill-nov7-targeted.js --dry-run    # Preview changes without modifying data
 *   node scripts/backfill-nov7-targeted.js              # Run actual backfill
 */

import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const METAAPI_TOKEN = process.env.METAAPI_TOKEN;
const METAAPI_ACCOUNT_ID = process.env.METAAPI_ACCOUNT_ID;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Error: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

if (!METAAPI_TOKEN || !METAAPI_ACCOUNT_ID) {
  console.error('❌ Error: METAAPI_TOKEN and METAAPI_ACCOUNT_ID must be set in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Corrupted time window
const START_TIME = new Date('2025-11-07T00:00:00Z');
const END_TIME = new Date('2025-11-07T14:10:00Z');

const PAIRS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];
const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'];

const TIMEFRAME_MINUTES = {
  'M1': 1, 'M5': 5, 'M15': 15, 'M30': 30,
  'H1': 60, 'H4': 240, 'D1': 1440, 'W1': 10080
};

// MetaAPI timeframe mapping
const METAAPI_TIMEFRAMES = {
  'M1': '1m', 'M5': '5m', 'M15': '15m', 'M30': '30m',
  'H1': '1h', 'H4': '4h', 'D1': '1d', 'W1': '1w'
};

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Fetch historical candles from MetaAPI
 */
async function fetchMetaAPICandles(symbol, timeframe) {
  try {
    const metaTimeframe = METAAPI_TIMEFRAMES[timeframe];

    // Calculate how many candles we need
    const durationMinutes = (END_TIME - START_TIME) / (1000 * 60);
    const tfMinutes = TIMEFRAME_MINUTES[timeframe];
    const candlesNeeded = Math.ceil(durationMinutes / tfMinutes) + 10; // Add buffer

    const url = `https://mt-market-data-client-api-v1.london.agiliumtrade.ai/users/current/accounts/${METAAPI_ACCOUNT_ID}/historical-market-data/symbols/${symbol}/timeframes/${metaTimeframe}/candles`;

    // Fetch extra range to ensure we cover the window
    const startFrom = new Date(START_TIME.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days before

    const params = new URLSearchParams({
      startTime: startFrom.toISOString(),
      limit: candlesNeeded.toString()
    });

    console.log(`  📡 Fetching ${timeframe} candles for ${symbol} from MetaAPI...`);

    const response = await fetch(`${url}?${params.toString()}`, {
      headers: {
        'auth-token': METAAPI_TOKEN,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MetaAPI HTTP ${response.status}: ${errorText}`);
    }

    const rawCandles = await response.json();

    // Filter to only candles within our target window
    const filteredCandles = rawCandles
      .filter(c => {
        const candleTime = new Date(c.time);
        return candleTime >= START_TIME && candleTime < END_TIME;
      })
      .map(c => {
        const openTime = new Date(c.time);
        const closeTime = new Date(openTime.getTime() + tfMinutes * 60 * 1000);

        return {
          symbol,
          timeframe,
          open_time: openTime.toISOString(),
          close_time: closeTime.toISOString(),
          open: parseFloat(c.open),
          high: parseFloat(c.high),
          low: parseFloat(c.low),
          close: parseFloat(c.close),
          volume: parseFloat(c.tickVolume || c.volume || 0)
        };
      });

    console.log(`  ✅ Fetched ${filteredCandles.length} candles in target range`);
    return filteredCandles;

  } catch (error) {
    console.error(`  ❌ Error fetching ${symbol} ${timeframe} from MetaAPI:`, error.message);
    return null;
  }
}

/**
 * Query existing candles in the corrupted range
 */
async function getExistingCandles(symbol, timeframe) {
  try {
    const { data, error } = await supabase
      .from('forex_candles')
      .select('open_time, open, high, low, close, volume')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .gte('open_time', START_TIME.toISOString())
      .lt('open_time', END_TIME.toISOString())
      .order('open_time');

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error(`  ⚠️  Error querying ${symbol} ${timeframe}:`, error.message);
    return [];
  }
}

/**
 * Analyze candle quality (check for wicks)
 */
function analyzeCandleQuality(candles) {
  if (!candles || candles.length === 0) {
    return { total: 0, withWicks: 0, withoutWicks: 0, percentageWithWicks: 0 };
  }

  let withWicks = 0;
  let withoutWicks = 0;

  for (const candle of candles) {
    const bodyHigh = Math.max(candle.open, candle.close);
    const bodyLow = Math.min(candle.open, candle.close);

    const hasUpperWick = candle.high > bodyHigh;
    const hasLowerWick = candle.low < bodyLow;

    if (hasUpperWick || hasLowerWick) {
      withWicks++;
    } else {
      withoutWicks++;
    }
  }

  return {
    total: candles.length,
    withWicks,
    withoutWicks,
    percentageWithWicks: candles.length > 0 ? (withWicks / candles.length * 100) : 0
  };
}

/**
 * Upsert candles into database
 */
async function upsertCandles(candles, dryRun = false) {
  if (!candles || candles.length === 0) {
    return { success: 0, errors: 0 };
  }

  if (dryRun) {
    console.log(`    [DRY RUN] Would upsert ${candles.length} candles`);
    return { success: candles.length, errors: 0 };
  }

  let successCount = 0;
  let errorCount = 0;

  // Process in batches of 50
  const batchSize = 50;
  for (let i = 0; i < candles.length; i += batchSize) {
    const batch = candles.slice(i, i + batchSize);

    try {
      const { error } = await supabase
        .from('forex_candles')
        .upsert(batch, {
          onConflict: 'symbol,timeframe,open_time',
          ignoreDuplicates: false
        });

      if (error) throw error;
      successCount += batch.length;
    } catch (error) {
      console.error(`    ⚠️  Batch upsert error:`, error.message);
      errorCount += batch.length;
    }
  }

  return { success: successCount, errors: errorCount };
}

/**
 * Backfill a specific symbol/timeframe combination
 */
async function backfillSymbolTimeframe(symbol, timeframe, dryRun = false) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Processing ${symbol} - ${timeframe}`);
  console.log('='.repeat(70));

  // Get existing candles
  const existingCandles = await getExistingCandles(symbol, timeframe);
  console.log(`  📊 Existing candles in range: ${existingCandles.length}`);

  if (existingCandles.length > 0) {
    const quality = analyzeCandleQuality(existingCandles);
    console.log(`  📈 Current data quality:`);
    console.log(`     - With wicks: ${quality.withWicks} (${quality.percentageWithWicks.toFixed(1)}%)`);
    console.log(`     - Without wicks: ${quality.withoutWicks}`);
  }

  // Fetch new candles from MetaAPI
  const newCandles = await fetchMetaAPICandles(symbol, timeframe);

  if (!newCandles || newCandles.length === 0) {
    return {
      symbol,
      timeframe,
      status: 'error',
      reason: 'fetch_failed',
      replaced: 0,
      errors: 1
    };
  }

  // Analyze new candle quality
  const newQuality = analyzeCandleQuality(newCandles);
  console.log(`  📈 New data quality:`);
  console.log(`     - With wicks: ${newQuality.withWicks} (${newQuality.percentageWithWicks.toFixed(1)}%)`);
  console.log(`     - Without wicks: ${newQuality.withoutWicks}`);

  // Upsert candles
  if (dryRun) {
    console.log(`  🔍 [DRY RUN] Would replace ${existingCandles.length} candles with ${newCandles.length} new candles`);
  } else {
    console.log(`  💾 Replacing ${existingCandles.length} candles with ${newCandles.length} new candles...`);
  }

  const { success, errors } = await upsertCandles(newCandles, dryRun);

  const statusEmoji = dryRun ? "🔍" : "✅";
  const action = dryRun ? "Dry run complete" : "Replaced";
  console.log(`  ${statusEmoji} ${action}: ${success}, Errors: ${errors}`);

  return {
    symbol,
    timeframe,
    status: dryRun ? 'dry_run' : 'complete',
    reason: 'success',
    existingCount: existingCandles.length,
    newCount: newCandles.length,
    replaced: success,
    errors,
    qualityBefore: existingCandles.length > 0 ? analyzeCandleQuality(existingCandles) : null,
    qualityAfter: newQuality
  };
}

/**
 * Verify final quality across all symbols/timeframes
 */
async function verifyFinalQuality() {
  console.log(`\n${'='.repeat(70)}`);
  console.log('FINAL VERIFICATION - Candle Quality in Target Range');
  console.log(`Target: ${START_TIME.toISOString().split('T')[0]} 00:00 to 14:10 UTC`);
  console.log('='.repeat(70) + '\n');

  const header = 'Symbol'.padEnd(10) + TIMEFRAMES.map(tf => tf.padEnd(12)).join('');
  console.log(header);
  console.log('-'.repeat(100));

  for (const symbol of PAIRS) {
    let row = symbol.padEnd(10);
    for (const timeframe of TIMEFRAMES) {
      const candles = await getExistingCandles(symbol, timeframe);
      const quality = analyzeCandleQuality(candles);

      const count = quality.total;
      const wicksPct = quality.percentageWithWicks;

      const status = wicksPct >= 90 ? '✅' : wicksPct >= 50 ? '⚠️' : '❌';
      row += `${status}${count}(${wicksPct.toFixed(0)}%)`.padEnd(12);
    }
    console.log(row);
  }

  console.log('\n✅ = Excellent (90%+ have wicks)');
  console.log('⚠️ = Moderate (50-89% have wicks)');
  console.log('❌ = Poor (<50% have wicks)\n');
}

/**
 * Main execution
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║  Targeted Backfill: Nov 7, 2025 Corrupted Candles (00:00-14:10) ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  console.log('Target Time Range:');
  console.log(`  Start: ${START_TIME.toISOString()}`);
  console.log(`  End:   ${END_TIME.toISOString()}`);
  console.log(`  Duration: ${((END_TIME - START_TIME) / (1000 * 60 * 60)).toFixed(2)} hours\n`);

  console.log(`Symbols: ${PAIRS.join(', ')}`);
  console.log(`Timeframes: ${TIMEFRAMES.join(', ')}`);
  console.log(`Total combinations: ${PAIRS.length * TIMEFRAMES.length}\n`);

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No data will be modified\n');
  } else {
    console.log('⚠️  LIVE MODE - This will replace corrupted candles in the database\n');
    console.log('Press Ctrl+C within 5 seconds to cancel...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log('Starting backfill...\n');
  }

  const results = [];
  let totalReplaced = 0;
  let totalErrors = 0;

  const startTime = Date.now();

  for (const symbol of PAIRS) {
    for (const timeframe of TIMEFRAMES) {
      const result = await backfillSymbolTimeframe(symbol, timeframe, DRY_RUN);
      results.push(result);
      totalReplaced += result.replaced;
      totalErrors += result.errors;

      // Rate limiting - wait 1 second between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  const duration = (Date.now() - startTime) / 1000;

  console.log(`\n${'='.repeat(70)}`);
  console.log(DRY_RUN ? 'DRY RUN COMPLETE' : 'BACKFILL COMPLETE');
  console.log('='.repeat(70));
  console.log(`Duration: ${duration.toFixed(2)} seconds`);
  console.log(`Total combinations processed: ${results.length}`);
  console.log(`Total candles replaced: ${totalReplaced}`);
  console.log(`Total errors: ${totalErrors}`);

  const completed = results.filter(r => ['complete', 'dry_run'].includes(r.status)).length;
  const errored = results.filter(r => r.status === 'error').length;

  console.log('\nStatus breakdown:');
  console.log(`  ✅ Completed: ${completed}`);
  console.log(`  ❌ Errors: ${errored}`);

  if (!DRY_RUN) {
    await verifyFinalQuality();

    console.log('\n📊 Next Steps:');
    console.log('  1. Refresh your browser at pipnosis.com/trade');
    console.log('  2. Select any symbol/timeframe');
    console.log('  3. Navigate to Nov 7, 2025 on the chart');
    console.log('  4. Candles should now display proper wicks!');
    console.log('\n✨ Targeted backfill complete!\n');
  } else {
    console.log('\n🔍 Dry run complete! Run without --dry-run to apply changes.\n');
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
