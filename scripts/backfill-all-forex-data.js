import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables:');
  console.error('VITE_SUPABASE_URL:', supabaseUrl ? '✅' : '❌');
  console.error('SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? '✅' : '❌');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const PAIRS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];
const TIMEFRAMES = [
  { name: 'M1', minutes: 1 },
  { name: 'M5', minutes: 5 },
  { name: 'M15', minutes: 15 },
  { name: 'M30', minutes: 30 },
  { name: 'H1', minutes: 60 },
  { name: 'H4', minutes: 240 },
  { name: 'D1', minutes: 1440 }
];

const RATE_LIMIT_DELAY = 2000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateSyntheticCandle(symbol, timeframe, timestamp) {
  const basePrice = {
    'XAUUSD': 2000 + Math.random() * 100,
    'US30': 35000 + Math.random() * 500,
    'EURUSD': 1.08 + Math.random() * 0.02,
    'GBPUSD': 1.26 + Math.random() * 0.02,
    'USDJPY': 148 + Math.random() * 2
  }[symbol];

  const volatility = Math.random() * 0.002;
  const open = basePrice;
  const high = open + (open * volatility);
  const low = open - (open * volatility);
  const close = low + Math.random() * (high - low);
  const volume = Math.floor(Math.random() * 10000) + 1000;

  const openTime = new Date(timestamp).toISOString();
  const closeTime = new Date(timestamp + (timeframe.minutes * 60 * 1000)).toISOString();

  return {
    symbol,
    timeframe: timeframe.name,
    open_time: openTime,
    close_time: closeTime,
    open: parseFloat(open.toFixed(5)),
    high: parseFloat(high.toFixed(5)),
    low: parseFloat(low.toFixed(5)),
    close: parseFloat(close.toFixed(5)),
    volume,
    data_source: 'synthetic_backfill'
  };
}

async function backfillPairTimeframe(symbol, timeframe) {
  console.log(`\n🔄 Starting backfill for ${symbol} ${timeframe.name}...`);

  const now = Date.now();
  const threeMonthsAgo = now - (90 * 24 * 60 * 60 * 1000);
  const intervalMs = timeframe.minutes * 60 * 1000;

  const candles = [];
  let timestamp = threeMonthsAgo;

  while (timestamp <= now) {
    const candle = await generateSyntheticCandle(symbol, timeframe, timestamp);
    candles.push(candle);
    timestamp += intervalMs;
  }

  console.log(`📊 Generated ${candles.length} candles for ${symbol} ${timeframe.name}`);

  const batchSize = 1000;
  let inserted = 0;

  for (let i = 0; i < candles.length; i += batchSize) {
    const batch = candles.slice(i, i + batchSize);

    const { error } = await supabase
      .from('forex_candles')
      .upsert(batch, {
        onConflict: 'symbol,timeframe,open_time',
        ignoreDuplicates: false
      });

    if (error) {
      console.error(`❌ Error inserting batch for ${symbol} ${timeframe.name}:`, error.message);
    } else {
      inserted += batch.length;
      console.log(`✅ Inserted ${inserted}/${candles.length} candles for ${symbol} ${timeframe.name}`);
    }
  }

  console.log(`✨ Completed ${symbol} ${timeframe.name}: ${inserted} candles inserted`);
  return inserted;
}

async function backfillAll() {
  console.log('🚀 Starting comprehensive forex data backfill');
  console.log(`📅 Backfilling 3 months of data`);
  console.log(`💱 Pairs: ${PAIRS.join(', ')}`);
  console.log(`⏱️  Timeframes: ${TIMEFRAMES.map(t => t.name).join(', ')}`);
  console.log('\n' + '='.repeat(60) + '\n');

  const stats = {
    totalPairs: PAIRS.length,
    totalTimeframes: TIMEFRAMES.length,
    totalCombinations: PAIRS.length * TIMEFRAMES.length,
    completed: 0,
    totalCandles: 0
  };

  for (const pair of PAIRS) {
    for (const timeframe of TIMEFRAMES) {
      try {
        const inserted = await backfillPairTimeframe(pair, timeframe);
        stats.totalCandles += inserted;
        stats.completed++;

        console.log(`\n📈 Progress: ${stats.completed}/${stats.totalCombinations} combinations completed`);
        console.log(`📊 Total candles inserted: ${stats.totalCandles.toLocaleString()}`);

        if (stats.completed < stats.totalCombinations) {
          console.log(`⏳ Waiting ${RATE_LIMIT_DELAY/1000}s before next pair/timeframe...`);
          await sleep(RATE_LIMIT_DELAY);
        }
      } catch (error) {
        console.error(`❌ Error backfilling ${pair} ${timeframe.name}:`, error.message);
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('🎉 Backfill Complete!');
  console.log('='.repeat(60));
  console.log(`✅ Pairs processed: ${stats.totalPairs}`);
  console.log(`✅ Timeframes per pair: ${stats.totalTimeframes}`);
  console.log(`✅ Total combinations: ${stats.totalCombinations}`);
  console.log(`✅ Total candles inserted: ${stats.totalCandles.toLocaleString()}`);
  console.log('='.repeat(60) + '\n');
}

backfillAll().catch(console.error);
