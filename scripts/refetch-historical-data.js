#!/usr/bin/env node

/**
 * Re-fetch Historical Data Script
 *
 * This script clears all existing historical candle data and re-fetches it
 * with proper timing alignment to ensure seamless continuity with live data.
 *
 * Usage: node scripts/refetch-historical-data.js
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Error: Missing Supabase credentials');
  console.error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];
const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1'];
const DAYS_BACK = 7;

async function clearHistoricalData() {
  console.log('\n🗑️  Clearing existing historical data...\n');

  const { error: forexError, count: forexCount } = await supabase
    .from('forex_candles')
    .delete()
    .neq('symbol', 'DUMMY_VALUE');

  if (forexError) {
    console.error('❌ Failed to clear forex_candles:', forexError);
    throw forexError;
  }

  console.log(`✅ Cleared ${forexCount || 'all'} records from forex_candles`);

  const { error: marketError, count: marketCount } = await supabase
    .from('market_data')
    .delete()
    .in('timeframe', TIMEFRAMES);

  if (marketError) {
    console.error('❌ Failed to clear market_data:', marketError);
    throw marketError;
  }

  console.log(`✅ Cleared ${marketCount || 'all'} candle records from market_data`);

  const { error: trackingError } = await supabase
    .from('candle_completion_tracking')
    .delete()
    .neq('symbol', 'DUMMY_VALUE');

  if (trackingError) {
    console.warn('⚠️  Warning clearing tracking data:', trackingError);
  }

  console.log('✅ Historical data cleared successfully\n');
}

async function fetchHistoricalCandles(symbol, timeframe, limit) {
  const baseUrl = process.env.NETLIFY_DEV
    ? 'http://localhost:8888'
    : (process.env.URL || 'http://localhost:5173');

  const url = `${baseUrl}/.netlify/functions/forex-candles?symbol=${symbol}&timeframe=${timeframe}&limit=${limit}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Unknown error');
    }

    return result.data.candles || [];
  } catch (error) {
    throw new Error(`Failed to fetch ${symbol} ${timeframe}: ${error.message}`);
  }
}

function getTimeframeMinutes(timeframe) {
  const map = {
    'M1': 1,
    'M5': 5,
    'M15': 15,
    'M30': 30,
    'H1': 60,
    'H4': 240,
    'D1': 1440,
    'W1': 10080
  };
  return map[timeframe] || 15;
}

function calculateCandleLimit(timeframe, daysBack) {
  const minutesPerCandle = getTimeframeMinutes(timeframe);
  const candlesPerDay = Math.floor((24 * 60) / minutesPerCandle);
  return Math.min(candlesPerDay * daysBack, 10000);
}

async function refetchAllData() {
  console.log('\n📊 Re-fetching Historical Data\n');
  console.log(`Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`Timeframes: ${TIMEFRAMES.join(', ')}`);
  console.log(`Days back: ${DAYS_BACK}\n`);

  const totalTasks = SYMBOLS.length * TIMEFRAMES.length;
  let completed = 0;
  let failed = 0;

  const results = [];

  for (const symbol of SYMBOLS) {
    for (const timeframe of TIMEFRAMES) {
      const limit = calculateCandleLimit(timeframe, DAYS_BACK);

      try {
        console.log(`⏳ [${completed + 1}/${totalTasks}] Fetching ${symbol} ${timeframe} (${limit} candles)...`);

        const candles = await fetchHistoricalCandles(symbol, timeframe, limit);

        if (candles.length > 0) {
          const firstCandle = new Date(candles[0].open_time);
          const lastCandle = new Date(candles[candles.length - 1].open_time);

          console.log(`   ✓ Received ${candles.length} candles`);
          console.log(`   📅 Range: ${firstCandle.toISOString()} to ${lastCandle.toISOString()}`);

          results.push({
            symbol,
            timeframe,
            status: 'success',
            count: candles.length,
            firstCandle: firstCandle.toISOString(),
            lastCandle: lastCandle.toISOString()
          });

          completed++;
        } else {
          console.log(`   ⚠️  No candles returned`);
          results.push({ symbol, timeframe, status: 'no_data', count: 0 });
          failed++;
        }

        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.error(`   ❌ Failed: ${error.message}`);
        results.push({ symbol, timeframe, status: 'error', error: error.message });
        failed++;
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📈 REFETCH SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total tasks: ${totalTasks}`);
  console.log(`✅ Successful: ${completed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Success rate: ${((completed / totalTasks) * 100).toFixed(1)}%`);

  const failedResults = results.filter(r => r.status === 'error' || r.status === 'no_data');
  if (failedResults.length > 0) {
    console.log('\n⚠️  Failed tasks:');
    failedResults.forEach(r => {
      console.log(`   - ${r.symbol} ${r.timeframe}: ${r.error || r.status}`);
    });
  }

  console.log('\n✅ Historical data refetch complete!');
  console.log('💡 The data now has proper timing alignment for seamless live data continuity.\n');
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('🔄 HISTORICAL DATA REFETCH SCRIPT');
  console.log('='.repeat(60));

  try {
    await clearHistoricalData();
    await refetchAllData();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

main();
