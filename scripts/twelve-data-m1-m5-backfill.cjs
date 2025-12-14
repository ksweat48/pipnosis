#!/usr/bin/env node

/**
 * Twelve Data M1/M5 Historical Backfill Script
 *
 * Uses Twelve Data API to backfill M1 and M5 timeframes with historical data.
 * Dukascopy doesn't support these smaller timeframes, so we use Twelve Data.
 *
 * WARNING: M1 data is very large. We keep it minimal (7-10 days max).
 * M5 can go back further (30 days).
 *
 * Rate limits: 8 API calls per minute, 800 calls per day (free tier)
 */

const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const NETLIFY_FUNCTION_URL = process.env.VITE_NETLIFY_SITE_URL
  ? `${process.env.VITE_NETLIFY_SITE_URL}/.netlify/functions/twelve-data-import`
  : 'https://pipnosis.netlify.app/.netlify/functions/twelve-data-import';

const ADMIN_KEY = process.env.ADMIN_REFRESH_KEY;

// Focus on major forex pairs only (Twelve Data has limited free calls)
const SYMBOLS = ['EURUSD', 'GBPUSD', 'USDJPY'];

// Conservative timeframe configurations
const TIMEFRAMES = [
  { timeframe: 'M1', daysBack: 7, description: '1-minute candles (7 days max due to data volume)' },
  { timeframe: 'M5', daysBack: 30, description: '5-minute candles (30 days)' }
];

// Rate limiting: Free tier allows 8 API calls per minute
const API_CALL_DELAY_MS = 8000; // 8 seconds between calls to stay under limit

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

async function backfillTimeframe(symbol, timeframeConfig) {
  const { timeframe, daysBack, description } = timeframeConfig;

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Backfilling ${symbol} ${timeframe} - ${description}`);
  console.log(`Date range: ${formatDate(startDate)} to ${formatDate(endDate)}`);
  console.log(`${'='.repeat(80)}`);

  try {
    const response = await axios.post(
      NETLIFY_FUNCTION_URL,
      {
        symbol,
        timeframe,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        overwrite: false, // Don't delete existing data
        adminKey: ADMIN_KEY
      },
      {
        timeout: 120000, // 2 minute timeout
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    const result = response.data;

    console.log(`✅ SUCCESS: ${symbol} ${timeframe}`);
    console.log(`   Fetched: ${result.candlesFetched || 0} candles`);
    console.log(`   Inserted: ${result.candlesInserted || 0} candles`);
    console.log(`   Skipped: ${result.candlesSkipped || 0} candles`);
    console.log(`   Duration: ${((result.duration || 0) / 1000).toFixed(2)}s`);

    return {
      success: true,
      symbol,
      timeframe,
      candlesFetched: result.candlesFetched || 0,
      candlesInserted: result.candlesInserted || 0
    };

  } catch (error) {
    console.error(`❌ FAILED: ${symbol} ${timeframe}`);
    console.error(`   Error: ${error.message}`);

    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Response: ${JSON.stringify(error.response.data)}`);
    }

    return {
      success: false,
      symbol,
      timeframe,
      error: error.message
    };
  }
}

async function main() {
  console.log('🚀 Starting M1 and M5 Historical Backfill via Twelve Data...\n');
  console.log(`📡 Endpoint: ${NETLIFY_FUNCTION_URL}`);
  console.log(`📊 Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`⏰ Timeframes: M1 (7 days), M5 (30 days)`);
  console.log(`⚠️  Rate Limit: 8 API calls/minute, 800 calls/day`);
  console.log(`💾 Mode: Gap-fill (preserves existing data)\n`);
  console.log(`${'='.repeat(80)}\n`);

  const results = [];
  let totalFetched = 0;
  let totalInserted = 0;
  let successCount = 0;
  let failCount = 0;

  // Process each timeframe
  for (const timeframeConfig of TIMEFRAMES) {
    console.log(`\n📈 Processing ${timeframeConfig.timeframe} Timeframe...`);
    console.log(`${'='.repeat(80)}`);

    // Process each symbol
    for (const symbol of SYMBOLS) {
      const result = await backfillTimeframe(symbol, timeframeConfig);
      results.push(result);

      if (result.success) {
        successCount++;
        totalFetched += result.candlesFetched || 0;
        totalInserted += result.candlesInserted || 0;
      } else {
        failCount++;
      }

      // Rate limiting: Wait between API calls
      console.log(`\n⏱️  Waiting ${API_CALL_DELAY_MS/1000}s to respect rate limits...`);
      await sleep(API_CALL_DELAY_MS);
    }
  }

  // Summary
  console.log(`\n\n${'='.repeat(80)}`);
  console.log('📊 BACKFILL SUMMARY');
  console.log(`${'='.repeat(80)}`);
  console.log(`✅ Successful: ${successCount} / ${SYMBOLS.length * TIMEFRAMES.length}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`📥 Total Fetched: ${totalFetched.toLocaleString()} candles`);
  console.log(`💾 Total Inserted: ${totalInserted.toLocaleString()} candles`);
  console.log(`${'='.repeat(80)}\n`);

  // Detailed results
  if (failCount > 0) {
    console.log('❌ Failed imports:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`   ${r.symbol} ${r.timeframe}: ${r.error}`);
    });
    console.log('');
  }

  if (successCount > 0) {
    console.log('✨ M1 and M5 historical data backfill complete!');
    console.log('📈 Charts now have historical context for intraday trading.');
    console.log('💡 Tip: Run this script weekly to maintain historical depth.');
  }

  // Exit with appropriate code
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
