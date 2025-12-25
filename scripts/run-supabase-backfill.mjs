import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

const NEW_PAIRS = ['GBPJPY', 'EURJPY', 'AUDUSD', 'NZDUSD'];
const TIMEFRAMES = ['M1', 'M5', 'M15', 'H1', 'H4', 'D1'];

const TIMEFRAME_DAYS = {
  'M1': 7,
  'M5': 14,
  'M15': 30,
  'H1': 90,
  'H4': 180,
  'D1': 730,
};

async function backfillSymbol(symbol, timeframe, days) {
  const url = `${SUPABASE_URL}/functions/v1/dukascopy-backfill?symbol=${symbol}&timeframe=${timeframe}&days=${days}&overwrite=true`;

  console.log(`\n🔄 Backfilling ${symbol} ${timeframe} (${days} days)...`);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const result = await response.json();

    if (result.success) {
      const symbolResult = result.results.find(r => r.symbol === symbol && r.timeframe === timeframe);
      if (symbolResult) {
        console.log(`✅ ${symbol} ${timeframe}: ${symbolResult.candlesSaved} candles saved`);
        return { success: true, ...symbolResult };
      }
    }

    throw new Error(result.error || 'Unknown error');

  } catch (error) {
    console.error(`❌ ${symbol} ${timeframe}: ${error.message}`);
    return {
      success: false,
      symbol,
      timeframe,
      error: error.message,
      candlesSaved: 0
    };
  }
}

async function runBackfill() {
  console.log('\n========================================');
  console.log('SUPABASE EDGE FUNCTION BACKFILL');
  console.log('========================================');
  console.log(`Symbols: ${NEW_PAIRS.join(', ')}`);
  console.log(`Timeframes: ${TIMEFRAMES.join(', ')}`);
  console.log(`Total operations: ${NEW_PAIRS.length * TIMEFRAMES.length}`);
  console.log('========================================\n');

  const startTime = Date.now();
  const results = [];

  for (const symbol of NEW_PAIRS) {
    console.log(`\n📊 Starting ${symbol}...`);

    for (const timeframe of TIMEFRAMES) {
      const days = TIMEFRAME_DAYS[timeframe];
      const result = await backfillSymbol(symbol, timeframe, days);
      results.push(result);

      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  const successCount = results.filter(r => r.success).length;
  const totalCandles = results.reduce((sum, r) => sum + (r.candlesSaved || 0), 0);

  console.log('\n========================================');
  console.log('BACKFILL COMPLETED');
  console.log('========================================');
  console.log(`Duration: ${duration}s`);
  console.log(`Success Rate: ${successCount}/${results.length}`);
  console.log(`Total Candles Saved: ${totalCandles}`);
  console.log('========================================\n');

  console.log('DETAILED RESULTS BY SYMBOL:');
  for (const symbol of NEW_PAIRS) {
    console.log(`\n${symbol}:`);
    const symbolResults = results.filter(r => r.symbol === symbol);
    let symbolTotal = 0;
    for (const result of symbolResults) {
      const status = result.success ? '✅' : '❌';
      console.log(`  ${status} ${result.timeframe}: ${result.candlesSaved || 0} candles`);
      symbolTotal += result.candlesSaved || 0;
      if (result.error) {
        console.log(`    Error: ${result.error}`);
      }
    }
    console.log(`  Total: ${symbolTotal} candles`);
  }

  console.log('\n========================================\n');

  if (successCount < results.length) {
    console.error(`⚠️  ${results.length - successCount} operations failed!`);
    process.exit(1);
  }

  console.log('🎉 All backfills completed successfully!');
}

runBackfill();
