#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function diagnosePolliningChartsCandles() {
  console.log('\n🔍 POLLING, CHARTS & CANDLES DIAGNOSTIC REPORT\n');
  console.log('='.repeat(60));

  const issues = [];
  const warnings = [];

  // 1. Check realtime_prices table for recent data
  console.log('\n1️⃣ Checking realtime_prices table...');
  try {
    const { data: recentPrices, error } = await supabase
      .from('realtime_prices')
      .select('symbol, bid, ask, created_at')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      issues.push(`❌ Error querying realtime_prices: ${error.message}`);
    } else if (!recentPrices || recentPrices.length === 0) {
      issues.push('❌ No data in realtime_prices table - polling is not working!');
    } else {
      const latestPrice = recentPrices[0];
      const ageSeconds = (Date.now() - new Date(latestPrice.created_at).getTime()) / 1000;

      console.log(`   ✅ Found ${recentPrices.length} recent prices`);
      console.log(`   Latest: ${latestPrice.symbol} at ${new Date(latestPrice.created_at).toLocaleTimeString()}`);
      console.log(`   Age: ${Math.round(ageSeconds)} seconds`);

      if (ageSeconds > 300) {
        warnings.push(`⚠️ Latest price is ${Math.round(ageSeconds)}s old - polling may be stale`);
      }

      // Check all symbols
      const symbols = [...new Set(recentPrices.map(p => p.symbol))];
      console.log(`   Symbols with recent data: ${symbols.join(', ')}`);

      const expectedSymbols = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];
      const missingSymbols = expectedSymbols.filter(s => !symbols.includes(s));
      if (missingSymbols.length > 0) {
        warnings.push(`⚠️ Missing data for symbols: ${missingSymbols.join(', ')}`);
      }
    }
  } catch (err) {
    issues.push(`❌ Error checking realtime_prices: ${err.message}`);
  }

  // 2. Check forex_candles table for recent data
  console.log('\n2️⃣ Checking forex_candles table...');
  try {
    const { data: recentCandles, error } = await supabase
      .from('forex_candles')
      .select('symbol, timeframe, open_time, close, created_at')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      issues.push(`❌ Error querying forex_candles: ${error.message}`);
    } else if (!recentCandles || recentCandles.length === 0) {
      issues.push('❌ No data in forex_candles table - candle aggregation is not working!');
    } else {
      const latestCandle = recentCandles[0];
      const ageSeconds = (Date.now() - new Date(latestCandle.created_at).getTime()) / 1000;

      console.log(`   ✅ Found ${recentCandles.length} recent candles`);
      console.log(`   Latest: ${latestCandle.symbol} ${latestCandle.timeframe} at ${new Date(latestCandle.open_time).toLocaleTimeString()}`);
      console.log(`   Age: ${Math.round(ageSeconds)} seconds`);

      if (ageSeconds > 600) {
        warnings.push(`⚠️ Latest candle is ${Math.round(ageSeconds)}s old - candle aggregation may be stale`);
      }

      // Check for M1 candles specifically (should be most recent)
      const m1Candles = recentCandles.filter(c => c.timeframe === 'm1' || c.timeframe === 'M1');
      if (m1Candles.length === 0) {
        warnings.push('⚠️ No M1 candles found - real-time aggregation may not be working');
      } else {
        console.log(`   M1 candles found: ${m1Candles.length}`);
      }
    }
  } catch (err) {
    issues.push(`❌ Error checking forex_candles: ${err.message}`);
  }

  // 3. Check candle_state table (server-side aggregation)
  console.log('\n3️⃣ Checking candle_state table (server-side aggregation)...');
  try {
    const { data: candleStates, error } = await supabase
      .from('candle_state')
      .select('symbol, timeframe, last_updated')
      .order('last_updated', { ascending: false })
      .limit(5);

    if (error) {
      if (error.message.includes('does not exist')) {
        warnings.push('⚠️ candle_state table does not exist - server-side aggregation not configured');
      } else {
        issues.push(`❌ Error querying candle_state: ${error.message}`);
      }
    } else if (!candleStates || candleStates.length === 0) {
      warnings.push('⚠️ No data in candle_state table - server-side aggregation may not be running');
    } else {
      const latestState = candleStates[0];
      const ageSeconds = (Date.now() - new Date(latestState.last_updated).getTime()) / 1000;

      console.log(`   ✅ Found ${candleStates.length} candle states`);
      console.log(`   Latest: ${latestState.symbol} ${latestState.timeframe} updated ${Math.round(ageSeconds)}s ago`);

      if (ageSeconds > 120) {
        warnings.push(`⚠️ Candle states stale (${Math.round(ageSeconds)}s old) - server aggregation may be paused`);
      }
    }
  } catch (err) {
    warnings.push(`⚠️ candle_state check failed: ${err.message}`);
  }

  // 4. Check for data gaps in candles
  console.log('\n4️⃣ Checking for candle data gaps...');
  try {
    const { data: m1Candles, error } = await supabase
      .from('forex_candles')
      .select('symbol, open_time')
      .eq('symbol', 'EURUSD')
      .eq('timeframe', 'm1')
      .order('open_time', { ascending: false })
      .limit(20);

    if (error) {
      warnings.push(`⚠️ Could not check for gaps: ${error.message}`);
    } else if (m1Candles && m1Candles.length > 1) {
      let gapCount = 0;
      for (let i = 0; i < m1Candles.length - 1; i++) {
        const current = new Date(m1Candles[i].open_time).getTime();
        const previous = new Date(m1Candles[i + 1].open_time).getTime();
        const diffMinutes = (current - previous) / 60000;

        if (diffMinutes > 1.5) {
          gapCount++;
        }
      }

      if (gapCount > 0) {
        warnings.push(`⚠️ Found ${gapCount} gaps in EURUSD M1 candles (last 20)`);
      } else {
        console.log('   ✅ No gaps detected in recent EURUSD M1 candles');
      }
    }
  } catch (err) {
    warnings.push(`⚠️ Gap detection failed: ${err.message}`);
  }

  // 5. Check market hours
  console.log('\n5️⃣ Checking market hours...');
  const now = new Date();
  const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dayOfWeek = estTime.getDay();
  const hours = estTime.getHours();
  const minutes = estTime.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  const fridayCloseTime = 17 * 60;
  const sundayOpenTime = 17 * 60;

  let isMarketOpen = true;
  if (dayOfWeek === 6) {
    isMarketOpen = false;
  } else if (dayOfWeek === 5 && totalMinutes >= fridayCloseTime) {
    isMarketOpen = false;
  } else if (dayOfWeek === 0 && totalMinutes < sundayOpenTime) {
    isMarketOpen = false;
  }

  console.log(`   Current time (EST): ${estTime.toLocaleString()}`);
  console.log(`   Market status: ${isMarketOpen ? '✅ OPEN' : '❌ CLOSED'}`);

  if (!isMarketOpen) {
    console.log('   ℹ️ Market is closed - polling may be paused (this is normal)');
  }

  // 6. Check polling health
  console.log('\n6️⃣ Checking polling health records...');
  try {
    const { data: healthRecords, error } = await supabase
      .from('polling_health_monitor')
      .select('symbol, status, last_success, error_count, recovery_attempts')
      .order('last_updated', { ascending: false })
      .limit(10);

    if (error) {
      if (error.message.includes('does not exist')) {
        console.log('   ℹ️ polling_health_monitor table does not exist (optional feature)');
      } else {
        warnings.push(`⚠️ Error querying polling_health_monitor: ${error.message}`);
      }
    } else if (healthRecords && healthRecords.length > 0) {
      console.log(`   Found ${healthRecords.length} health records`);

      const errorSymbols = healthRecords.filter(h => h.status === 'error');
      const staleSymbols = healthRecords.filter(h => h.status === 'stale');

      if (errorSymbols.length > 0) {
        warnings.push(`⚠️ ${errorSymbols.length} symbols in error state: ${errorSymbols.map(h => h.symbol).join(', ')}`);
      }

      if (staleSymbols.length > 0) {
        warnings.push(`⚠️ ${staleSymbols.length} symbols stale: ${staleSymbols.map(h => h.symbol).join(', ')}`);
      }

      const highRecoveryAttempts = healthRecords.filter(h => h.recovery_attempts > 3);
      if (highRecoveryAttempts.length > 0) {
        warnings.push(`⚠️ ${highRecoveryAttempts.length} symbols with high recovery attempts: ${highRecoveryAttempts.map(h => `${h.symbol}(${h.recovery_attempts})`).join(', ')}`);
      }
    }
  } catch (err) {
    console.log(`   ℹ️ Could not check polling health: ${err.message}`);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 DIAGNOSTIC SUMMARY\n');

  if (issues.length === 0 && warnings.length === 0) {
    console.log('✅ All systems appear to be functioning correctly!');
    console.log('\nIf you are still experiencing issues in the browser:');
    console.log('  1. Check browser console for JavaScript errors');
    console.log('  2. Verify network tab shows successful Supabase requests');
    console.log('  3. Check if browser tab visibility is affecting polling');
    console.log('  4. Try hard refresh (Ctrl+Shift+R) to clear cache');
  } else {
    if (issues.length > 0) {
      console.log('❌ CRITICAL ISSUES FOUND:\n');
      issues.forEach(issue => console.log('  ' + issue));
    }

    if (warnings.length > 0) {
      console.log('\n⚠️  WARNINGS:\n');
      warnings.forEach(warning => console.log('  ' + warning));
    }

    console.log('\n💡 RECOMMENDED ACTIONS:\n');

    if (issues.some(i => i.includes('realtime_prices'))) {
      console.log('  📡 Start the price polling system:');
      console.log('     - Check if continuous-price-collector edge function is deployed');
      console.log('     - Verify cron job is configured in Supabase');
      console.log('     - Check edge function logs for errors');
    }

    if (issues.some(i => i.includes('forex_candles')) || warnings.some(w => w.includes('candle_state'))) {
      console.log('  🕯️  Start the candle aggregation system:');
      console.log('     - Check if continuous-candle-aggregator edge function is deployed');
      console.log('     - Verify pg_cron job is running');
      console.log('     - Review aggregator function logs');
    }

    if (warnings.some(w => w.includes('stale') || w.includes('old'))) {
      console.log('  🔄 Data is stale:');
      console.log('     - Restart polling system if market is open');
      console.log('     - Check server-side functions are not paused');
      console.log('     - Verify no rate limiting or quota issues');
    }
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

diagnosePolliningChartsCandles().catch(console.error);
