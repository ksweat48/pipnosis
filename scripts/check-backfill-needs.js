#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkBackfillNeeds() {
  console.log('🔍 Checking database state for backfill needs...\n');

  // Check price data availability
  console.log('📊 Checking raw price data in realtime_prices...');
  const { data: priceData, error: priceError } = await supabase
    .from('realtime_prices')
    .select('symbol, created_at')
    .order('created_at', { ascending: false })
    .limit(1000);

  if (priceError) {
    console.error('❌ Error checking price data:', priceError.message);
  } else if (priceData && priceData.length > 0) {
    const symbols = [...new Set(priceData.map(p => p.symbol))];
    const oldestPrice = new Date(priceData[priceData.length - 1].created_at);
    const newestPrice = new Date(priceData[0].created_at);
    const hoursOfData = (newestPrice - oldestPrice) / (1000 * 60 * 60);

    console.log(`✅ Found ${priceData.length} price records`);
    console.log(`   Symbols: ${symbols.join(', ')}`);
    console.log(`   Oldest: ${oldestPrice.toISOString()}`);
    console.log(`   Newest: ${newestPrice.toISOString()}`);
    console.log(`   Coverage: ${hoursOfData.toFixed(1)} hours\n`);
  } else {
    console.log('⚠️  No price data found in realtime_prices table\n');
  }

  // Check candle gaps for each symbol/timeframe
  console.log('📈 Checking candle gaps in forex_candles...');
  const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30'];
  const timeframes = ['M5', 'M15', 'H1', 'H4'];

  for (const symbol of symbols) {
    for (const timeframe of timeframes) {
      const { data: candles, error: candleError } = await supabase
        .from('forex_candles')
        .select('open_time')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .gte('open_time', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('open_time', { ascending: false })
        .limit(1);

      if (!candleError && candles && candles.length > 0) {
        const lastCandle = new Date(candles[0].open_time);
        const hoursSince = (Date.now() - lastCandle.getTime()) / (1000 * 60 * 60);
        const status = hoursSince > 1 ? '❌' : '✅';
        console.log(`${status} ${symbol} ${timeframe}: Last candle ${hoursSince.toFixed(1)}h ago`);
      } else {
        console.log(`⚠️  ${symbol} ${timeframe}: No candles in last 24h`);
      }
    }
  }

  console.log('\n✅ Database check complete!');
}

checkBackfillNeeds().catch(console.error);
