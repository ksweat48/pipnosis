#!/usr/bin/env node

/**
 * Validate Data Quality System
 *
 * Quick health check to verify the quality system is working correctly.
 *
 * Usage:
 *   node scripts/validate-data-quality-system.js
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials in .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║         DATA QUALITY SYSTEM - VALIDATION CHECK            ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

async function validateViews() {
  console.log('🔍 Testing quality views...\n');

  // Test forex_candles_clean view
  console.log('1️⃣  Testing forex_candles_clean view...');
  const { data: cleanData, error: cleanError } = await supabase
    .from('forex_candles_clean')
    .select('symbol, timeframe, has_wicks, source_priority')
    .limit(5);

  if (cleanError) {
    console.error('   ❌ ERROR:', cleanError.message);
    return false;
  } else {
    console.log(`   ✅ SUCCESS - Returned ${cleanData?.length || 0} clean candles`);
    if (cleanData && cleanData.length > 0) {
      console.log(`   📊 Sample: ${cleanData[0].symbol} ${cleanData[0].timeframe} (priority: ${cleanData[0].source_priority})`);
    }
  }

  // Test forex_candles_best view
  console.log('\n2️⃣  Testing forex_candles_best view...');
  const { data: bestData, error: bestError } = await supabase
    .from('forex_candles_best')
    .select('symbol, timeframe, data_source')
    .limit(5);

  if (bestError) {
    console.error('   ❌ ERROR:', bestError.message);
    return false;
  } else {
    console.log(`   ✅ SUCCESS - Returned ${bestData?.length || 0} best-quality candles`);
    if (bestData && bestData.length > 0) {
      console.log(`   📊 Sample: ${bestData[0].symbol} ${bestData[0].timeframe} from ${bestData[0].data_source}`);
    }
  }

  return true;
}

async function validateFunction() {
  console.log('\n3️⃣  Testing get_candles_for_chart() function...');

  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - (7 * 24 * 60 * 60 * 1000)); // 7 days ago

  const { data, error } = await supabase.rpc('get_candles_for_chart', {
    p_symbol: 'EURUSD',
    p_timeframe: 'H1',
    p_start_time: startTime.toISOString(),
    p_end_time: endTime.toISOString(),
    p_limit: 50
  });

  if (error) {
    console.error('   ❌ ERROR:', error.message);
    return false;
  } else {
    console.log(`   ✅ SUCCESS - Returned ${data?.length || 0} candles for EURUSD H1`);
    if (data && data.length > 0) {
      console.log(`   📊 Date range: ${new Date(data[0].open_time).toLocaleDateString()} to ${new Date(data[data.length - 1].open_time).toLocaleDateString()}`);
      console.log(`   📊 Source: ${data[0].data_source}`);
    }
  }

  return true;
}

async function checkQualityStats() {
  console.log('\n4️⃣  Checking data quality statistics...');

  const { data: qualityLog, error } = await supabase
    .from('data_quality_log')
    .select('*')
    .order('check_time', { ascending: false })
    .limit(1);

  if (error) {
    console.error('   ❌ ERROR:', error.message);
    return false;
  }

  if (!qualityLog || qualityLog.length === 0) {
    console.warn('   ⚠️  No quality logs found (run log_data_quality() first)');
    return true;
  }

  const log = qualityLog[0];
  console.log(`   ✅ Latest quality check: ${new Date(log.check_time).toLocaleString()}`);
  console.log(`   📊 Total candles: ${log.total_candles?.toLocaleString()}`);
  console.log(`   📊 Deprecated: ${log.deprecated_candles?.toLocaleString()}`);
  console.log(`   📊 Flat candles: ${log.flat_candles?.toLocaleString()}`);

  // Show quality by source
  if (log.quality_by_source) {
    console.log('\n   📊 Quality by source:');
    const sources = Object.entries(log.quality_by_source)
      .sort((a, b) => parseFloat(b[1].flat_pct) - parseFloat(a[1].flat_pct));

    sources.forEach(([source, stats]) => {
      const emoji = stats.flat_pct < 10 ? '✅' : stats.flat_pct < 50 ? '⚠️' : '❌';
      console.log(`      ${emoji} ${source.padEnd(20)} ${stats.flat_pct}% flat (${stats.total} candles)`);
    });
  }

  return true;
}

async function testDeprecationStatus() {
  console.log('\n5️⃣  Checking deprecation status...');

  const { data, error } = await supabase
    .from('forex_candles')
    .select('deprecated')
    .limit(10000);

  if (error) {
    console.error('   ❌ ERROR:', error.message);
    return false;
  }

  const total = data?.length || 0;
  const deprecated = data?.filter(c => c.deprecated).length || 0;
  const active = total - deprecated;

  console.log(`   ✅ SUCCESS`);
  console.log(`   📊 Total candles checked: ${total.toLocaleString()}`);
  console.log(`   📊 Active: ${active.toLocaleString()} (${((active / total) * 100).toFixed(1)}%)`);
  console.log(`   📊 Deprecated: ${deprecated.toLocaleString()} (${((deprecated / total) * 100).toFixed(1)}%)`);

  return true;
}

async function main() {
  try {
    let allPassed = true;

    allPassed = await validateViews() && allPassed;
    allPassed = await validateFunction() && allPassed;
    allPassed = await checkQualityStats() && allPassed;
    allPassed = await testDeprecationStatus() && allPassed;

    console.log('\n' + '─'.repeat(60));

    if (allPassed) {
      console.log('\n✅ ALL CHECKS PASSED!');
      console.log('\n🎯 Quality system is working correctly.');
      console.log('📈 Charts will now automatically use clean, high-quality data.');
      console.log('\n💡 Next step: Import historical data with:');
      console.log('   node scripts/import-clean-historical-data.js\n');
    } else {
      console.log('\n⚠️  SOME CHECKS FAILED');
      console.log('Please review the errors above.\n');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n💥 Fatal error:', error.message);
    process.exit(1);
  }
}

main();
