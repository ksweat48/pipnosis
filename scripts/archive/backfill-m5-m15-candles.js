/**
 * CRITICAL BACKFILL SCRIPT: Fill Missing M5 and M15 Candles
 *
 * PURPOSE:
 * The server aggregator was not creating M5/M15 candles, only M1.
 * This script backfills M5 and M15 candles from existing realtime_prices data.
 *
 * RUN THIS ONCE after deploying the fixed continuous-candle-aggregator.ts
 *
 * Usage:
 *   node scripts/backfill-m5-m15-candles.js
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables');
  console.error('   VITE_SUPABASE_URL:', supabaseUrl ? '✓' : '✗');
  console.error('   SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? '✓' : '✗');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];
const TIMEFRAMES = ['M5', 'M15'];
const LOOKBACK_HOURS = 48; // Backfill last 48 hours

function roundTimeToCandle(timestamp, minutes) {
  const ms = new Date(timestamp).getTime();
  const roundedMs = Math.floor(ms / (minutes * 60 * 1000)) * (minutes * 60 * 1000);
  return new Date(roundedMs);
}

function isMarketOpenAtTime(date) {
  const estTime = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dayOfWeek = estTime.getDay();
  const hours = estTime.getHours();
  const minutes = estTime.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  // Saturday is closed
  if (dayOfWeek === 6) return false;

  // Friday after 5:00 PM
  if (dayOfWeek === 5 && totalMinutes >= 17 * 60) return false;

  // Sunday before 5:00 PM
  if (dayOfWeek === 0 && totalMinutes < 17 * 60) return false;

  return true;
}

async function fetchRecentPrices(symbol, hoursBack) {
  const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

  console.log(`  📊 Fetching prices for ${symbol} since ${cutoffTime.toISOString()}...`);

  const { data, error } = await supabase
    .from('realtime_prices')
    .select('bid, ask, broker_time, created_at')
    .eq('symbol', symbol)
    .gte('created_at', cutoffTime.toISOString())
    .order('created_at', { ascending: true });

  if (error) {
    console.error(`  ❌ Error fetching prices for ${symbol}:`, error.message);
    return [];
  }

  console.log(`  ✓ Loaded ${data?.length || 0} prices`);
  return data || [];
}

function aggregatePricesToCandles(prices, symbol, timeframe, minutes) {
  if (prices.length === 0) return [];

  const candleMap = new Map();

  prices.forEach(price => {
    const timestamp = price.broker_time || price.created_at;
    const candleStart = roundTimeToCandle(timestamp, minutes);
    const candleKey = candleStart.getTime();

    const midPrice = (parseFloat(price.bid) + parseFloat(price.ask)) / 2;

    if (!candleMap.has(candleKey)) {
      candleMap.set(candleKey, {
        symbol,
        timeframe,
        open_time: candleStart,
        close_time: new Date(candleStart.getTime() + minutes * 60 * 1000),
        open: midPrice,
        high: midPrice,
        low: midPrice,
        close: midPrice,
        volume: 1,
        tick_count: 1
      });
    } else {
      const candle = candleMap.get(candleKey);
      candle.high = Math.max(candle.high, midPrice);
      candle.low = Math.min(candle.low, midPrice);
      candle.close = midPrice;
      candle.volume++;
      candle.tick_count++;
    }
  });

  // Filter out weekend candles
  const candles = Array.from(candleMap.values()).filter(candle =>
    isMarketOpenAtTime(candle.open_time)
  );

  return candles.sort((a, b) => a.open_time.getTime() - b.open_time.getTime());
}

async function saveCandles(candles) {
  if (candles.length === 0) return 0;

  const records = candles.map(candle => ({
    symbol: candle.symbol,
    timeframe: candle.timeframe,
    open_time: candle.open_time.toISOString(),
    close_time: candle.close_time.toISOString(),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    tick_count: candle.tick_count,
    data_source: 'backfill_script',
    quality_score: candle.volume >= 3 ? 95 : 75
  }));

  const { error } = await supabase
    .from('forex_candles')
    .upsert(records, {
      onConflict: 'symbol,timeframe,open_time',
      ignoreDuplicates: false
    });

  if (error) {
    console.error(`  ❌ Error saving candles:`, error.message);
    return 0;
  }

  return records.length;
}

async function backfillSymbolTimeframe(symbol, timeframe) {
  const minutes = timeframe === 'M5' ? 5 : 15;

  console.log(`\n🔧 Backfilling ${symbol} ${timeframe}...`);

  const prices = await fetchRecentPrices(symbol, LOOKBACK_HOURS);

  if (prices.length === 0) {
    console.log(`  ⚠️ No prices found, skipping`);
    return 0;
  }

  console.log(`  📈 Aggregating ${prices.length} prices into ${timeframe} candles...`);
  const candles = aggregatePricesToCandles(prices, symbol, timeframe, minutes);

  console.log(`  💾 Saving ${candles.length} candles...`);
  const saved = await saveCandles(candles);

  if (saved > 0) {
    console.log(`  ✅ Successfully saved ${saved} ${timeframe} candles for ${symbol}`);
  }

  return saved;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║     M5/M15 CANDLE BACKFILL SCRIPT                             ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`📅 Backfilling last ${LOOKBACK_HOURS} hours`);
  console.log(`🎯 Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`⏱️  Timeframes: ${TIMEFRAMES.join(', ')}`);
  console.log('');

  let totalCandles = 0;

  for (const symbol of SYMBOLS) {
    for (const timeframe of TIMEFRAMES) {
      try {
        const saved = await backfillSymbolTimeframe(symbol, timeframe);
        totalCandles += saved;

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`❌ Error processing ${symbol} ${timeframe}:`, error.message);
      }
    }
  }

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log(`║  ✅ BACKFILL COMPLETE: ${totalCandles} candles created${' '.repeat(Math.max(0, 28 - totalCandles.toString().length))}║`);
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Refresh your browser to see the filled gaps');
  console.log('  2. Server will continue creating M5/M15 candles automatically');
  console.log('  3. Gaps should not reappear when you leave and return');
  console.log('');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
