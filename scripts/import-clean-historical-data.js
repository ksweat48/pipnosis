#!/usr/bin/env node

/**
 * Import Clean Historical Data from Dukascopy
 *
 * This script triggers the Dukascopy historical backfill function
 * to import clean, tick-perfect historical data for AI training and backtesting.
 *
 * Usage:
 *   node scripts/import-clean-historical-data.js [months=6]
 *
 * Examples:
 *   node scripts/import-clean-historical-data.js          # Import 6 months
 *   node scripts/import-clean-historical-data.js 3        # Import 3 months
 *   node scripts/import-clean-historical-data.js 12       # Import 12 months
 */

import { config } from 'dotenv';
import axios from 'axios';

config();

const NETLIFY_FUNCTION_URL = process.env.VITE_NETLIFY_URL || 'https://pipnosis.netlify.app';
const ADMIN_KEY = process.env.ADMIN_REFRESH_KEY;

// Symbols to backfill
const SYMBOLS = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30'];

// Timeframes to backfill (prioritized for importance)
const TIMEFRAMES = [
  'H1',   // Most important for AI training
  'H4',   // Key swing timeframe
  'D1',   // Daily patterns
  'M15',  // Entry precision
  'M30',  // Mid-timeframe
  'M5',   // Fine-grained data (optional, very large)
];

function calculateDateRange(monthsBack = 6) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - monthsBack);

  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    monthsBack
  };
}

async function triggerBackfill(symbol, timeframe, startDate, endDate) {
  const url = `${NETLIFY_FUNCTION_URL}/.netlify/functions/dukascopy-historical-backfill`;

  console.log(`\n🔄 Starting import: ${symbol} ${timeframe}`);
  console.log(`   Range: ${startDate.split('T')[0]} to ${endDate.split('T')[0]}`);

  try {
    const startTime = Date.now();

    const response = await axios.post(url, {
      symbol,
      timeframe,
      startDate,
      endDate,
      overwrite: false,  // Don't delete existing good data
      adminKey: ADMIN_KEY
    }, {
      timeout: 300000,  // 5 minute timeout
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const result = response.data;

    if (result.success) {
      console.log(`✅ Success! ${symbol} ${timeframe} (${duration}s)`);
      console.log(`   Fetched: ${result.candlesFetched}`);
      console.log(`   Inserted: ${result.candlesInserted}`);
      console.log(`   Skipped: ${result.candlesSkipped}`);
      if (result.candlesDeleted > 0) {
        console.log(`   Deleted: ${result.candlesDeleted}`);
      }
    } else {
      console.log(`❌ Failed: ${symbol} ${timeframe}`);
      console.log(`   Error: ${result.error}`);
    }

    return result;

  } catch (error) {
    console.error(`❌ Request failed: ${symbol} ${timeframe}`);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Error: ${error.response.data?.error || error.response.statusText}`);
    } else if (error.code === 'ECONNABORTED') {
      console.error(`   Timeout after 5 minutes`);
    } else {
      console.error(`   ${error.message}`);
    }

    return { success: false, symbol, timeframe, error: error.message };
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║      PIPNOSIS - HISTORICAL DATA IMPORT (DUKASCOPY)        ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  if (!ADMIN_KEY) {
    console.error('\n❌ Error: ADMIN_REFRESH_KEY not found in environment variables');
    console.error('   Please set it in your .env file\n');
    process.exit(1);
  }

  // Get months from command line arg (default 6)
  const monthsBack = parseInt(process.argv[2]) || 6;
  const { startDate, endDate } = calculateDateRange(monthsBack);

  console.log(`\n📅 Import Range: ${monthsBack} months`);
  console.log(`   From: ${startDate.split('T')[0]}`);
  console.log(`   To:   ${endDate.split('T')[0]}`);
  console.log(`\n📊 Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`⏱️  Timeframes: ${TIMEFRAMES.join(', ')}`);
  console.log(`\n🔧 Strategy: Non-destructive (preserves existing data)`);
  console.log(`🎯 Source Priority: dukascopy_historical = HIGHEST\n`);
  console.log('─'.repeat(60));

  const results = {
    total: 0,
    success: 0,
    failed: 0,
    totalCandlesInserted: 0,
    totalCandelsFetched: 0,
    details: []
  };

  // Process sequentially to avoid rate limits
  for (const symbol of SYMBOLS) {
    console.log(`\n\n📈 SYMBOL: ${symbol}`);
    console.log('─'.repeat(60));

    for (const timeframe of TIMEFRAMES) {
      results.total++;

      const result = await triggerBackfill(symbol, timeframe, startDate, endDate);

      if (result.success) {
        results.success++;
        results.totalCandlesInserted += result.candlesInserted || 0;
        results.totalCandelsFetched += result.candlesFetched || 0;
      } else {
        results.failed++;
      }

      results.details.push(result);

      // Small delay between requests to be nice to the API
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // Print summary
  console.log('\n\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                      IMPORT SUMMARY                        ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\n📊 Total Imports: ${results.total}`);
  console.log(`✅ Successful: ${results.success}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`\n📈 Total Candles Fetched: ${results.totalCandelsFetched.toLocaleString()}`);
  console.log(`💾 Total Candles Inserted: ${results.totalCandlesInserted.toLocaleString()}`);

  const successRate = ((results.success / results.total) * 100).toFixed(1);
  console.log(`\n🎯 Success Rate: ${successRate}%`);

  if (results.failed > 0) {
    console.log('\n⚠️  Failed Imports:');
    results.details
      .filter(r => !r.success)
      .forEach(r => {
        console.log(`   - ${r.symbol} ${r.timeframe}: ${r.error}`);
      });
  }

  console.log('\n✨ Import complete! Your database now has clean historical data.');
  console.log('🤖 AI can now train on months of tick-perfect OHLC data with proper wicks.\n');
}

main().catch(error => {
  console.error('\n💥 Fatal error:', error.message);
  process.exit(1);
});
