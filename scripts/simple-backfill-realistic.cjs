#!/usr/bin/env node

/**
 * Simple Historical Backfill with Realistic Candles
 */

const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SYMBOLS = [
  { name: 'EURUSD', basePrice: 1.06, volatility: 0.001 },
  { name: 'GBPUSD', basePrice: 1.27, volatility: 0.0012 },
  { name: 'USDJPY', basePrice: 151.5, volatility: 0.5 },
  { name: 'XAUUSD', basePrice: 2630, volatility: 10 },
  { name: 'US30', basePrice: 43500, volatility: 150 }
];

const TIMEFRAMES = [
  { name: 'M5', minutes: 5, candles: 2000 },
  { name: 'M15', minutes: 15, candles: 1500 },
  { name: 'M30', minutes: 30, candles: 1000 },
  { name: 'H1', minutes: 60, candles: 720 },
  { name: 'H4', minutes: 240, candles: 360 },
  { name: 'D1', minutes: 1440, candles: 180 }
];

function generateRealisticCandles(symbol, timeframe, count) {
  const candles = [];
  const now = new Date();
  const { basePrice, volatility } = symbol;

  let currentPrice = basePrice;
  const startTime = new Date(now.getTime() - (count * timeframe.minutes * 60 * 1000));

  for (let i = 0; i < count; i++) {
    const openTime = new Date(startTime.getTime() + (i * timeframe.minutes * 60 * 1000));
    const closeTime = new Date(openTime.getTime() + (timeframe.minutes * 60 * 1000));

    const trendChange = (Math.random() - 0.48) * volatility * 0.5;
    const open = currentPrice;
    const close = open + trendChange;
    const range = Math.abs(trendChange) + (Math.random() * volatility);
    const high = Math.max(open, close) + (range * Math.random());
    const low = Math.min(open, close) - (range * Math.random());

    const precision = ['USDJPY', 'XAUUSD', 'US30'].includes(symbol.name) ? 2 : 5;

    candles.push({
      symbol: symbol.name,
      timeframe: timeframe.name,
      open_time: openTime.toISOString(),
      close_time: closeTime.toISOString(),
      open: parseFloat(open.toFixed(precision)),
      high: parseFloat(high.toFixed(precision)),
      low: parseFloat(low.toFixed(precision)),
      close: parseFloat(close.toFixed(precision)),
      volume: Math.floor(Math.random() * 1000) + 100,
      data_source: 'synthetic_backfill'
    });

    currentPrice = close;
  }

  return candles;
}

async function backfillData() {
  console.log('TPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPW');
  console.log('Q      SIMPLE HISTORICAL CANDLE BACKFILL                    Q');
  console.log('ZPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP]\n');

  let totalInserted = 0;

  for (const symbol of SYMBOLS) {
    console.log(`\n=� Processing ${symbol.name}...`);

    for (const timeframe of TIMEFRAMES) {
      process.stdout.write(`  ${timeframe.name.padEnd(5)} - Generating ${timeframe.candles} candles... `);

      const candles = generateRealisticCandles(symbol, timeframe, timeframe.candles);

      let inserted = 0;
      for (let i = 0; i < candles.length; i += 100) {
        const batch = candles.slice(i, i + 100);

        const { error } = await supabase
          .from('forex_candles')
          .upsert(batch, {
            onConflict: 'symbol,timeframe,open_time',
            ignoreDuplicates: false
          });

        if (error && !error.message.includes('duplicate')) {
          console.log(`\n    �  Error: ${error.message}`);
        } else {
          inserted += batch.length;
        }
      }

      totalInserted += inserted;
      console.log(` ${inserted} candles`);
    }
  }

  console.log('\n' + 'P'.repeat(60));
  console.log(` Backfill Complete!`);
  console.log(`=� Total candles inserted: ${totalInserted}`);
  console.log('P'.repeat(60) + '\n');

  console.log('<� Next Steps:');
  console.log('  1. Hard refresh your browser (Ctrl+Shift+R)');
  console.log('  2. Navigate to your chart');
  console.log('  3. You should now see months of historical candles!\n');
}

backfillData().catch(error => {
  console.error('\nL Error:', error);
  process.exit(1);
});
