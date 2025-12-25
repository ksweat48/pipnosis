/**
 * Binance Historical Candle Fetcher
 *
 * Fetches historical candlestick data from Binance public API (no authentication required).
 * Used to bootstrap historical data for crypto symbols: BTCUSD, ETHUSD, SOLUSD, BNBUSD
 *
 * Binance API: GET /api/v3/klines
 * - Free public endpoint
 * - Returns up to 1000 candles per request
 * - Supports: 1m, 5m, 15m, 30m, 1h, 4h, 1d intervals
 */

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

interface BinanceKline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  quoteAssetVolume: string;
  numberOfTrades: number;
  takerBuyBaseAssetVolume: string;
  takerBuyQuoteAssetVolume: string;
}

interface CandleData {
  symbol: string;
  timeframe: string;
  open_time: string;
  close_time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function fetchBinanceKlines(
  binanceSymbol: string,
  interval: string,
  startTime: number,
  endTime: number,
  limit: number = 1000
): Promise<any[]> {
  try {
    const url = `${BINANCE_API_URL}/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${limit}`;

    console.log(`[BinanceHistorical] Fetching ${binanceSymbol} ${interval} from ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      console.error(`[BinanceHistorical] HTTP ${response.status} for ${binanceSymbol}`);
      return [];
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`[BinanceHistorical] Error fetching ${binanceSymbol}:`, error);
    return [];
  }
}

function convertBinanceKlinesToCandles(
  klines: any[],
  pipnosisSymbol: string,
  pipnosisTimeframe: string
): CandleData[] {
  return klines.map((kline) => {
    const [openTime, open, high, low, close, volume, closeTime] = kline;

    return {
      symbol: pipnosisSymbol,
      timeframe: pipnosisTimeframe,
      open_time: new Date(openTime).toISOString(),
      close_time: new Date(closeTime).toISOString(),
      open: parseFloat(open),
      high: parseFloat(high),
      low: parseFloat(low),
      close: parseFloat(close),
      volume: parseFloat(volume),
    };
  });
}

async function saveCandlesToDatabase(candles: CandleData[]): Promise<number> {
  if (candles.length === 0) {
    return 0;
  }

  try {
    const { data, error } = await supabase
      .from('market_data_m5')
      .upsert(candles, {
        onConflict: 'symbol,timeframe,open_time',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('[BinanceHistorical] Database error:', error);
      return 0;
    }

    return candles.length;
  } catch (error) {
    console.error('[BinanceHistorical] Exception saving candles:', error);
    return 0;
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

  console.log('[BinanceHistorical] Starting historical candle fetch...');

  try {
    const params = new URLSearchParams(event.rawUrl?.split('?')[1] || '');
    const symbol = params.get('symbol')?.toUpperCase();
    const timeframe = params.get('timeframe')?.toUpperCase() || 'M5';
    const daysBack = parseInt(params.get('days') || '7', 10);
    const limit = parseInt(params.get('limit') || '1000', 10);

    if (!symbol) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          ok: false,
          error: 'Missing required parameter: symbol',
          supportedSymbols: Object.keys(CRYPTO_SYMBOL_MAP)
        })
      };
    }

    const binanceSymbol = CRYPTO_SYMBOL_MAP[symbol];
    if (!binanceSymbol) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          ok: false,
          error: `Unsupported symbol: ${symbol}`,
          supportedSymbols: Object.keys(CRYPTO_SYMBOL_MAP)
        })
      };
    }

    const binanceInterval = TIMEFRAME_MAP[timeframe];
    if (!binanceInterval) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          ok: false,
          error: `Unsupported timeframe: ${timeframe}`,
          supportedTimeframes: Object.keys(TIMEFRAME_MAP)
        })
      };
    }

    const endTime = Date.now();
    const startTime = endTime - (daysBack * 24 * 60 * 60 * 1000);

    console.log(`[BinanceHistorical] Fetching ${symbol} (${binanceSymbol}) ${timeframe} for last ${daysBack} days`);

    const klines = await fetchBinanceKlines(
      binanceSymbol,
      binanceInterval,
      startTime,
      endTime,
      limit
    );

    if (klines.length === 0) {
      return {
        statusCode: 503,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          ok: false,
          error: 'No candles returned from Binance',
          symbol,
          timeframe
        })
      };
    }

    const candles = convertBinanceKlinesToCandles(klines, symbol, timeframe);
    const savedCount = await saveCandlesToDatabase(candles);

    console.log(`[BinanceHistorical] Saved ${savedCount}/${candles.length} candles for ${symbol} ${timeframe}`);

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ok: true,
        symbol,
        timeframe,
        binanceSymbol,
        candlesFetched: klines.length,
        candlesSaved: savedCount,
        dateRange: {
          start: new Date(startTime).toISOString(),
          end: new Date(endTime).toISOString()
        },
        firstCandle: candles[0]?.open_time,
        lastCandle: candles[candles.length - 1]?.open_time
      })
    };

  } catch (error) {
    console.error('[BinanceHistorical] Fatal error:', error);

    return {
      statusCode: 500,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      })
    };
  }
};
