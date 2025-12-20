#!/usr/bin/env node

/**
 * Batch Historical Backfill
 * Fills the last 24 hours of candles for all symbols and timeframes
 */

const FUNCTION_URL = 'https://pipnosis.com/.netlify/functions/historical-backfill';
const SYMBOLS = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30'];
const TIMEFRAMES = ['M5', 'M15', 'H1', 'H4'];
const DAYS_BACK = 1; // 24 hours
const DELAY_BETWEEN_CALLS = 2000; // 2 seconds to avoid rate limiting

async function backfillSymbolTimeframe(symbol, timeframe) {
  console.log(`\n📊 Backfilling ${symbol} ${timeframe}...`);

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        symbol,
        timeframe,
        daysBack: DAYS_BACK,
        dryRun: false
      })
    });

    const data = await response.json();

    if (response.ok && data.success) {
      console.log(`✅ ${symbol} ${timeframe}: Inserted ${data.candlesInserted} candles (skipped ${data.candlesSkipped})`);
      return { symbol, timeframe, success: true, inserted: data.candlesInserted, skipped: data.candlesSkipped };
    } else {
      console.error(`❌ ${symbol} ${timeframe}: ${data.error || data.message}`);
      return { symbol, timeframe, success: false, error: data.error || data.message };
    }
  } catch (error) {
    console.error(`❌ ${symbol} ${timeframe}: ${error.message}`);
    return { symbol, timeframe, success: false, error: error.message };
  }
}

async function batchBackfill() {
  console.log('🚀 Starting batch historical backfill for last 24 hours...');
  console.log(`📈 Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`⏱️  Timeframes: ${TIMEFRAMES.join(', ')}`);
  console.log(`📅 Period: ${DAYS_BACK} day(s) back\n`);

  const results = [];
  let totalInserted = 0;
  let totalSkipped = 0;
  let successCount = 0;
  let failureCount = 0;

  for (const symbol of SYMBOLS) {
    for (const timeframe of TIMEFRAMES) {
      const result = await backfillSymbolTimeframe(symbol, timeframe);
      results.push(result);

      if (result.success) {
        successCount++;
        totalInserted += result.inserted || 0;
        totalSkipped += result.skipped || 0;
      } else {
        failureCount++;
      }

      // Delay between calls to respect rate limits
      if (symbol !== SYMBOLS[SYMBOLS.length - 1] || timeframe !== TIMEFRAMES[TIMEFRAMES.length - 1]) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CALLS));
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 BACKFILL SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Successful: ${successCount}/${SYMBOLS.length * TIMEFRAMES.length}`);
  console.log(`❌ Failed: ${failureCount}`);
  console.log(`📥 Total Candles Inserted: ${totalInserted}`);
  console.log(`⏭️  Total Candles Skipped: ${totalSkipped}`);
  console.log('='.repeat(60));

  // Show failures if any
  const failures = results.filter(r => !r.success);
  if (failures.length > 0) {
    console.log('\n⚠️  FAILED BACKFILLS:');
    failures.forEach(f => {
      console.log(`   ${f.symbol} ${f.timeframe}: ${f.error}`);
    });
  }

  console.log('\n✅ Batch backfill complete!');
}

batchBackfill().catch(console.error);
