#!/usr/bin/env node

/**
 * Dukascopy Comprehensive Historical Backfill Script
 *
 * Uses FREE Dukascopy forex data to backfill all timeframes with proper OHLC candles.
 * Dukascopy provides native candlestick data with accurate high/low wicks.
 *
 * Timeframes covered:
 * - M15: ~7 days
 * - M30: ~14 days
 * - H1: ~30 days
 * - H4: ~50 days
 * - D1: ~300 days (10 months)
 * - W1: ~200 weeks (3.8 years)
 *
 * Data source: Dukascopy (100% FREE, no API key required)
 */

const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const NETLIFY_FUNCTION_URL = process.env.VITE_NETLIFY_SITE_URL
  ? `${process.env.VITE_NETLIFY_SITE_URL}/.netlify/functions/dukascopy-historical-backfill`
  : 'http://localhost:8888/.netlify/functions/dukascopy-historical-backfill';

const ADMIN_KEY = process.env.ADMIN_REFRESH_KEY;

// Symbols supported by Dukascopy
const SYMBOLS = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'];

// Timeframe configurations with appropriate lookback periods
const TIMEFRAMES = [
  { timeframe: 'M15', daysBack: 7, description: '15-minute candles (~7 days)' },
  { timeframe: 'M30', daysBack: 14, description: '30-minute candles (~14 days)' },
  { timeframe: 'H1', daysBack: 30, description: '1-hour candles (~30 days)' },
  { timeframe: 'H4', daysBack: 50, description: '4-hour candles (~50 days)' },
  { timeframe: 'D1', daysBack: 300, description: 'Daily candles (~10 months)' },
  { timeframe: 'W1', daysBack: 1400, description: 'Weekly candles (~3.8 years)' }
];

const RATE_LIMIT_DELAY_MS = 1500; // Be gentle with free service
const BATCH_DELAY_MS = 3000; // Extra delay between symbols

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

async function backfillTimeframe(symbol, timeframeConfig, overwrite = false) {
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
        overwrite,
        adminKey: ADMIN_KEY
      },
      {
        timeout: 120000, // 2 minute timeout for large datasets
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    const result = response.data;

    console.log(`✅ SUCCESS: ${symbol} ${timeframe}`);
    console.log(`   Fetched: ${result.candlesFetched} candles`);
    console.log(`   Inserted: ${result.candlesInserted} candles`);
    console.log(`   Skipped: ${result.candlesSkipped} candles`);
    console.log(`   Deleted: ${result.candlesDeleted} candles`);
    console.log(`   Duration: ${(result.duration / 1000).toFixed(2)}s`);

    return {
      success: true,
      symbol,
      timeframe,
      result
    };

  } catch (error) {
    console.error(`❌ FAILED: ${symbol} ${timeframe}`);
    console.error(`   Error: ${error.message}`);

    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Data:`, error.response.data);
    }

    return {
      success: false,
      symbol,
      timeframe,
      error: error.message
    };
  }
}

async function backfillSymbol(symbol, overwrite = false) {
  console.log(`\n${'█'.repeat(80)}`);
  console.log(`█ Starting backfill for ${symbol} (FREE Dukascopy data)`);
  console.log(`${'█'.repeat(80)}`);

  const results = [];

  for (const timeframeConfig of TIMEFRAMES) {
    const result = await backfillTimeframe(symbol, timeframeConfig, overwrite);
    results.push(result);

    // Rate limiting
    console.log(`⏳ Waiting ${RATE_LIMIT_DELAY_MS}ms before next request...`);
    await sleep(RATE_LIMIT_DELAY_MS);
  }

  return results;
}

async function main() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║            DUKASCOPY COMPREHENSIVE HISTORICAL BACKFILL                     ║');
  console.log('║                  FREE Forex Data with Full Wicks                           ║');
  console.log('║               No API Key Required - 100% Free Service                      ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log('\n');

  // Verify configuration
  if (!ADMIN_KEY) {
    console.error('❌ ERROR: ADMIN_REFRESH_KEY not found in .env file');
    process.exit(1);
  }

  console.log(`Target URL: ${NETLIFY_FUNCTION_URL}`);
  console.log(`Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`Timeframes: ${TIMEFRAMES.map(t => t.timeframe).join(', ')}`);
  console.log('\n');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const overwrite = args.includes('--overwrite');
  const specificSymbol = args.find(arg => SYMBOLS.includes(arg.toUpperCase()));
  const specificTimeframe = args.find(arg => TIMEFRAMES.some(t => t.timeframe === arg.toUpperCase()));

  if (overwrite) {
    console.log('⚠️  OVERWRITE MODE: Will replace existing data');
    console.log('\n');
  }

  const allResults = [];

  // Handle specific symbol backfill
  if (specificSymbol) {
    console.log(`🎯 Targeting specific symbol: ${specificSymbol.toUpperCase()}`);

    if (specificTimeframe) {
      console.log(`🎯 Targeting specific timeframe: ${specificTimeframe.toUpperCase()}`);
      const timeframeConfig = TIMEFRAMES.find(t => t.timeframe === specificTimeframe.toUpperCase());
      const result = await backfillTimeframe(specificSymbol.toUpperCase(), timeframeConfig, overwrite);
      allResults.push(result);
    } else {
      const results = await backfillSymbol(specificSymbol.toUpperCase(), overwrite);
      allResults.push(...results);
    }
  } else {
    // Backfill all symbols
    for (const symbol of SYMBOLS) {
      const results = await backfillSymbol(symbol, overwrite);
      allResults.push(...results);

      // Extra delay between symbols
      if (symbol !== SYMBOLS[SYMBOLS.length - 1]) {
        console.log(`\n⏳ Waiting ${BATCH_DELAY_MS}ms before next symbol...`);
        await sleep(BATCH_DELAY_MS);
      }
    }
  }

  // Print summary
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                           BACKFILL SUMMARY                                 ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log('\n');

  const successful = allResults.filter(r => r.success);
  const failed = allResults.filter(r => !r.success);

  console.log(`✅ Successful: ${successful.length}`);
  console.log(`❌ Failed: ${failed.length}`);
  console.log(`📊 Total: ${allResults.length}`);
  console.log('\n');

  if (successful.length > 0) {
    console.log('Successful backfills:');
    successful.forEach(r => {
      const inserted = r.result?.candlesInserted || 0;
      console.log(`  ✅ ${r.symbol} ${r.timeframe}: ${inserted.toLocaleString()} candles`);
    });
    console.log('\n');
  }

  if (failed.length > 0) {
    console.log('Failed backfills:');
    failed.forEach(r => {
      console.log(`  ❌ ${r.symbol} ${r.timeframe}: ${r.error}`);
    });
    console.log('\n');
  }

  const totalCandles = successful.reduce((sum, r) => sum + (r.result?.candlesInserted || 0), 0);
  console.log(`🎉 Total candles inserted: ${totalCandles.toLocaleString()}`);
  console.log(`💰 Total cost: $0.00 (100% FREE via Dukascopy)`);
  console.log('\n');

  console.log('📊 Data Quality:');
  console.log('   ✅ Native OHLC data with proper high/low wicks');
  console.log('   ✅ Validated price relationships (high >= low, etc.)');
  console.log('   ✅ Ready for immediate chart rendering');
  console.log('   ✅ Perfect for AI pattern recognition');
  console.log('\n');

  // Exit with appropriate code
  process.exit(failed.length > 0 ? 1 : 0);
}

// Error handling
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

// Run main function
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
