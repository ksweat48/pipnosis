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

function normalizeTimestamp(timestampMs, intervalMs) {
  return Math.floor(timestampMs / intervalMs) * intervalMs;
}

function getLastCompletedCandleStart(timeframe) {
  const now = Date.now();
  const intervalMs = timeframe.minutes * 60 * 1000;
  const currentCandleStart = normalizeTimestamp(now, intervalMs);
  return currentCandleStart - intervalMs;
}

function isTimestampAligned(timestampMs, intervalMs) {
  return timestampMs % intervalMs === 0;
}

function validateCandleTimestamps(candles, timeframe) {
  const errors = [];
  const intervalMs = timeframe.minutes * 60 * 1000;

  candles.forEach((candle, index) => {
    const candleTimeMs = new Date(candle.open_time).getTime();

    if (!isTimestampAligned(candleTimeMs, intervalMs)) {
      errors.push(
        `Candle ${index}: timestamp ${candle.open_time} is not aligned to ${timeframe.name}`
      );
    }

    if (index > 0) {
      const prevTimeMs = new Date(candles[index - 1].open_time).getTime();
      const expectedTimeMs = prevTimeMs + intervalMs;

      if (candleTimeMs < prevTimeMs) {
        errors.push(`Candle ${index}: timestamp is before previous candle`);
      } else if (candleTimeMs === prevTimeMs) {
        errors.push(`Candle ${index}: duplicate timestamp ${candle.open_time}`);
      } else if (candleTimeMs !== expectedTimeMs) {
        const gapMinutes = (candleTimeMs - expectedTimeMs) / 60000;
        errors.push(
          `Candle ${index}: gap detected - ${gapMinutes} minutes between candles`
        );
      }
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
  };
}

async function generateSyntheticCandle(symbol, timeframe, timestampMs) {
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

  const openTime = new Date(timestampMs).toISOString();
  const closeTime = new Date(timestampMs + (timeframe.minutes * 60 * 1000)).toISOString();

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

  const intervalMs = timeframe.minutes * 60 * 1000;

  const lastCompletedCandleMs = getLastCompletedCandleStart(timeframe);

  const threeMonthsAgo = lastCompletedCandleMs - (90 * 24 * 60 * 60 * 1000);
  const startTimestampMs = normalizeTimestamp(threeMonthsAgo, intervalMs);

  console.log(`📅 Start: ${new Date(startTimestampMs).toISOString()}`);
  console.log(`📅 End: ${new Date(lastCompletedCandleMs).toISOString()} (last completed candle)`);

  const candles = [];
  let timestampMs = startTimestampMs;

  while (timestampMs <= lastCompletedCandleMs) {
    const candle = await generateSyntheticCandle(symbol, timeframe, timestampMs);
    candles.push(candle);
    timestampMs += intervalMs;
  }

  console.log(`📊 Generated ${candles.length} candles for ${symbol} ${timeframe.name}`);

  const validation = validateCandleTimestamps(candles, timeframe);
  if (!validation.isValid) {
    console.error(`❌ Validation failed for ${symbol} ${timeframe.name}:`);
    validation.errors.slice(0, 5).forEach(err => console.error(`   ${err}`));
    if (validation.errors.length > 5) {
      console.error(`   ... and ${validation.errors.length - 5} more errors`);
    }
    return 0;
  }

  console.log(`✅ Validation passed: All timestamps properly aligned`);

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

  const { data: verifyData, error: verifyError } = await supabase
    .from('forex_candles')
    .select('open_time', { count: 'exact' })
    .eq('symbol', symbol)
    .eq('timeframe', timeframe.name)
    .eq('data_source', 'synthetic_backfill')
    .order('open_time', { ascending: true });

  if (!verifyError && verifyData) {
    console.log(`🔍 Post-insert verification: ${verifyData.length} candles in database`);

    if (verifyData.length >= 2) {
      const firstCandle = new Date(verifyData[0].open_time);
      const secondCandle = new Date(verifyData[1].open_time);
      const diffMs = secondCandle - firstCandle;
      const expectedDiffMs = intervalMs;

      if (diffMs === expectedDiffMs) {
        console.log(`✅ Timestamp alignment verified: ${diffMs/60000} minute intervals`);
      } else {
        console.warn(`⚠️  Warning: Unexpected interval ${diffMs/60000} minutes (expected ${expectedDiffMs/60000})`);
      }
    }
  }

  console.log(`✨ Completed ${symbol} ${timeframe.name}: ${inserted} candles inserted`);
  return inserted;
}

async function backfillAll() {
  console.log('🚀 Starting comprehensive forex data backfill');
  console.log('🔧 Using timestamp normalization to prevent overlaps');
  console.log('⏰ Excluding current forming candle (only completed candles)');
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

  console.log('🔍 Running final data quality check...\n');

  for (const pair of PAIRS) {
    for (const timeframe of TIMEFRAMES) {
      const { data, error } = await supabase
        .from('forex_candles')
        .select('open_time')
        .eq('symbol', pair)
        .eq('timeframe', timeframe.name)
        .eq('data_source', 'synthetic_backfill')
        .order('open_time', { ascending: true })
        .limit(2);

      if (!error && data && data.length === 2) {
        const diff = new Date(data[1].open_time) - new Date(data[0].open_time);
        const expectedDiff = timeframe.minutes * 60 * 1000;
        if (diff !== expectedDiff) {
          console.warn(`⚠️  ${pair} ${timeframe.name}: Unexpected interval ${diff/60000}min (expected ${expectedDiff/60000}min)`);
        }
      }
    }
  }

  console.log('\n✅ Data quality check complete!\n');
}

backfillAll().catch(console.error);
