#!/usr/bin/env node

/**
 * Local Bootstrap Runner
 * Runs bootstrap logic locally without waiting for Netlify deployment
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
config({ path: join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials in .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const BINANCE_API_URL = 'https://api.binance.com';

const CRYPTO_SYMBOLS = [
  { pipnosis: 'BTCUSD', binance: 'BTCUSDT' },
  { pipnosis: 'ETHUSD', binance: 'ETHUSDT' },
  { pipnosis: 'SOLUSD', binance: 'SOLUSDT' },
  { pipnosis: 'BNBUSD', binance: 'BNBUSDT' },
];

const TIMEFRAMES = [
  { pipnosis: 'M1', binance: '1m' },
  { pipnosis: 'M5', binance: '5m' },
  { pipnosis: 'M15', binance: '15m' },
  { pipnosis: 'M30', binance: '30m' },
  { pipnosis: 'H1', binance: '1h' },
  { pipnosis: 'H4', binance: '4h' },
  { pipnosis: 'D1', binance: '1d' },
];

const DAYS_TO_FETCH = 7;

async function fetchBinanceCandles(binanceSymbol, binanceInterval, startTime, endTime) {
  try {
    const url = `${BINANCE_API_URL}/api/v3/klines?symbol=${binanceSymbol}&interval=${binanceInterval}&startTime=${startTime}&endTime=${endTime}&limit=1000`;

    const response = await fetch(url);

    if (!response.ok) {
      console.error(`  ❌ HTTP ${response.status} for ${binanceSymbol} ${binanceInterval}`);
      return [];
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`  ❌ Error fetching ${binanceSymbol}:`, error.message);
    return [];
  }
}

async function bootstrapCryptoSymbols() {
  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║         Bootstrapping Crypto Symbols (Local Execution)               ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Symbols: ${CRYPTO_SYMBOLS.map(s => s.pipnosis).join(', ')}`);
  console.log(`Timeframes: ${TIMEFRAMES.map(t => t.pipnosis).join(', ')}`);
  console.log(`Days to fetch: ${DAYS_TO_FETCH}`);
  console.log('');

  const endTime = Date.now();
  const startTime = endTime - (DAYS_TO_FETCH * 24 * 60 * 60 * 1000);

  let totalSuccess = 0;
  let totalFailed = 0;
  let totalCandles = 0;

  for (const symbol of CRYPTO_SYMBOLS) {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📊 ${symbol.pipnosis} (${symbol.binance})`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    for (const timeframe of TIMEFRAMES) {
      process.stdout.write(`  ${timeframe.pipnosis}... `);

      const klines = await fetchBinanceCandles(
        symbol.binance,
        timeframe.binance,
        startTime,
        endTime
      );

      if (klines.length === 0) {
        console.log('❌ No data');
        totalFailed++;
        continue;
      }

      const candles = klines.map((kline) => {
        const [openTime, open, high, low, close, volume, closeTime] = kline;
        return {
          symbol: symbol.pipnosis,
          timeframe: timeframe.pipnosis,
          open_time: new Date(openTime).toISOString(),
          close_time: new Date(closeTime).toISOString(),
          open: parseFloat(open),
          high: parseFloat(high),
          low: parseFloat(low),
          close: parseFloat(close),
          volume: parseFloat(volume),
        };
      });

      const { error } = await supabase
        .from('market_data_m5')
        .upsert(candles, {
          onConflict: 'symbol,timeframe,open_time',
          ignoreDuplicates: false
        });

      if (error) {
        console.log(`❌ DB error: ${error.message}`);
        totalFailed++;
      } else {
        console.log(`✅ ${candles.length} candles saved`);
        totalSuccess++;
        totalCandles += candles.length;
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log('');
  }

  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║                         Bootstrap Complete!                           ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`✅ Successful: ${totalSuccess}`);
  console.log(`❌ Failed: ${totalFailed}`);
  console.log(`📊 Total candles saved: ${totalCandles}`);
  console.log('');
}

// Run the bootstrap
bootstrapCryptoSymbols()
  .then(() => {
    console.log('✨ All done! Your crypto symbols now have historical data.');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Open the Pipnosis app');
    console.log('  2. Select BTCUSD from the dropdown');
    console.log('  3. The chart should display historical candles');
    console.log('');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
