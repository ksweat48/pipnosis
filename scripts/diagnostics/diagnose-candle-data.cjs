const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function diagnoseDatabase() {
  console.log('='.repeat(80));
  console.log('FOREX CANDLES DATABASE DIAGNOSTIC');
  console.log('='.repeat(80));
  console.log('');

  // Check if table exists and get schema
  console.log('1. Checking forex_candles table structure...');
  try {
    const { data: tableInfo, error: tableError } = await supabase
      .from('forex_candles')
      .select('*')
      .limit(1);

    if (tableError) {
      console.error('❌ Error accessing forex_candles table:', tableError.message);
      console.log('   Code:', tableError.code);
      console.log('   Details:', tableError.details);
      return;
    }

    if (tableInfo && tableInfo.length > 0) {
      console.log('✅ Table exists. Sample row columns:');
      console.log('   ', Object.keys(tableInfo[0]).join(', '));
    } else {
      console.log('⚠️  Table exists but is EMPTY');
    }
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    return;
  }

  console.log('');
  console.log('2. Counting total candles...');
  const { count: totalCount, error: countError } = await supabase
    .from('forex_candles')
    .select('*', { count: 'exact', head: true });

  if (countError) {
    console.error('❌ Error counting candles:', countError.message);
  } else {
    console.log(`   Total candles in database: ${totalCount || 0}`);
  }

  console.log('');
  console.log('3. Checking candles by symbol and timeframe...');
  const { data: groupedData, error: groupError } = await supabase
    .from('forex_candles')
    .select('symbol, timeframe')
    .order('symbol');

  if (groupError) {
    console.error('❌ Error querying grouped data:', groupError.message);
  } else if (!groupedData || groupedData.length === 0) {
    console.log('   ⚠️  NO DATA FOUND IN TABLE');
  } else {
    // Group manually
    const grouped = {};
    groupedData.forEach(row => {
      const key = `${row.symbol}-${row.timeframe}`;
      grouped[key] = (grouped[key] || 0) + 1;
    });

    console.log('   Symbol-Timeframe Distribution:');
    Object.entries(grouped)
      .sort((a, b) => b[1] - a[1])
      .forEach(([key, count]) => {
        const [symbol, timeframe] = key.split('-');
        console.log(`   - ${symbol.padEnd(10)} ${timeframe.padEnd(5)}: ${count} candles`);
      });
  }

  console.log('');
  console.log('4. Checking unique timeframe formats...');
  const { data: timeframes, error: tfError } = await supabase
    .from('forex_candles')
    .select('timeframe')
    .order('timeframe');

  if (tfError) {
    console.error('❌ Error querying timeframes:', tfError.message);
  } else if (!timeframes || timeframes.length === 0) {
    console.log('   ⚠️  NO TIMEFRAMES FOUND');
  } else {
    const uniqueTimeframes = [...new Set(timeframes.map(t => t.timeframe))];
    console.log('   Unique timeframe values in database:');
    uniqueTimeframes.forEach(tf => {
      console.log(`   - "${tf}"`);
    });
  }

  console.log('');
  console.log('5. Checking date ranges...');
  const symbols = ['EURUSD', 'XAUUSD', 'US30', 'GBPUSD', 'USDJPY'];
  const timeframeFormats = ['1m', '5m', '1h', 'M1', 'M5', 'H1', '1M', '5M', '1H'];

  for (const symbol of symbols) {
    for (const tf of timeframeFormats) {
      const { data: rangeData, error: rangeError } = await supabase
        .from('forex_candles')
        .select('open_time')
        .eq('symbol', symbol)
        .eq('timeframe', tf)
        .order('open_time', { ascending: true })
        .limit(1);

      if (!rangeError && rangeData && rangeData.length > 0) {
        const { data: latestData } = await supabase
          .from('forex_candles')
          .select('open_time')
          .eq('symbol', symbol)
          .eq('timeframe', tf)
          .order('open_time', { ascending: false })
          .limit(1);

        const { count } = await supabase
          .from('forex_candles')
          .select('*', { count: 'exact', head: true })
          .eq('symbol', symbol)
          .eq('timeframe', tf);

        console.log(`   ${symbol} ${tf}: ${count} candles (${rangeData[0].open_time} to ${latestData[0].open_time})`);
      }
    }
  }

  console.log('');
  console.log('6. Checking for data_source column...');
  const { data: sampleWithSource, error: sourceError } = await supabase
    .from('forex_candles')
    .select('symbol, timeframe, data_source, open_time')
    .limit(5);

  if (!sourceError && sampleWithSource && sampleWithSource.length > 0) {
    console.log('   ✅ data_source column exists. Sample values:');
    sampleWithSource.forEach(row => {
      console.log(`   - ${row.symbol} ${row.timeframe}: ${row.data_source || 'NULL'}`);
    });
  } else if (sourceError) {
    console.log('   ⚠️  data_source column may not exist:', sourceError.message);
  } else {
    console.log('   ⚠️  No data to check data_source');
  }

  console.log('');
  console.log('7. Sample candle data (if any exists)...');
  const { data: sampleCandles, error: sampleError } = await supabase
    .from('forex_candles')
    .select('*')
    .order('open_time', { ascending: false })
    .limit(3);

  if (!sampleError && sampleCandles && sampleCandles.length > 0) {
    console.log('   Latest 3 candles:');
    sampleCandles.forEach((candle, idx) => {
      console.log(`   ${idx + 1}. ${candle.symbol} ${candle.timeframe} @ ${candle.open_time}`);
      console.log(`      O: ${candle.open} H: ${candle.high} L: ${candle.low} C: ${candle.close}`);
    });
  } else {
    console.log('   ⚠️  NO SAMPLE DATA AVAILABLE');
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('DIAGNOSTIC COMPLETE');
  console.log('='.repeat(80));
}

diagnoseDatabase()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
