/**
 * Bootstrap Crypto Symbols
 *
 * One-time function to populate historical candle data for all crypto symbols.
 * Fetches 7 days of historical data for all timeframes from Binance.
 *
 * Symbols: BTCUSD, ETHUSD, SOLUSD, BNBUSD
 * Timeframes: M1, M5, M15, M30, H1, H4, D1
 *
 * This function can be run manually or scheduled to ensure all crypto symbols have sufficient historical data.
 */

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const CRYPTO_SYMBOLS = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'BNBUSD'];
const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
const DAYS_TO_FETCH = 7;

const BINANCE_API_URL = 'https://api.binance.com';

const CRYPTO_SYMBOL_MAP: Record<string, string> = {
  'BTCUSD': 'BTCUSDT',
  'ETHUSD': 'ETHUSDT',
  'SOLUSD': 'SOLUSDT',
  'BNBUSD': 'BNBUSDT',
};

const TIMEFRAME_MAP: Record<string, string> = {
  'M1': '1m',
  'M5': '5m',
  'M15': '15m',
  'M30': '30m',
  'H1': '1h',
  'H4': '4h',
  'D1': '1d',
};

interface BootstrapResult {
  symbol: string;
  timeframe: string;
  success: boolean;
  candlesFetched: number;
  candlesSaved: number;
  error?: string;
}

async function fetchAndSaveCandlesForSymbol(
  symbol: string,
  timeframe: string
): Promise<BootstrapResult> {
  try {
    const binanceSymbol = CRYPTO_SYMBOL_MAP[symbol];
    const binanceInterval = TIMEFRAME_MAP[timeframe];

    if (!binanceSymbol || !binanceInterval) {
      return {
        symbol,
        timeframe,
        success: false,
        candlesFetched: 0,
        candlesSaved: 0,
        error: 'Invalid symbol or timeframe mapping'
      };
    }

    const endTime = Date.now();
    const startTime = endTime - (DAYS_TO_FETCH * 24 * 60 * 60 * 1000);

    const url = `${BINANCE_API_URL}/api/v3/klines?symbol=${binanceSymbol}&interval=${binanceInterval}&startTime=${startTime}&endTime=${endTime}&limit=1000`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      return {
        symbol,
        timeframe,
        success: false,
        candlesFetched: 0,
        candlesSaved: 0,
        error: `HTTP ${response.status}`
      };
    }

    const klines = await response.json();

    if (!Array.isArray(klines) || klines.length === 0) {
      return {
        symbol,
        timeframe,
        success: false,
        candlesFetched: 0,
        candlesSaved: 0,
        error: 'No candles returned'
      };
    }

    const candles = klines.map((kline: any) => {
      const [openTime, open, high, low, close, volume, closeTime] = kline;

      return {
        symbol,
        timeframe,
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
      return {
        symbol,
        timeframe,
        success: false,
        candlesFetched: klines.length,
        candlesSaved: 0,
        error: error.message
      };
    }

    console.log(`[CryptoBootstrap] ✓ ${symbol} ${timeframe}: ${candles.length} candles saved`);

    return {
      symbol,
      timeframe,
      success: true,
      candlesFetched: klines.length,
      candlesSaved: candles.length
    };

  } catch (error) {
    console.error(`[CryptoBootstrap] Error for ${symbol} ${timeframe}:`, error);
    return {
      symbol,
      timeframe,
      success: false,
      candlesFetched: 0,
      candlesSaved: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export const handler: Handler = async (event) => {
  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  console.log('[CryptoBootstrap] Starting bootstrap for crypto symbols...');
  console.log(`[CryptoBootstrap] Symbols: ${CRYPTO_SYMBOLS.join(', ')}`);
  console.log(`[CryptoBootstrap] Timeframes: ${TIMEFRAMES.join(', ')}`);
  console.log(`[CryptoBootstrap] Days to fetch: ${DAYS_TO_FETCH}`);

  const startTime = Date.now();
  const results: BootstrapResult[] = [];

  try {
    for (const symbol of CRYPTO_SYMBOLS) {
      for (const timeframe of TIMEFRAMES) {
        const result = await fetchAndSaveCandlesForSymbol(symbol, timeframe);
        results.push(result);

        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    const duration = Date.now() - startTime;
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalCandles = results.reduce((sum, r) => sum + r.candlesSaved, 0);

    console.log(`[CryptoBootstrap] Completed in ${duration}ms`);
    console.log(`[CryptoBootstrap] Success: ${successful}, Failed: ${failed}`);
    console.log(`[CryptoBootstrap] Total candles saved: ${totalCandles}`);

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ok: true,
        summary: {
          totalSymbols: CRYPTO_SYMBOLS.length,
          totalTimeframes: TIMEFRAMES.length,
          totalOperations: results.length,
          successful,
          failed,
          totalCandlesSaved: totalCandles,
          durationMs: duration
        },
        symbols: CRYPTO_SYMBOLS,
        timeframes: TIMEFRAMES,
        daysBack: DAYS_TO_FETCH,
        results: results,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('[CryptoBootstrap] Fatal error:', error);

    return {
      statusCode: 500,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        results: results,
        timestamp: new Date().toISOString()
      })
    };
  }
};
