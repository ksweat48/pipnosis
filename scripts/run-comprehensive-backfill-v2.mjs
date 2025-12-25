import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const ADMIN_KEY = process.env.ADMIN_REFRESH_KEY;
const BASE_URL = process.env.NETLIFY_FUNCTION_URL || 'https://pipnosis.netlify.app/.netlify/functions';

const NEW_PAIRS = ['GBPJPY', 'EURJPY', 'AUDUSD', 'NZDUSD'];
const ALL_TIMEFRAMES = ['M1', 'M5', 'M15', 'H1', 'H4', 'D1', 'W1'];

const TIMEFRAME_DAYS_BACK = {
  'M1': 7,
  'M5': 14,
  'M15': 30,
  'H1': 90,
  'H4': 180,
  'D1': 730,
  'W1': 1825
};

async function backfillSingle(symbol, timeframe) {
  const daysBack = TIMEFRAME_DAYS_BACK[timeframe];
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - (daysBack * 24 * 60 * 60 * 1000));

  console.log(`\n🔄 Backfilling ${symbol} ${timeframe} (${daysBack} days)...`);

  try {
    const response = await axios.post(
      `${BASE_URL}/dukascopy-historical-backfill`,
      {
        symbol,
        timeframe,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        overwrite: false,
        adminKey: ADMIN_KEY
      },
      {
        timeout: 120000,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    const result = response.data;
    console.log(`✅ ${symbol} ${timeframe}: ${result.candlesInserted} candles in ${(result.duration / 1000).toFixed(2)}s`);
    return { success: true, ...result };

  } catch (error) {
    console.error(`❌ ${symbol} ${timeframe}: ${error.message}`);
    return {
      success: false,
      symbol,
      timeframe,
      error: error.message,
      candlesInserted: 0
    };
  }
}

async function runComprehensiveBackfill(symbols = NEW_PAIRS, timeframes = ALL_TIMEFRAMES) {
  console.log('\n========================================');
  console.log('COMPREHENSIVE BACKFILL STARTED');
  console.log('========================================');
  console.log(`Symbols: ${symbols.join(', ')}`);
  console.log(`Timeframes: ${timeframes.join(', ')}`);
  console.log(`Total operations: ${symbols.length * timeframes.length}`);
  console.log('========================================\n');

  const startTime = Date.now();
  const results = [];

  for (const symbol of symbols) {
    console.log(`\n📊 Starting ${symbol}...`);

    for (const timeframe of timeframes) {
      const result = await backfillSingle(symbol, timeframe);
      results.push(result);

      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  const successCount = results.filter(r => r.success).length;
  const totalCandles = results.reduce((sum, r) => sum + r.candlesInserted, 0);

  console.log('\n========================================');
  console.log('BACKFILL COMPLETED');
  console.log('========================================');
  console.log(`Duration: ${duration}s`);
  console.log(`Success Rate: ${successCount}/${results.length}`);
  console.log(`Total Candles Inserted: ${totalCandles}`);
  console.log('========================================\n');

  console.log('\nDETAILED RESULTS BY SYMBOL:');
  for (const symbol of symbols) {
    console.log(`\n${symbol}:`);
    const symbolResults = results.filter(r => r.symbol === symbol);
    for (const result of symbolResults) {
      const status = result.success ? '✅' : '❌';
      console.log(`  ${status} ${result.timeframe}: ${result.candlesInserted} candles`);
      if (result.error) {
        console.log(`    Error: ${result.error}`);
      }
    }
  }

  console.log('\n========================================\n');

  if (successCount < results.length) {
    console.error(`⚠️  ${results.length - successCount} operations failed!`);
    process.exit(1);
  }
}

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: node scripts/run-comprehensive-backfill-v2.mjs [options]

Options:
  --symbols SYMBOL1,SYMBOL2   Specify symbols to backfill (default: all new pairs)
  --timeframes TF1,TF2        Specify timeframes to backfill (default: all timeframes)
  --help, -h                  Show this help message

Examples:
  node scripts/run-comprehensive-backfill-v2.mjs
  node scripts/run-comprehensive-backfill-v2.mjs --symbols GBPJPY,EURJPY
  node scripts/run-comprehensive-backfill-v2.mjs --timeframes M1,M5,M15
  node scripts/run-comprehensive-backfill-v2.mjs --symbols GBPJPY --timeframes H1,H4,D1
  `);
  process.exit(0);
}

let symbols = NEW_PAIRS;
let timeframes = ALL_TIMEFRAMES;

const symbolsIndex = args.indexOf('--symbols');
if (symbolsIndex !== -1 && args[symbolsIndex + 1]) {
  symbols = args[symbolsIndex + 1].split(',');
}

const timeframesIndex = args.indexOf('--timeframes');
if (timeframesIndex !== -1 && args[timeframesIndex + 1]) {
  timeframes = args[timeframesIndex + 1].split(',');
}

runComprehensiveBackfill(symbols, timeframes);
