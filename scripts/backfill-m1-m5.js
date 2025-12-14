#!/usr/bin/env node

/**
 * Manual M1 and M5 Historical Backfill Script
 *
 * This script triggers historical backfill for M1 and M5 timeframes
 * to ensure they have sufficient data for chart display.
 *
 * Uses Dukascopy's FREE data to backfill with proper OHLC candles including wicks.
 *
 * Run: node scripts/backfill-m1-m5.js
 */

import dotenv from 'dotenv';
dotenv.config();

const SYMBOLS = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30'];
const M1_DAYS = 10;  // 10 days of M1 data
const M5_DAYS = 30;  // 30 days of M5 data

const ADMIN_KEY = process.env.ADMIN_REFRESH_KEY;
const SITE_URL = process.env.VITE_NETLIFY_SITE_URL || 'https://pipnosis.netlify.app';

async function backfillTimeframe(symbol, timeframe, daysBack) {
  console.log(`\n📊 Backfilling ${symbol} ${timeframe} (${daysBack} days)...`);

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  console.log(`   Range: ${startDate.toISOString().split('T')[0]} → ${endDate.toISOString().split('T')[0]}`);

  try {
    const response = await fetch(`${SITE_URL}/.netlify/functions/dukascopy-historical-backfill`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        symbol,
        timeframe,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        overwrite: false,  // Don't delete existing data, just fill gaps
        adminKey: ADMIN_KEY
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Failed: ${response.status} - ${errorText}`);
      return false;
    }

    const result = await response.json();
    console.log(`✅ Success:`);
    console.log(`   Fetched: ${result.candlesFetched || 0}`);
    console.log(`   Inserted: ${result.candlesInserted || 0}`);
    console.log(`   Skipped: ${result.candlesSkipped || 0}`);
    console.log(`   Duration: ${((result.duration || 0) / 1000).toFixed(2)}s`);
    return true;
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🚀 Starting M1 and M5 Historical Backfill via Dukascopy...\n');
  console.log(`Site URL: ${SITE_URL}`);
  console.log(`Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`M1: ${M1_DAYS} days back (~${M1_DAYS * 1440} candles per symbol)`);
  console.log(`M5: ${M5_DAYS} days back (~${M5_DAYS * 288} candles per symbol)`);
  console.log(`Mode: Gap-fill (overwrite=false, preserves existing data)\n`);

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
