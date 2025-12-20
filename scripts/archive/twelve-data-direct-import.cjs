#!/usr/bin/env node

const https = require('https');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY;
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

const SYMBOL_MAP = {
  'EURUSD': 'EUR/USD',
  'GBPUSD': 'GBP/USD',
  'USDJPY': 'USD/JPY',
  'AUDUSD': 'AUD/USD',
  'USDCAD': 'USD/CAD',
  'USDCHF': 'USD/CHF',
  'NZDUSD': 'NZD/USD',
  'EURGBP': 'EUR/GBP',
  'EURJPY': 'EUR/JPY',
  'GBPJPY': 'GBP/JPY',
  'XAUUSD': 'XAU/USD'
};

const INTERVAL_MAP = {
  'M1': '1min',
  'M5': '5min',
  'M15': '15min',
  'M30': '30min',
  'H1': '1h',
  'H4': '4h',
  'D1': '1day',
  'W1': '1week'
};

const INTERVAL_SECONDS = {
  'M1': 60,
  'M5': 300,
  'M15': 900,
  'M30': 1800,
  'H1': 3600,
  'H4': 14400,
  'D1': 86400,
  'W1': 604800
};

function makeHttpsRequest(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    }).on('error', reject);
  });
}

async function fetchTwelveDataCandles(symbol, timeframe, startDate, endDate) {
  const twelveDataSymbol = SYMBOL_MAP[symbol] || symbol;
  const interval = INTERVAL_MAP[timeframe] || '15min';
  const intervalSeconds = INTERVAL_SECONDS[timeframe] || 900;

  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(twelveDataSymbol)}&interval=${interval}&start_date=${startDateStr}&end_date=${endDateStr}&apikey=${TWELVE_DATA_API_KEY}&outputsize=5000&format=JSON`;

  console.log(`   Fetching from Twelve Data API...`);

  const response = await makeHttpsRequest(url);

  if (response.status === 'error') {
    throw new Error(`Twelve Data API error: ${JSON.stringify(response)}`);
  }

  if (!response.values || response.values.length === 0) {
    console.log(`   No candles returned`);
    return [];
  }

  const candles = [];
  for (const candle of response.values) {
    const openTime = new Date(candle.datetime);
    const closeTime = new Date(openTime.getTime() + intervalSeconds * 1000);

    const open = parseFloat(candle.open);
    const high = parseFloat(candle.high);
    const low = parseFloat(candle.low);
    const close = parseFloat(candle.close);
    const volume = candle.volume ? parseFloat(candle.volume) : 0;

    if (high < low || open <= 0 || high <= 0 || low <= 0 || close <= 0) {
      continue;
    }

    candles.push({
      symbol,
      timeframe,
      open_time: openTime.toISOString(),
      close_time: closeTime.toISOString(),
      open,
      high,
      low,
      close,
      volume,
      data_source: 'twelve_data_import'
    });
  }

  console.log(`   Successfully fetched ${candles.length} candles`);
  return candles;
}

async function importSymbolTimeframe(symbol, timeframe) {
  const endDate = new Date();
  const days = TIMEFRAME_DAYS[timeframe] || 30;
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Importing ${symbol} ${timeframe} (~${days} days)`);
  console.log(`Date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
  console.log('='.repeat(80));

  try {
    const candles = await fetchTwelveDataCandles(symbol, timeframe, startDate, endDate);

    if (candles.length === 0) {
      console.log(`✅ Complete (no data available)`);
      return { success: true, inserted: 0, skipped: 0 };
    }

    console.log(`   Inserting ${candles.length} candles into database...`);

    const BATCH_SIZE = 500;
    let totalInserted = 0;
    let totalSkipped = 0;

    for (let i = 0; i < candles.length; i += BATCH_SIZE) {
      const batch = candles.slice(i, i + BATCH_SIZE);

      const { data, error } = await supabase
        .from('forex_candles')
        .upsert(batch, {
          onConflict: 'symbol,timeframe,open_time',
          ignoreDuplicates: false
        })
        .select('id');

      if (error) {
        console.error(`   Batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, error.message);
        totalSkipped += batch.length;
      } else {
        const inserted = data?.length || 0;
        totalInserted += inserted;
        totalSkipped += batch.length - inserted;
        console.log(`   Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${inserted} inserted`);
      }
    }

    console.log(`✅ SUCCESS: ${symbol} ${timeframe}`);
    console.log(`   Inserted: ${totalInserted}`);
    console.log(`   Skipped: ${totalSkipped}`);

    return { success: true, inserted: totalInserted, skipped: totalSkipped };

  } catch (error) {
    console.log(`❌ FAILED: ${symbol} ${timeframe}`);
    console.log(`   Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function runFullBackfill() {
  console.log('\n');
  console.log('╔' + '═'.repeat(78) + '╗');
  console.log('║' + ' '.repeat(18) + 'TWELVE DATA DIRECT IMPORT' + ' '.repeat(35) + '║');
  console.log('║' + ' '.repeat(18) + '30-Day Historical Backfill' + ' '.repeat(34) + '║');
  console.log('╚' + '═'.repeat(78) + '╝');
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
  let totalInserted = 0;

  const symbolsToProcess = targetSymbol ? [targetSymbol] : SYMBOLS;
  const timeframesToProcess = targetTimeframe ? [targetTimeframe] : TIMEFRAMES;

  let apiCallCount = 0;

  for (const symbol of symbolsToProcess) {
    for (const timeframe of timeframesToProcess) {
      if (apiCallCount > 0 && apiCallCount % 7 === 0) {
        console.log('\n⏳ Rate limit protection: Waiting 60 seconds...\n');
        await new Promise(resolve => setTimeout(resolve, 60000));
      }

      const result = await importSymbolTimeframe(symbol, timeframe);
      results.push({ symbol, timeframe, ...result });
      apiCallCount++;

      if (result.success) {
        successCount++;
        totalInserted += result.inserted || 0;
      } else {
        failureCount++;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log('\n');
  console.log('╔' + '═'.repeat(78) + '╗');
  console.log('║' + ' '.repeat(27) + 'IMPORT SUMMARY' + ' '.repeat(37) + '║');
  console.log('╚' + '═'.repeat(78) + '╝');
  console.log('\n');

  console.log(`✅ Successful: ${successCount}`);
  console.log(`❌ Failed: ${failureCount}`);
  console.log(`📊 Total: ${results.length}`);
  console.log('');

  if (failureCount > 0) {
    console.log('Failed imports:');
    results
      .filter(r => !r.success)
      .forEach(r => {
        console.log(`  ❌ ${r.symbol} ${r.timeframe}: ${r.error}`);
      });
    console.log('');
  }

  console.log(`🎉 Total candles inserted: ${totalInserted}`);
  console.log('');
}

if (!TWELVE_DATA_API_KEY) {
  console.error('❌ ERROR: TWELVE_DATA_API_KEY not found in environment variables');
  process.exit(1);
}

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ ERROR: Supabase credentials not found in environment variables');
  process.exit(1);
}

runFullBackfill().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
