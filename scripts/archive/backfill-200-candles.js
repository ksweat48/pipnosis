#!/usr/bin/env node

/**
 * 200-Candle Backfill Script
 *
 * Fetches exactly 200 historical candles per timeframe for all 5 symbols
 * using free Yahoo Finance API (no authentication required).
 *
 * Usage: node scripts/backfill-200-candles.js
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Error: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const SYMBOLS = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30'];
const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'];

// Yahoo Finance symbol mapping
const YAHOO_SYMBOLS = {
  'EURUSD': 'EURUSD=X',
  'GBPUSD': 'GBPUSD=X',
  'USDJPY': 'USDJPY=X',
  'XAUUSD': 'GC=F',
  'US30': 'YM=F'
};

// Timeframe interval mapping
const INTERVALS = {
  'M1': { yahoo: '1m', minutes: 1, maxDays: 7 },
  'M5': { yahoo: '5m', minutes: 5, maxDays: 7 },
  'M15': { yahoo: '15m', minutes: 15, maxDays: 7 },
  'M30': { yahoo: '30m', minutes: 30, maxDays: 7 },
  'H1': { yahoo: '1h', minutes: 60, maxDays: 30 },
  'H4': { yahoo: '1h', minutes: 240, maxDays: 60 },
  'D1': { yahoo: '1d', minutes: 1440, maxDays: 365 },
  'W1': { yahoo: '1wk', minutes: 10080, maxDays: 730 }
};

// Calculate days needed for 200 candles
function calculateDaysForCandles(timeframe, targetCandles = 200) {
  const interval = INTERVALS[timeframe];
  const candlesPerDay = (24 * 60) / interval.minutes;
  const daysNeeded = Math.ceil(targetCandles / candlesPerDay);
  return Math.min(daysNeeded, interval.maxDays);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchYahooCandles(symbol, timeframe, daysBack) {
  const yahooSymbol = YAHOO_SYMBOLS[symbol];
  if (!yahooSymbol) {
    console.log(`  ⚠️  ${symbol} not available on Yahoo Finance`);
    return null;
  }

  const interval = INTERVALS[timeframe].yahoo;
  const now = Math.floor(Date.now() / 1000);
  const period1 = now - (daysBack * 24 * 60 * 60);

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=${interval}&period1=${period1}&period2=${now}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      console.log(`  ❌ Yahoo Finance error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const result = data.chart?.result?.[0];

    if (!result) {
      console.log(`  ⚠️  No data from Yahoo Finance`);
      return null;
    }

    const timestamps = result.timestamp;
    const quotes = result.indicators.quote[0];

    if (!timestamps || !quotes) {
      console.log(`  ⚠️  Invalid Yahoo Finance data structure`);
      return null;
    }

    const candles = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (quotes.open[i] && quotes.high[i] && quotes.low[i] && quotes.close[i]) {
        candles.push({
          timestamp: timestamps[i],
          open: quotes.open[i],
          high: quotes.high[i],
          low: quotes.low[i],
          close: quotes.close[i],
          volume: quotes.volume[i] || 0
        });
      }
    }

    // Return last 200 candles
    return candles.slice(-200);
  } catch (error) {
    console.log(`  ❌ Error: ${error.message}`);
    return null;
  }
}

async function insertCandles(symbol, timeframe, candles) {
  if (!candles || candles.length === 0) {
    return 0;
  }

  const intervalMinutes = INTERVALS[timeframe].minutes;
  const records = candles.map(candle => {
    const openTime = new Date(candle.timestamp * 1000);
    const closeTime = new Date(openTime.getTime() + intervalMinutes * 60 * 1000);

    return {
      symbol,
      timeframe,
      open_time: openTime.toISOString(),
      close_time: closeTime.toISOString(),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      data_source: 'yahoo_finance'
    };
  });

  // Insert in batches
  const batchSize = 500;
  let inserted = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    const { error } = await supabase
      .from('forex_candles')
      .upsert(batch, {
        onConflict: 'symbol,timeframe,open_time',
        ignoreDuplicates: false
      });

    if (!error) {
      inserted += batch.length;
    }
  }

  return inserted;
}

async function backfillSymbolTimeframe(symbol, timeframe) {
  const daysBack = calculateDaysForCandles(timeframe, 200);

  console.log(`\n📊 ${symbol} ${timeframe} (fetching ${daysBack} days for ~200 candles)...`);

  const candles = await fetchYahooCandles(symbol, timeframe, daysBack);

  if (!candles) {
    console.log(`  ❌ Failed to fetch candles`);
    return { symbol, timeframe, fetched: 0, inserted: 0, status: 'failed' };
  }

  console.log(`  ✅ Fetched ${candles.length} candles`);

  const inserted = await insertCandles(symbol, timeframe, candles);
  console.log(`  💾 Inserted ${inserted} candles`);

  return {
    symbol,
    timeframe,
    fetched: candles.length,
    inserted,
    status: inserted > 0 ? 'success' : 'failed'
  };
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║       200-Candle Historical Backfill (Yahoo Finance)          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log('🎯 Target: 200 candles per timeframe');
  console.log(`📈 Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`⏱️  Timeframes: ${TIMEFRAMES.join(', ')}\n`);

  const startTime = Date.now();
  const results = [];

  for (const symbol of SYMBOLS) {
    for (const timeframe of TIMEFRAMES) {
      const result = await backfillSymbolTimeframe(symbol, timeframe);
      results.push(result);
      await sleep(1000); // Rate limiting
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  const totalFetched = results.reduce((sum, r) => sum + r.fetched, 0);
  const totalInserted = results.reduce((sum, r) => sum + r.inserted, 0);
  const successful = results.filter(r => r.status === 'success').length;

  console.log('\n' + '='.repeat(70));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(70));
  console.log(`Duration: ${duration}s`);
  console.log(`Total fetched: ${totalFetched.toLocaleString()} candles`);
  console.log(`Total inserted: ${totalInserted.toLocaleString()} candles`);
  console.log(`Success rate: ${successful}/${results.length} (${((successful/results.length)*100).toFixed(1)}%)`);

  console.log('\n📋 Detailed Results:\n');
  results.forEach(r => {
    const status = r.status === 'success' ? '✅' : '❌';
    console.log(`  ${status} ${r.symbol.padEnd(8)} ${r.timeframe.padEnd(4)} - Fetched: ${r.fetched.toString().padStart(3)}, Inserted: ${r.inserted.toString().padStart(3)}`);
  });

  console.log('\n✅ Backfill process complete!');
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
