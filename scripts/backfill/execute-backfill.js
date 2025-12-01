#!/usr/bin/env node

/**
 * Execute 1-year historical backfill for all pairs and timeframes
 * Uses free data sources with validation and contamination protection
 */

const {
  TwelveDataSource,
  YahooFinanceSource,
  FCSAPISource,
  PolygonSource,
  MultiSourceFetcher,
} = require('./data-sources');
const { BackfillOrchestrator } = require('./backfill-orchestrator');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// Configuration
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

// Symbols to backfill (primary pairs first, then others)
const SYMBOLS = [
  'EURUSD',
  'GBPUSD',
  'USDJPY',
  'XAUUSD',
  'US30',
  // Add more as needed
  'AUDUSD',
  'USDCAD',
  'NZDUSD',
  'BTCUSD',
  'ETHUSD',
];

// Timeframes to backfill (database format)
const TIMEFRAMES = [
  'D1',  // Daily first (less data, completes fast)
  'H4',  // 4-hour
  'H1',  // Hourly
  'M30', // 30-minute
  'M15', // 15-minute
  'M5',  // 5-minute
  // 'M1',  // 1-minute (very large dataset, optional)
];

// 1 year ago
const ONE_YEAR_AGO = new Date();
ONE_YEAR_AGO.setFullYear(ONE_YEAR_AGO.getFullYear() - 1);

// Today
const TODAY = new Date();

async function main() {
  console.log('\n' + '═'.repeat(80));
  console.log('🚀 HISTORICAL BACKFILL - 1 YEAR DATA');
  console.log('═'.repeat(80));
  console.log(`Start Date: ${ONE_YEAR_AGO.toISOString().split('T')[0]}`);
  console.log(`End Date: ${TODAY.toISOString().split('T')[0]}`);
  console.log(`Symbols: ${SYMBOLS.length} pairs`);
  console.log(`Timeframes: ${TIMEFRAMES.join(', ')}`);
  console.log(`Total tasks: ${SYMBOLS.length * TIMEFRAMES.length}`);
  console.log('═'.repeat(80) + '\n');

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing Supabase credentials in .env file');
    console.error('   Required: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY');
    process.exit(1);
  }

  // Initialize data sources (priority order)
  const yahooSource = new YahooFinanceSource();
  yahooSource.priority = 100;

  const twelveSource = new TwelveDataSource(process.env.TWELVE_DATA_API_KEY);
  twelveSource.priority = 90;

  const fcsSource = new FCSAPISource(process.env.FCSAPI_KEY);
  fcsSource.priority = 80;

  const polygonSource = new PolygonSource(process.env.POLYGON_API_KEY);
  polygonSource.priority = 70;

  const dataFetcher = new MultiSourceFetcher([yahooSource, twelveSource, fcsSource, polygonSource]);

  // Initialize orchestrator
  const orchestrator = new BackfillOrchestrator(SUPABASE_URL, SUPABASE_KEY, dataFetcher);

  const results = {
    total: 0,
    completed: 0,
    failed: 0,
    totalInserted: 0,
    totalRejected: 0,
  };

  // Process each symbol/timeframe combination
  for (const symbol of SYMBOLS) {
    for (const timeframe of TIMEFRAMES) {
      results.total++;

      const result = await orchestrator.backfillSymbolTimeframe(
        symbol,
        timeframe,
        ONE_YEAR_AGO,
        TODAY
      );

      if (result.success) {
        results.completed++;
      } else {
        results.failed++;
      }

      results.totalInserted += result.inserted;
      results.totalRejected += result.rejected;

      // Progress update
      console.log(`\n📊 Progress: ${results.completed + results.failed}/${results.total} tasks`);
      console.log(`   ✅ Completed: ${results.completed}`);
      console.log(`   ❌ Failed: ${results.failed}`);
      console.log(`   📈 Total candles inserted: ${results.totalInserted.toLocaleString()}`);
      console.log(`   🚫 Total candles rejected: ${results.totalRejected.toLocaleString()}\n`);

      // Small delay between tasks to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // Final summary
  console.log('\n' + '═'.repeat(80));
  console.log('🎉 BACKFILL COMPLETE');
  console.log('═'.repeat(80));
  console.log(`Total tasks: ${results.total}`);
  console.log(`✅ Completed: ${results.completed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`📈 Total candles inserted: ${results.totalInserted.toLocaleString()}`);
  console.log(`🚫 Total candles rejected: ${results.totalRejected.toLocaleString()}`);
  console.log(`📊 Success rate: ${((results.completed / results.total) * 100).toFixed(1)}%`);
  console.log(`📊 Validation rate: ${((results.totalInserted / (results.totalInserted + results.totalRejected)) * 100).toFixed(1)}%`);
  console.log('═'.repeat(80) + '\n');

  // Get final status from database
  console.log('📋 Fetching final status from database...\n');
  const status = await orchestrator.getBackfillStatus();

  // Group by symbol
  const bySymbol = {};
  status.forEach(record => {
    if (!bySymbol[record.symbol]) {
      bySymbol[record.symbol] = {
        symbol: record.symbol,
        timeframes: [],
        totalCandles: 0,
      };
    }
    bySymbol[record.symbol].timeframes.push({
      timeframe: record.timeframe,
      status: record.status,
      candles: record.candles_inserted,
    });
    bySymbol[record.symbol].totalCandles += record.candles_inserted || 0;
  });

  console.log('📊 Backfill Status by Symbol:\n');
  Object.values(bySymbol).forEach(item => {
    console.log(`${item.symbol}:`);
    console.log(`   Total candles: ${item.totalCandles.toLocaleString()}`);
    console.log(`   Timeframes: ${item.timeframes.length}`);
    item.timeframes.forEach(tf => {
      const statusIcon = tf.status === 'completed' ? '✅' : tf.status === 'running' ? '🔄' : '❌';
      console.log(`      ${statusIcon} ${tf.timeframe}: ${(tf.candles || 0).toLocaleString()} candles`);
    });
    console.log('');
  });

  console.log('🎊 Backfill execution complete!');
  console.log('💡 Charts should now display historical data for all pairs and timeframes.\n');

  process.exit(0);
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error('\n❌ Unhandled error:', error);
  process.exit(1);
});

// Run
main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
