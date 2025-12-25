/**
 * Bootstrap Index Symbols
 *
 * One-time function to populate historical candle data for index symbols.
 * Fetches 7 days of historical data for all timeframes from MetaAPI.
 *
 * Symbols: NAS100, SPX500
 * Timeframes: M1, M5, M15, M30, H1, H4, D1
 *
 * Note: Indices follow forex market hours (not 24/7 like crypto)
 */

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const metaApiToken = process.env.METAAPI_TOKEN!;
const metaApiAccountId = process.env.METAAPI_ACCOUNT_ID!;
const metaApiRegion = process.env.METAAPI_REGION || 'new-york';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const INDEX_SYMBOLS = ['NAS100', 'SPX500'];
const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
const DAYS_TO_FETCH = 7;

interface BootstrapResult {
  symbol: string;
  timeframe: string;
  success: boolean;
  candlesFetched: number;
  candlesSaved: number;
  error?: string;
}

async function fetchMetaApiCandles(
  symbol: string,
  timeframe: string,
  startTime: Date,
  endTime: Date
): Promise<any[]> {
  try {
    const url = `https://mt-client-api-v1.${metaApiRegion}.agiliumtrade.ai/users/current/accounts/${metaApiAccountId}/historical-market-data/symbols/${symbol}/timeframes/${timeframe}/candles`;

    const params = new URLSearchParams({
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      limit: '1000'
    });

    const response = await fetch(`${url}?${params}`, {
      method: 'GET',
      headers: {
        'auth-token': metaApiToken,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error(`[IndexBootstrap] MetaAPI HTTP ${response.status} for ${symbol} ${timeframe}`);
      return [];
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      console.error(`[IndexBootstrap] Invalid response format for ${symbol} ${timeframe}`);
      return [];
    }

    return data;

  } catch (error) {
    console.error(`[IndexBootstrap] Error fetching ${symbol} ${timeframe}:`, error);
    return [];
  }
}

async function fetchAndSaveCandlesForSymbol(
  symbol: string,
  timeframe: string
): Promise<BootstrapResult> {
  try {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - (DAYS_TO_FETCH * 24 * 60 * 60 * 1000));

    console.log(`[IndexBootstrap] Fetching ${symbol} ${timeframe} from ${startTime.toISOString()} to ${endTime.toISOString()}`);

    const metaCandles = await fetchMetaApiCandles(symbol, timeframe, startTime, endTime);

    if (metaCandles.length === 0) {
      return {
        symbol,
        timeframe,
        success: false,
        candlesFetched: 0,
        candlesSaved: 0,
        error: 'No candles returned from MetaAPI'
      };
    }

    const candles = metaCandles.map((candle: any) => {
      const openTime = new Date(candle.time);
      const timeframeMinutes = getTimeframeMinutes(timeframe);
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
        volume: parseFloat(candle.tickVolume || candle.volume || 0),
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
        candlesFetched: metaCandles.length,
        candlesSaved: 0,
        error: error.message
      };
    }

    console.log(`[IndexBootstrap] ✓ ${symbol} ${timeframe}: ${candles.length} candles saved`);

    return {
      symbol,
      timeframe,
      success: true,
      candlesFetched: metaCandles.length,
      candlesSaved: candles.length
    };

  } catch (error) {
    console.error(`[IndexBootstrap] Error for ${symbol} ${timeframe}:`, error);
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

function getTimeframeMinutes(timeframe: string): number {
  const map: Record<string, number> = {
    'M1': 1,
    'M5': 5,
    'M15': 15,
    'M30': 30,
    'H1': 60,
    'H4': 240,
    'D1': 1440
  };
  return map[timeframe] || 5;
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

  if (!metaApiToken || !metaApiAccountId) {
    return {
      statusCode: 500,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ok: false,
        error: 'MetaAPI credentials not configured',
        timestamp: new Date().toISOString()
      })
    };
  }

  console.log('[IndexBootstrap] Starting bootstrap for index symbols...');
  console.log(`[IndexBootstrap] Symbols: ${INDEX_SYMBOLS.join(', ')}`);
  console.log(`[IndexBootstrap] Timeframes: ${TIMEFRAMES.join(', ')}`);
  console.log(`[IndexBootstrap] Days to fetch: ${DAYS_TO_FETCH}`);

  const startTime = Date.now();
  const results: BootstrapResult[] = [];

  try {
    for (const symbol of INDEX_SYMBOLS) {
      for (const timeframe of TIMEFRAMES) {
        const result = await fetchAndSaveCandlesForSymbol(symbol, timeframe);
        results.push(result);

        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    const duration = Date.now() - startTime;
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalCandles = results.reduce((sum, r) => sum + r.candlesSaved, 0);

    console.log(`[IndexBootstrap] Completed in ${duration}ms`);
    console.log(`[IndexBootstrap] Success: ${successful}, Failed: ${failed}`);
    console.log(`[IndexBootstrap] Total candles saved: ${totalCandles}`);

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ok: true,
        summary: {
          totalSymbols: INDEX_SYMBOLS.length,
          totalTimeframes: TIMEFRAMES.length,
          totalOperations: results.length,
          successful,
          failed,
          totalCandlesSaved: totalCandles,
          durationMs: duration
        },
        symbols: INDEX_SYMBOLS,
        timeframes: TIMEFRAMES,
        daysBack: DAYS_TO_FETCH,
        results: results,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('[IndexBootstrap] Fatal error:', error);

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
