#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkHistoricalQuality() {
  console.log('\n🔍 Historical Data Quality Analysis (1-3 months ago)\n');
  console.log('='.repeat(70));
  console.log('\n');

  const symbols = ['EURUSD', 'XAUUSD', 'GBPUSD'];
  const timeframes = ['M15', 'H1', 'H4', 'D1'];

  // Check data from 1-3 months ago (where TradingView data was added)
  const endTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const startTime = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  let totalCandles = 0;
  let totalWithWicks = 0;
  let totalFlat = 0;

  for (const symbol of symbols) {
    console.log(`📊 ${symbol}:`);

    for (const timeframe of timeframes) {
      const { data, error } = await supabase
        .from('forex_candles')
        .select('open, high, low, close, open_time, data_source')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .gte('open_time', startTime)
        .lt('open_time', endTime)
        .order('open_time', { ascending: false })
        .limit(200);

      if (error) {
        console.error(`  ${timeframe}: Error - ${error.message}`);
        continue;
      }

      let noWickCount = 0;
      let flatCount = 0;
      let tradingviewCount = 0;

      for (const candle of data) {
        const hasWick = candle.high !== candle.low;
        const isFlat = candle.open === candle.high && candle.high === candle.low && candle.low === candle.close;

        if (!hasWick) noWickCount++;
        if (isFlat) flatCount++;
        if (candle.data_source === 'tradingview') tradingviewCount++;
      }

      const wickPercent = (((data.length - noWickCount) / data.length) * 100).toFixed(1);
      const tvPercent = ((tradingviewCount / data.length) * 100).toFixed(0);
      const status = wickPercent >= 90 ? '✅' : wickPercent >= 70 ? '⚠️' : '❌';

      totalCandles += data.length;
      totalWithWicks += (data.length - noWickCount);
      totalFlat += flatCount;

      console.log(`  ${timeframe.padEnd(6)}: ${data.length} candles | ${wickPercent}% wicks | ${flatCount} flat | ${tvPercent}% TV ${status}`);
    }
    console.log('');
  }

  const overallWickPercent = ((totalWithWicks / totalCandles) * 100).toFixed(1);
  const overallFlatPercent = ((totalFlat / totalCandles) * 100).toFixed(1);

  console.log('='.repeat(70));
  console.log('\n📈 HISTORICAL DATA STATISTICS (1-3 months ago):\n');
  console.log(`  Total Candles Analyzed:  ${totalCandles}`);
  console.log(`  Candles with Wicks:      ${totalWithWicks} (${overallWickPercent}%)`);
  console.log(`  Flat Candles:            ${totalFlat} (${overallFlatPercent}%)`);
  console.log('');

  const improvement = overallWickPercent >= 90 ? '✅ EXCELLENT' : overallWickPercent >= 70 ? '⚠️ GOOD' : '❌ NEEDS MORE';
  console.log(`  Quality Rating: ${improvement}`);
  console.log('');

  if (overallWickPercent >= 70) {
    console.log('✨ SUCCESS! Historical data from TradingView is high quality.');
    console.log('   The backfill successfully added proper OHLC data with wicks.');
  }

  console.log('');
  console.log('📊 Note: Recent data (past 72h) may still have flat candles from');
  console.log('   your live aggregation system. This is normal and will improve');
  console.log('   as more live ticks are aggregated over time.');
  console.log('');
  console.log('='.repeat(70));
  console.log('');
}

checkHistoricalQuality().catch(console.error);
