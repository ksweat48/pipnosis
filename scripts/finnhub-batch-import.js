import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const SYMBOLS = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30'];
const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

const DELAY_BETWEEN_CALLS_MS = 2500;

const NETLIFY_URL = process.env.VITE_SUPABASE_URL
  ? 'https://pipnosis.netlify.app'
  : 'http://localhost:8888';

const ADMIN_KEY = process.env.ADMIN_REFRESH_KEY;

if (!ADMIN_KEY || ADMIN_KEY === 'your_secure_admin_key_here') {
  console.error('❌ ERROR: ADMIN_REFRESH_KEY not set in .env file');
  console.error('Please set a valid admin key to authorize the import');
  process.exit(1);
}

function calculateDateRange(daysBack = 30) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - daysBack);

  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString()
  };
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function importData(symbol, timeframe, startDate, endDate, overwrite = true) {
  const url = `${NETLIFY_URL}/.netlify/functions/finnhub-import`;

  console.log(`\n📊 Importing ${symbol} ${timeframe}...`);
  console.log(`   Date range: ${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()}`);

  try {
    const response = await axios.post(url, {
      symbol,
      timeframe,
      startDate,
      endDate,
      overwrite,
      adminKey: ADMIN_KEY
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 120000
    });

    const result = response.data;

    if (!result.success && result.error) {
      console.error(`❌ Failed: ${result.error}`);
      return { success: false, ...result };
    }

    console.log(`✅ Success:`);
    console.log(`   Fetched: ${result.candlesFetched} candles`);
    console.log(`   Inserted: ${result.candlesInserted} candles`);
    console.log(`   Deleted: ${result.candlesDeleted} old candles`);
    console.log(`   Duration: ${(result.duration / 1000).toFixed(2)}s`);

    return result;

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function runFullImport(daysBack = 30, testMode = false) {
  const { startDate, endDate } = calculateDateRange(daysBack);

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║         FINNHUB HISTORICAL DATA IMPORT - BATCH MODE            ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`📅 Date Range: ${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()}`);
  console.log(`📊 Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`⏱️  Timeframes: ${TIMEFRAMES.join(', ')}`);
  console.log(`🔄 Overwrite Mode: ENABLED (will replace existing data)`);
  console.log(`🌐 Target: ${NETLIFY_URL}`);
  console.log();

  if (testMode) {
    console.log('🧪 TEST MODE: Only importing EURUSD M5 for 1 day');
    console.log();
    const testStart = new Date();
    testStart.setDate(testStart.getDate() - 1);
    const result = await importData('EURUSD', 'M5', testStart.toISOString(), endDate, true);
    console.log('\n✅ Test import completed');
    console.log('Run without --test flag to perform full 30-day import');
    return;
  }

  const totalCombinations = SYMBOLS.length * TIMEFRAMES.length;
  const estimatedMinutes = Math.ceil((totalCombinations * DELAY_BETWEEN_CALLS_MS) / 60000);

  console.log(`📈 Total combinations to import: ${totalCombinations}`);
  console.log(`⏰ Estimated time: ${estimatedMinutes}-${estimatedMinutes + 10} minutes`);
  console.log();
  console.log('Press Ctrl+C to cancel...');
  await sleep(3000);

  const results = {
    successful: 0,
    failed: 0,
    totalFetched: 0,
    totalInserted: 0,
    totalDeleted: 0,
    details: []
  };

  let completedCount = 0;

  for (const symbol of SYMBOLS) {
    for (const timeframe of TIMEFRAMES) {
      completedCount++;
      console.log(`\n[${completedCount}/${totalCombinations}] Processing ${symbol} ${timeframe}...`);

      const result = await importData(symbol, timeframe, startDate, endDate, true);

      results.details.push({
        symbol,
        timeframe,
        success: result.success,
        candlesFetched: result.candlesFetched || 0,
        candlesInserted: result.candlesInserted || 0,
        candlesDeleted: result.candlesDeleted || 0,
        error: result.error
      });

      if (result.success) {
        results.successful++;
        results.totalFetched += result.candlesFetched || 0;
        results.totalInserted += result.candlesInserted || 0;
        results.totalDeleted += result.candlesDeleted || 0;
      } else {
        results.failed++;
      }

      if (completedCount < totalCombinations) {
        const remainingTime = Math.ceil(((totalCombinations - completedCount) * DELAY_BETWEEN_CALLS_MS) / 60000);
        console.log(`⏳ Waiting ${DELAY_BETWEEN_CALLS_MS / 1000}s... (${remainingTime} min remaining)`);
        await sleep(DELAY_BETWEEN_CALLS_MS);
      }
    }
  }

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                     IMPORT COMPLETED                           ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`✅ Successful: ${results.successful}/${totalCombinations}`);
  console.log(`❌ Failed: ${results.failed}/${totalCombinations}`);
  console.log(`📊 Total Candles Fetched: ${results.totalFetched.toLocaleString()}`);
  console.log(`💾 Total Candles Inserted: ${results.totalInserted.toLocaleString()}`);
  console.log(`🗑️  Old Candles Deleted: ${results.totalDeleted.toLocaleString()}`);
  console.log();

  if (results.failed > 0) {
    console.log('⚠️  Failed imports:');
    results.details
      .filter(d => !d.success)
      .forEach(d => {
        console.log(`   ${d.symbol} ${d.timeframe}: ${d.error || 'Unknown error'}`);
      });
    console.log();
  }

  console.log('📊 Summary by Symbol:');
  SYMBOLS.forEach(symbol => {
    const symbolResults = results.details.filter(d => d.symbol === symbol);
    const symbolInserted = symbolResults.reduce((sum, d) => sum + d.candlesInserted, 0);
    const symbolSuccess = symbolResults.filter(d => d.success).length;
    console.log(`   ${symbol}: ${symbolInserted.toLocaleString()} candles (${symbolSuccess}/${TIMEFRAMES.length} timeframes)`);
  });

  console.log('\n✨ Import process complete!');
  console.log('📈 Your AI now has 30 days of accurate historical data for learning.');
}

const args = process.argv.slice(2);
const testMode = args.includes('--test');
const daysBack = parseInt(args.find(arg => arg.startsWith('--days='))?.split('=')[1] || '30', 10);

if (args.includes('--help')) {
  console.log('Finnhub Batch Import Tool');
  console.log();
  console.log('Usage: node finnhub-batch-import.js [options]');
  console.log();
  console.log('Options:');
  console.log('  --test          Run in test mode (EURUSD M5 for 1 day only)');
  console.log('  --days=N        Number of days to backfill (default: 30)');
  console.log('  --help          Show this help message');
  console.log();
  console.log('Examples:');
  console.log('  node finnhub-batch-import.js --test');
  console.log('  node finnhub-batch-import.js --days=7');
  console.log('  node finnhub-batch-import.js --days=30');
  process.exit(0);
}

runFullImport(daysBack, testMode).catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
