#!/usr/bin/env node

/**
 * Manual M1 and M5 Historical Backfill Script
 *
 * This script triggers historical backfill for M1 and M5 timeframes
 * to ensure they have sufficient data for chart display.
 *
 * Run: node scripts/backfill-m1-m5.js
 */

const SYMBOLS = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30'];
const M1_DAYS = 7;
const M5_DAYS = 14;

async function backfillTimeframe(symbol, timeframe, daysBack) {
  console.log(`\n📊 Backfilling ${symbol} ${timeframe} (${daysBack} days)...`);

  try {
    const response = await fetch('https://pipnosis.netlify.app/.netlify/functions/historical-backfill', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        symbol,
        timeframe,
        daysBack,
        dryRun: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Failed: ${response.status} - ${errorText}`);
      return false;
    }

    const result = await response.json();
    console.log(`✅ Success: ${result.candlesInserted || 0} candles inserted`);
    return true;
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🚀 Starting M1 and M5 Historical Backfill...\n');
  console.log(`Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`M1: ${M1_DAYS} days back`);
  console.log(`M5: ${M5_DAYS} days back`);

  let successCount = 0;
  let failCount = 0;

  // Backfill M1 first
  console.log('\n📈 === M1 Timeframe ===');
  for (const symbol of SYMBOLS) {
    const success = await backfillTimeframe(symbol, 'M1', M1_DAYS);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }

    // Wait 3 seconds between requests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  // Then backfill M5
  console.log('\n📈 === M5 Timeframe ===');
  for (const symbol of SYMBOLS) {
    const success = await backfillTimeframe(symbol, 'M5', M5_DAYS);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }

    // Wait 2 seconds between requests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('\n' + '='.repeat(50));
  console.log(`✅ Successful: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log('='.repeat(50));

  if (successCount > 0) {
    console.log('\n✨ M1 and M5 historical data has been backfilled!');
    console.log('Charts should now display historical candles.');
  }
}

main().catch(console.error);
