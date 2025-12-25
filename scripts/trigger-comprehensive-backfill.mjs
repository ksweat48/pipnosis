import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const ADMIN_KEY = process.env.ADMIN_REFRESH_KEY;
const BASE_URL = process.env.NETLIFY_FUNCTION_URL || 'https://pipnosis.netlify.app/.netlify/functions';

const NEW_PAIRS = ['GBPJPY', 'EURJPY', 'AUDUSD', 'NZDUSD'];
const ALL_TIMEFRAMES = ['M1', 'M5', 'M15', 'H1', 'H4', 'D1', 'W1'];

async function triggerBackfill(symbols = NEW_PAIRS, timeframes = ALL_TIMEFRAMES) {
  console.log('\n========================================');
  console.log('TRIGGERING COMPREHENSIVE BACKFILL');
  console.log('========================================');
  console.log(`Symbols: ${symbols.join(', ')}`);
  console.log(`Timeframes: ${timeframes.join(', ')}`);
  console.log(`Total operations: ${symbols.length * timeframes.length}`);
  console.log('========================================\n');

  try {
    const response = await axios.post(
      `${BASE_URL}/backfill-all-timeframes-new-pairs`,
      {
        adminKey: ADMIN_KEY,
        symbols,
        timeframes
      },
      {
        timeout: 900000,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('\n========================================');
    console.log('BACKFILL RESPONSE');
    console.log('========================================');
    console.log(JSON.stringify(response.data, null, 2));
    console.log('========================================\n');

    const { summary, results } = response.data;

    console.log('\nSUMMARY:');
    console.log(`- Total Operations: ${summary.totalOperations}`);
    console.log(`- Successful: ${summary.successfulOperations}`);
    console.log(`- Failed: ${summary.failedOperations}`);
    console.log(`- Total Candles Fetched: ${summary.totalCandlesFetched}`);
    console.log(`- Total Candles Inserted: ${summary.totalCandlesInserted}`);
    console.log(`- Duration: ${summary.duration}`);

    console.log('\nDETAILED RESULTS BY SYMBOL:');
    for (const symbol of symbols) {
      console.log(`\n${symbol}:`);
      const symbolResults = results.filter(r => r.symbol === symbol);
      for (const result of symbolResults) {
        const status = result.success ? '✓' : '✗';
        console.log(`  ${status} ${result.timeframe}: ${result.candlesInserted} candles (${(result.duration / 1000).toFixed(2)}s)`);
        if (result.error) {
          console.log(`    Error: ${result.error}`);
        }
      }
    }

    console.log('\n========================================');
    console.log('BACKFILL COMPLETED SUCCESSFULLY');
    console.log('========================================\n');

  } catch (error) {
    console.error('\n========================================');
    console.error('BACKFILL FAILED');
    console.error('========================================');
    if (axios.isAxiosError(error)) {
      console.error('Status:', error.response?.status);
      console.error('Error:', error.response?.data);
    } else {
      console.error('Error:', error.message);
    }
    console.error('========================================\n');
    process.exit(1);
  }
}

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: node scripts/trigger-comprehensive-backfill.mjs [options]

Options:
  --symbols SYMBOL1,SYMBOL2   Specify symbols to backfill (default: all new pairs)
  --timeframes TF1,TF2        Specify timeframes to backfill (default: all timeframes)
  --help, -h                  Show this help message

Examples:
  node scripts/trigger-comprehensive-backfill.mjs
  node scripts/trigger-comprehensive-backfill.mjs --symbols GBPJPY,EURJPY
  node scripts/trigger-comprehensive-backfill.mjs --timeframes M1,M5,M15
  node scripts/trigger-comprehensive-backfill.mjs --symbols GBPJPY --timeframes H1,H4,D1
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

triggerBackfill(symbols, timeframes);
