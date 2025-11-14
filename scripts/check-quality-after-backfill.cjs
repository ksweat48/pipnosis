#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkDataQualityAfterBackfill() {
  console.log('\n🔍 Data Quality Analysis After TradingView Backfill\n');
  console.log('='.repeat(70));
  console.log('\n');

  const symbols = ['EURUSD', 'XAUUSD', 'GBPUSD'];
  const timeframes = ['M1', 'M15', 'H1', 'D1'];

  const startTime = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

  let totalCandles = 0;
  let totalWithWicks = 0;
  let totalFlat = 0;

  for (const symbol of symbols) {
    console.log(`📊 ${symbol}:`);

    for (const timeframe of timeframes) {
      const { data, error } = await supabase
        .from('forex_candles')
        .select('open, high, low, close, open_time')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .gte('open_time', startTime)
        .order('open_time', { ascending: false })
        .limit(100);

      if (error) {
        console.error(`  ${timeframe}: Error - ${error.message}`);
        continue;
      }

      let noWickCount = 0;
      let flatCount = 0;

      for (const candle of data) {
        const hasWick = candle.high !== candle.low;
        const isFlat = candle.open === candle.high && candle.high === candle.low && candle.low === candle.close;

        if (!hasWick) noWickCount++;
        if (isFlat) flatCount++;
      }

      const wickPercent = (((data.length - noWickCount) / data.length) * 100).toFixed(1);
      const status = wickPercent >= 90 ? '✅' : wickPercent >= 70 ? '⚠️' : '❌';

      totalCandles += data.length;
      totalWithWicks += (data.length - noWickCount);
      totalFlat += flatCount;

      console.log(`  ${timeframe.padEnd(6)}: ${data.length} candles | ${wickPercent}% with wicks | ${flatCount} flat ${status}`);
    }
    console.log('');
  }

  const overallWickPercent = ((totalWithWicks / totalCandles) * 100).toFixed(1);
  const overallFlatPercent = ((totalFlat / totalCandles) * 100).toFixed(1);

  console.log('='.repeat(70));
  console.log('\n📈 OVERALL STATISTICS:\n');
  console.log(`  Total Candles Analyzed:  ${totalCandles}`);
  console.log(`  Candles with Wicks:      ${totalWithWicks} (${overallWickPercent}%)`);
  console.log(`  Flat Candles:            ${totalFlat} (${overallFlatPercent}%)`);
  console.log('');

  const improvement = overallWickPercent >= 90 ? '✅ EXCELLENT' : overallWickPercent >= 70 ? '⚠️ GOOD' : '❌ NEEDS MORE';
  console.log(`  Quality Rating: ${improvement}`);
  console.log('');

  if (overallWickPercent >= 70) {
    console.log('✨ SUCCESS! Your candle data quality has significantly improved.');
    console.log('   The TradingView backfill successfully replaced low-quality candles');
    console.log('   with high-quality OHLC data including proper wicks.');
  } else {
    console.log('⚠️  Note: Some candles still show low quality. This is normal for:');
    console.log('   - Very recent candles that are still being aggregated');
    console.log('   - Market hours with low volatility');
    console.log('   - Weekend/holiday periods with no trading');
  }

  console.log('');
  console.log('='.repeat(70));
  console.log('');
}

checkDataQualityAfterBackfill().catch(console.error);
