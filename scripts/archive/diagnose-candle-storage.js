import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function diagnoseStorage() {
  console.log('='.repeat(70));
  console.log('CANDLE STORAGE DIAGNOSTIC REPORT');
  console.log('='.repeat(70));
  console.log();

  // 1. Check recent candles by data source
  console.log('1. RECENT CANDLES BY DATA SOURCE (Last 24 Hours)');
  console.log('-'.repeat(70));

  const { data: recentCandles, error: candlesError } = await supabase
    .from('forex_candles')
    .select('data_source, symbol, timeframe, created_at')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(50);

  if (candlesError) {
    console.error('Error fetching candles:', candlesError.message);
  } else {
    const grouped = recentCandles.reduce((acc, candle) => {
      const key = `${candle.data_source || 'unknown'}_${candle.symbol}_${candle.timeframe}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    if (Object.keys(grouped).length === 0) {
      console.log('❌ NO CANDLES CREATED IN LAST 24 HOURS');
    } else {
      console.log(`✅ Found ${recentCandles.length} candles`);
      Object.entries(grouped).forEach(([key, count]) => {
        const [source, symbol, timeframe] = key.split('_');
        console.log(`   ${source}: ${symbol} ${timeframe} - ${count} candles`);
      });
    }
  }
  console.log();

  // 2. Check validation failures
  console.log('2. VALIDATION FAILURES (Last 24 Hours)');
  console.log('-'.repeat(70));

  const { data: failures, error: failuresError } = await supabase
    .from('candle_validation_failures')
    .select('symbol, validation_type, error_message, severity, occurred_at')
    .gte('occurred_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('occurred_at', { ascending: false })
    .limit(20);

  if (failuresError) {
    console.error('Error fetching validation failures:', failuresError.message);
  } else {
    if (failures.length === 0) {
      console.log('✅ NO VALIDATION FAILURES');
    } else {
      console.log(`⚠️  Found ${failures.length} validation failures:`);
      failures.forEach((failure, i) => {
        console.log(`   ${i + 1}. [${failure.severity}] ${failure.symbol} - ${failure.validation_type}`);
        console.log(`      ${failure.error_message}`);
        console.log(`      Time: ${new Date(failure.occurred_at).toLocaleString()}`);
      });
    }
  }
  console.log();

  // 3. Check candle counts per symbol/timeframe
  console.log('3. TOTAL CANDLES STORED (All Time)');
  console.log('-'.repeat(70));

  const { data: counts, error: countsError } = await supabase
    .from('forex_candles')
    .select('symbol, timeframe, data_source')
    .order('symbol');

  if (countsError) {
    console.error('Error fetching counts:', countsError.message);
  } else {
    const summary = counts.reduce((acc, row) => {
      const key = `${row.symbol}_${row.timeframe}`;
      if (!acc[key]) {
        acc[key] = { symbol: row.symbol, timeframe: row.timeframe, count: 0, sources: new Set() };
      }
      acc[key].count++;
      if (row.data_source) acc[key].sources.add(row.data_source);
      return acc;
    }, {});

    console.log(`Total: ${counts.length} candles across all symbols/timeframes\n`);
    Object.values(summary).forEach(item => {
      const sources = Array.from(item.sources).join(', ') || 'unknown';
      console.log(`   ${item.symbol} ${item.timeframe}: ${item.count} candles (sources: ${sources})`);
    });
  }
  console.log();

  // 4. Check data freshness
  console.log('4. DATA FRESHNESS CHECK');
  console.log('-'.repeat(70));

  const { data: latestCandles, error: latestError } = await supabase
    .from('forex_candles')
    .select('symbol, timeframe, open_time, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  if (latestError) {
    console.error('Error fetching latest candles:', latestError.message);
  } else {
    if (latestCandles.length === 0) {
      console.log('❌ NO CANDLES IN DATABASE');
    } else {
      const mostRecent = latestCandles[0];
      const ageMinutes = Math.floor((Date.now() - new Date(mostRecent.created_at).getTime()) / (1000 * 60));

      console.log(`Most recent candle:`);
      console.log(`   ${mostRecent.symbol} ${mostRecent.timeframe}`);
      console.log(`   Created: ${new Date(mostRecent.created_at).toLocaleString()}`);
      console.log(`   Age: ${ageMinutes} minutes ago`);

      if (ageMinutes < 10) {
        console.log(`   ✅ FRESH - System is actively storing candles`);
      } else if (ageMinutes < 60) {
        console.log(`   ⚠️  STALE - No candles in last ${ageMinutes} minutes`);
      } else {
        console.log(`   ❌ OLD - Last candle was ${Math.floor(ageMinutes / 60)} hours ago`);
      }
    }
  }
  console.log();

  // 5. Check function monitoring
  console.log('5. AGGREGATOR EXECUTION STATUS');
  console.log('-'.repeat(70));

  const { data: functionLogs, error: logsError } = await supabase
    .from('function_monitoring')
    .select('function_name, status, execution_time_ms, error_message, created_at')
    .eq('function_name', 'continuous-candle-aggregator')
    .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(10);

  if (logsError) {
    console.log('ℹ️  Function monitoring not available:', logsError.message);
  } else {
    if (functionLogs.length === 0) {
      console.log('⚠️  NO RECENT AGGREGATOR EXECUTIONS');
    } else {
      const successCount = functionLogs.filter(log => log.status === 'success').length;
      const errorCount = functionLogs.filter(log => log.status === 'error').length;

      console.log(`Last hour: ${functionLogs.length} executions (${successCount} success, ${errorCount} errors)`);
      console.log('\nRecent executions:');
      functionLogs.slice(0, 5).forEach((log, i) => {
        const status = log.status === 'success' ? '✅' : '❌';
        console.log(`   ${status} ${new Date(log.created_at).toLocaleString()}`);
        if (log.error_message) {
          console.log(`      Error: ${log.error_message}`);
        }
        if (log.execution_time_ms) {
          console.log(`      Duration: ${log.execution_time_ms}ms`);
        }
      });
    }
  }
  console.log();

  console.log('='.repeat(70));
  console.log('DIAGNOSTIC COMPLETE');
  console.log('='.repeat(70));
}

diagnoseStorage().catch(console.error);
