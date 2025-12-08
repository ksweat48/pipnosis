/**
 * Trigger Historical Backfill Locally
 *
 * This script calls your deployed Netlify function to backfill historical candles.
 *
 * Usage:
 *   node scripts/trigger-backfill-local.js XAUUSD M5 14
 *
 * Arguments:
 *   - symbol: XAUUSD, EURUSD, GBPUSD, USDJPY, US30
 *   - timeframe: M1, M5, M15, M30, H1, H4, D1, W1
 *   - daysBack: Number of days to backfill (1-90)
 */

const https = require('https');

// Configuration - UPDATE THIS WITH YOUR NETLIFY DOMAIN!
const NETLIFY_DOMAIN = process.env.NETLIFY_DOMAIN || 'your-app-name.netlify.app';

// Parse command line arguments
const symbol = process.argv[2] || 'XAUUSD';
const timeframe = process.argv[3] || 'M5';
const daysBack = parseInt(process.argv[4] || '14');

console.log('🚀 Historical Backfill Trigger\n');
console.log(`📊 Symbol: ${symbol}`);
console.log(`⏰ Timeframe: ${timeframe}`);
console.log(`📅 Days back: ${daysBack}`);
console.log(`🌐 Domain: ${NETLIFY_DOMAIN}\n`);

const requestData = JSON.stringify({
  symbol,
  timeframe,
  daysBack,
  dryRun: false
});

const options = {
  hostname: NETLIFY_DOMAIN,
  port: 443,
  path: '/.netlify/functions/historical-backfill',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(requestData)
  }
};

console.log('📡 Sending request...\n');

const req = https.request(options, (res) => {
  let responseBody = '';

  res.on('data', (chunk) => {
    responseBody += chunk;
  });

  res.on('end', () => {
    console.log(`Status: ${res.statusCode}\n`);

    try {
      const result = JSON.parse(responseBody);

      if (result.success) {
        console.log('✅ SUCCESS!\n');
        console.log(`📈 Candles inserted: ${result.candlesInserted}`);
        console.log(`⏭️  Candles skipped: ${result.candlesSkipped}`);
        console.log(`🔌 API calls made: ${result.apiCallsMade}`);
        console.log(`⏱️  Duration: ${result.durationMs}ms`);
        console.log(`🆔 Execution ID: ${result.executionId}\n`);
        console.log('🎉 Your chart now has historical data with full OHLC wicks!');
      } else {
        console.log('❌ FAILED\n');
        console.log('Error:', result.error || 'Unknown error');
        if (result.errors && result.errors.length > 0) {
          console.log('\nErrors:');
          result.errors.forEach((err, i) => {
            console.log(`  ${i + 1}. ${err}`);
          });
        }
      }
    } catch (error) {
      console.log('Raw response:', responseBody);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request failed:', error.message);
  console.log('\n💡 Tip: Make sure you have:');
  console.log('  1. Deployed your app to Netlify');
  console.log('  2. Updated NETLIFY_DOMAIN in this script or set env var');
  console.log('  3. All required environment variables in Netlify');
});

req.write(requestData);
req.end();
