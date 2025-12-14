#!/usr/bin/env node

const https = require('https');
require('dotenv').config();

const NETLIFY_SITE_URL = process.env.VITE_NETLIFY_SITE_URL || 'https://pipnosis.com';
const ADMIN_KEY = process.env.ADMIN_REFRESH_KEY;

const SYMBOLS = ['EURUSD', 'GBPUSD', 'XAUUSD'];
const TIMEFRAMES = ['M15', 'M30', 'H1', 'H4', 'D1', 'W1'];

const TIMEFRAME_DAYS = {
  M15: 7,
  M30: 14,
  H1: 30,
  H4: 90,
  D1: 365,
  W1: 730
};

function makeRequest(url, postData) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ statusCode: res.statusCode, data: parsed });
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

async function backfillSymbolTimeframe(symbol, timeframe) {
  const endDate = new Date();
  const days = TIMEFRAME_DAYS[timeframe] || 30;
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  const startDateStr = startDate.toISOString();
  const endDateStr = endDate.toISOString();

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Backfilling ${symbol} ${timeframe} - ${timeframe} candles (~${days} days)`);
  console.log(`Date range: ${startDateStr.split('T')[0]} to ${endDateStr.split('T')[0]}`);
  console.log('='.repeat(80));
  console.log('');

  const url = `${NETLIFY_SITE_URL}/.netlify/functions/twelve-data-import`;
  const payload = {
    symbol,
    timeframe,
    startDate: startDateStr,
    endDate: endDateStr,
    overwrite: true,
    adminKey: ADMIN_KEY
  };

  try {
    const { statusCode, data } = await makeRequest(url, JSON.stringify(payload));

    if (statusCode === 200 && data.success) {
      console.log(`✅ SUCCESS: ${symbol} ${timeframe}`);
      console.log(`   Fetched: ${data.candlesFetched}`);
      console.log(`   Inserted: ${data.candlesInserted}`);
      console.log(`   Skipped: ${data.candlesSkipped}`);
      console.log(`   Deleted: ${data.candlesDeleted}`);
      console.log(`   Duration: ${data.duration}ms`);
      return { success: true, data };
    } else {
      console.log(`❌ FAILED: ${symbol} ${timeframe}`);
      console.log(`   Error: ${data.error || 'Unknown error'}`);
      console.log(`   Status: ${statusCode}`);
      console.log(`   Data:`, JSON.stringify(data, null, 2));
      return { success: false, error: data.error || 'Unknown error' };
    }
  } catch (error) {
    console.log(`❌ FAILED: ${symbol} ${timeframe}`);
    console.log(`   Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function runBackfill() {
  console.log('\n');
  console.log('╔' + '═'.repeat(78) + '╗');
  console.log('║' + ' '.repeat(18) + 'TWELVE DATA COMPREHENSIVE BACKFILL' + ' '.repeat(26) + '║');
  console.log('║' + ' '.repeat(18) + 'Native OHLC Data with Full Wicks' + ' '.repeat(28) + '║');
  console.log('╚' + '═'.repeat(78) + '╝');
  console.log('\n');

  console.log(`Target URL: ${NETLIFY_SITE_URL}/.netlify/functions/twelve-data-import`);
  console.log(`Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`Timeframes: ${TIMEFRAMES.join(', ')}`);
  console.log('\n');

  const targetSymbol = process.argv[2];
  const targetTimeframe = process.argv[3];

  if (targetSymbol) {
    console.log(`🎯 Targeting specific symbol: ${targetSymbol}`);
  }
  if (targetTimeframe) {
    console.log(`🎯 Targeting specific timeframe: ${targetTimeframe}`);
  }

  const results = [];
  let successCount = 0;
  let failureCount = 0;
  let totalCandlesInserted = 0;

  const symbolsToProcess = targetSymbol ? [targetSymbol] : SYMBOLS;
  const timeframesToProcess = targetTimeframe ? [targetTimeframe] : TIMEFRAMES;

  for (const symbol of symbolsToProcess) {
    for (const timeframe of timeframesToProcess) {
      const result = await backfillSymbolTimeframe(symbol, timeframe);
      results.push({ symbol, timeframe, ...result });

      if (result.success) {
        successCount++;
        totalCandlesInserted += result.data.candlesInserted;
      } else {
        failureCount++;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log('\n');
  console.log('╔' + '═'.repeat(78) + '╗');
  console.log('║' + ' '.repeat(27) + 'BACKFILL SUMMARY' + ' '.repeat(35) + '║');
  console.log('╚' + '═'.repeat(78) + '╝');
  console.log('\n');

  console.log(`✅ Successful: ${successCount}`);
  console.log(`❌ Failed: ${failureCount}`);
  console.log(`📊 Total: ${results.length}`);
  console.log('');

  if (failureCount > 0) {
    console.log('Failed backfills:');
    results
      .filter(r => !r.success)
      .forEach(r => {
        console.log(`  ❌ ${r.symbol} ${r.timeframe}: ${r.error}`);
      });
    console.log('');
  }

  console.log(`🎉 Total candles inserted: ${totalCandlesInserted}`);
  console.log('');
}

if (!ADMIN_KEY) {
  console.error('❌ ERROR: ADMIN_REFRESH_KEY not found in environment variables');
  process.exit(1);
}

runBackfill().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
