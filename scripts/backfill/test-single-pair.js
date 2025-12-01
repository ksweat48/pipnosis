#!/usr/bin/env node

/**
 * Test backfill with a single pair to verify everything works
 * Run this BEFORE the full backfill to ensure charts display data correctly
 */

const {
  YahooFinanceSource,
  TwelveDataSource,
  MultiSourceFetcher,
} = require('./data-sources');
const { BackfillOrchestrator } = require('./backfill-orchestrator');
require('dotenv').config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

// Test with EURUSD on 1-hour timeframe (reasonable amount of data)
const TEST_SYMBOL = 'EURUSD';
const TEST_TIMEFRAME = '1h';

// Last 7 days for quick test
const START_DATE = new Date();
START_DATE.setDate(START_DATE.getDate() - 7);
const END_DATE = new Date();

async function main() {
  console.log('\n' + '═'.repeat(80));
  console.log('🧪 TEST BACKFILL - Single Pair Verification');
  console.log('═'.repeat(80));
  console.log(`Symbol: ${TEST_SYMBOL}`);
  console.log(`Timeframe: ${TEST_TIMEFRAME}`);
  console.log(`Start: ${START_DATE.toISOString().split('T')[0]}`);
  console.log(`End: ${END_DATE.toISOString().split('T')[0]}`);
  console.log('═'.repeat(80) + '\n');

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing Supabase credentials');
    process.exit(1);
  }

  // Initialize data sources
  const sources = [
    { source: new YahooFinanceSource(), priority: 100 },
    { source: new TwelveDataSource(process.env.TWELVE_DATA_API_KEY), priority: 90 },
  ];

  const dataFetcher = new MultiSourceFetcher(sources.map(s => ({ ...s.source, priority: s.priority })));
  const orchestrator = new BackfillOrchestrator(SUPABASE_URL, SUPABASE_KEY, dataFetcher);

  // Run test backfill
  const result = await orchestrator.backfillSymbolTimeframe(
    TEST_SYMBOL,
    TEST_TIMEFRAME,
    START_DATE,
    END_DATE
  );

  console.log('\n' + '═'.repeat(80));
  console.log('📊 TEST RESULTS');
  console.log('═'.repeat(80));
  console.log(`Success: ${result.success ? '✅ YES' : '❌ NO'}`);
  console.log(`Candles inserted: ${result.inserted}`);
  console.log(`Candles rejected: ${result.rejected}`);
  console.log(`Duration: ${(result.duration / 1000).toFixed(2)}s`);
  console.log('═'.repeat(80) + '\n');

  if (result.success && result.inserted > 0) {
    console.log('✅ TEST PASSED!');
    console.log('💡 Next steps:');
    console.log('   1. Open the app and navigate to the chart');
    console.log('   2. Select EURUSD pair and 1h timeframe');
    console.log('   3. Verify you can see historical candles from the last 7 days');
    console.log('   4. If candles are visible, run full backfill: npm run backfill\n');
  } else {
    console.log('❌ TEST FAILED!');
    console.log('⚠️  Check the errors above and fix before running full backfill\n');
  }

  process.exit(result.success ? 0 : 1);
}

main().catch(error => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
