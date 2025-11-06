import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const FOREX_PAIRS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];
const LONG_TIMEFRAMES = ['H4', 'D1', 'W1'];

function getTimeframeMinutes(timeframe) {
  const map = {
    'H4': 240,
    'D1': 1440,
    'W1': 10080
  };
  return map[timeframe] || 1440;
}

function getLookbackDays(timeframe) {
  const map = {
    'H4': 90,
    'D1': 365,
    'W1': 730
  };
  return map[timeframe] || 365;
}

async function fetchHistoricalCandles(symbol, timeframe) {
  const token = process.env.METAAPI_TOKEN;
  const accountId = process.env.METAAPI_ACCOUNT_ID;
  const region = process.env.METAAPI_REGION || 'new-york';

  if (!token || !accountId) {
    console.error('Missing MetaAPI credentials');
    return [];
  }

  const lookbackDays = getLookbackDays(timeframe);
  const startTime = new Date();
  startTime.setDate(startTime.getDate() - lookbackDays);

  const url = `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}/historical-market-data/symbols/${symbol}/timeframes/${timeframe}/candles?startTime=${startTime.toISOString()}&limit=10000`;

  console.log(`Fetching ${timeframe} candles for ${symbol} from ${startTime.toISOString()}...`);

  try {
    const response = await fetch(url, {
      headers: {
        'auth-token': token,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`MetaAPI error for ${symbol} ${timeframe}:`, response.status, errorText);
      return [];
    }

    const candles = await response.json();
    console.log(`Received ${candles.length} ${timeframe} candles for ${symbol}`);
    return candles;
  } catch (error) {
    console.error(`Error fetching ${symbol} ${timeframe} candles:`, error);
    return [];
  }
}

async function saveCandlesToDatabase(symbol, timeframe, candles) {
  if (!candles || candles.length === 0) {
    console.log(`No candles to save for ${symbol} ${timeframe}`);
    return { inserted: 0, errors: 0 };
  }

  const timeframeMinutes = getTimeframeMinutes(timeframe);
  let inserted = 0;
  let errors = 0;

  const candleRecords = candles.map(candle => {
    const openTime = new Date(candle.time);
    const closeTime = new Date(openTime.getTime() + timeframeMinutes * 60 * 1000);

    return {
      symbol,
      timeframe,
      open_time: openTime.toISOString(),
      close_time: closeTime.toISOString(),
      open: parseFloat(candle.open),
      high: parseFloat(candle.high),
      low: parseFloat(candle.low),
      close: parseFloat(candle.close),
      volume: candle.tickVolume ? parseFloat(candle.tickVolume) : 0,
      tick_count: candle.tickVolume ? parseInt(candle.tickVolume) : 0
    };
  });

  const BATCH_SIZE = 100;
  for (let i = 0; i < candleRecords.length; i += BATCH_SIZE) {
    const batch = candleRecords.slice(i, i + BATCH_SIZE);

    try {
      const { data, error } = await supabase
        .from('forex_candles')
        .upsert(batch, {
          onConflict: 'symbol,timeframe,open_time',
          ignoreDuplicates: false
        });

      if (error) {
        console.error(`Error saving batch ${i / BATCH_SIZE + 1} for ${symbol} ${timeframe}:`, error);
        errors += batch.length;
      } else {
        inserted += batch.length;
        console.log(`Saved batch ${i / BATCH_SIZE + 1}/${Math.ceil(candleRecords.length / BATCH_SIZE)} for ${symbol} ${timeframe}`);
      }
    } catch (err) {
      console.error(`Exception saving batch for ${symbol} ${timeframe}:`, err);
      errors += batch.length;
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return { inserted, errors };
}

async function backfillSymbolTimeframe(symbol, timeframe) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Backfilling ${symbol} ${timeframe}`);
  console.log('='.repeat(60));

  const candles = await fetchHistoricalCandles(symbol, timeframe);

  if (candles.length === 0) {
    console.log(`No candles fetched for ${symbol} ${timeframe}`);
    return { symbol, timeframe, inserted: 0, errors: 0 };
  }

  const result = await saveCandlesToDatabase(symbol, timeframe, candles);

  console.log(`${symbol} ${timeframe}: Inserted ${result.inserted}, Errors ${result.errors}`);

  return {
    symbol,
    timeframe,
    ...result
  };
}

async function main() {
  console.log('Starting Daily and Weekly Candle Backfill');
  console.log('=========================================\n');

  const results = [];

  for (const symbol of FOREX_PAIRS) {
    for (const timeframe of LONG_TIMEFRAMES) {
      try {
        const result = await backfillSymbolTimeframe(symbol, timeframe);
        results.push(result);

        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`Failed to backfill ${symbol} ${timeframe}:`, error);
        results.push({
          symbol,
          timeframe,
          inserted: 0,
          errors: 1
        });
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Backfill Summary');
  console.log('='.repeat(60));

  let totalInserted = 0;
  let totalErrors = 0;

  results.forEach(result => {
    console.log(`${result.symbol} ${result.timeframe}: ${result.inserted} inserted, ${result.errors} errors`);
    totalInserted += result.inserted;
    totalErrors += result.errors;
  });

  console.log('\nTotal Inserted:', totalInserted);
  console.log('Total Errors:', totalErrors);
  console.log('\nBackfill completed!');

  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
