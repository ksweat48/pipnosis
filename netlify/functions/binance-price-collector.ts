/**
 * Binance Price Collector
 *
 * Fetches real-time cryptocurrency prices from Binance API.
 * Used for 24/7 crypto trading support (BTCUSD, ETHUSD, SOLUSD, BNBUSD).
 *
 * Binance API is free and doesn't require authentication for public price data.
 */

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const BINANCE_BASE_URL = 'https://api.binance.com';

const CRYPTO_SYMBOL_MAP: Record<string, string> = {
  'BTCUSD': 'BTCUSDT',
  'ETHUSD': 'ETHUSDT',
  'SOLUSD': 'SOLUSDT',
  'BNBUSD': 'BNBUSDT',
};

const PIPNOSIS_SYMBOLS = Object.keys(CRYPTO_SYMBOL_MAP);

interface BinanceTickerPrice {
  symbol: string;
  price: string;
}

interface BinanceBookTicker {
  symbol: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
}

interface CryptoPrice {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  timestamp: string;
  source: string;
}

async function fetchBinanceBookTicker(binanceSymbol: string): Promise<BinanceBookTicker | null> {
  try {
    const url = `${BINANCE_BASE_URL}/api/v3/ticker/bookTicker?symbol=${binanceSymbol}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error(`[BinanceCollector] HTTP ${response.status} for ${binanceSymbol}`);
      return null;
    }

    const data: BinanceBookTicker = await response.json();
    return data;
  } catch (error) {
    console.error(`[BinanceCollector] Error fetching ${binanceSymbol}:`, error);
    return null;
  }
}

async function fetchAllBinancePrices(): Promise<CryptoPrice[]> {
  const prices: CryptoPrice[] = [];

  for (const [pipnosisSymbol, binanceSymbol] of Object.entries(CRYPTO_SYMBOL_MAP)) {
    const ticker = await fetchBinanceBookTicker(binanceSymbol);

    if (ticker) {
      const bid = parseFloat(ticker.bidPrice);
      const ask = parseFloat(ticker.askPrice);
      const mid = (bid + ask) / 2;
      const spread = ask - bid;

      prices.push({
        symbol: pipnosisSymbol,
        bid,
        ask,
        mid,
        spread,
        timestamp: new Date().toISOString(),
        source: 'binance'
      });

      console.log(`[BinanceCollector] ${pipnosisSymbol}: ${bid}/${ask} (spread: ${spread.toFixed(4)})`);
    } else {
      console.error(`[BinanceCollector] Failed to fetch ${pipnosisSymbol}`);
    }

    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return prices;
}

async function savePricesToDatabase(prices: CryptoPrice[]): Promise<number> {
  let savedCount = 0;

  for (const price of prices) {
    try {
      const { error } = await supabase
        .from('realtime_prices')
        .insert({
          symbol: price.symbol,
          bid: price.bid.toString(),
          ask: price.ask.toString(),
          mid: price.mid.toString(),
          spread: price.spread.toString(),
          broker_time: price.timestamp,
          source: price.source
        });

      if (error) {
        console.error(`[BinanceCollector] DB error for ${price.symbol}:`, error);
      } else {
        savedCount++;
      }
    } catch (error) {
      console.error(`[BinanceCollector] Exception saving ${price.symbol}:`, error);
    }
  }

  return savedCount;
}

async function updateFallbackCache(prices: CryptoPrice[]): Promise<void> {
  for (const price of prices) {
    try {
      await supabase
        .from('polling_fallback_cache')
        .upsert({
          symbol: price.symbol,
          bid: price.bid.toString(),
          ask: price.ask.toString(),
          mid: price.mid.toString(),
          spread: price.spread.toString(),
          source: price.source,
          quality_score: 100,
          broker_time: price.timestamp,
          expires_at: new Date(Date.now() + 3600000).toISOString()
        }, {
          onConflict: 'symbol'
        });
    } catch (error) {
      console.warn(`[BinanceCollector] Fallback cache error for ${price.symbol}:`, error);
    }
  }
}

export const handler: Handler = async (event) => {
  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-cache, no-store, must-revalidate'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  console.log('[BinanceCollector] Starting crypto price collection...');

  try {
    const params = new URLSearchParams(event.rawUrl?.split('?')[1] || '');
    const singleSymbol = params.get('symbol');

    let prices: CryptoPrice[];

    if (singleSymbol) {
      const normalizedSymbol = singleSymbol.toUpperCase();
      const binanceSymbol = CRYPTO_SYMBOL_MAP[normalizedSymbol];

      if (!binanceSymbol) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            ok: false,
            error: `Unknown crypto symbol: ${singleSymbol}. Supported: ${PIPNOSIS_SYMBOLS.join(', ')}`
          })
        };
      }

      const ticker = await fetchBinanceBookTicker(binanceSymbol);

      if (!ticker) {
        return {
          statusCode: 503,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            ok: false,
            error: `Failed to fetch price for ${singleSymbol} from Binance`
          })
        };
      }

      const bid = parseFloat(ticker.bidPrice);
      const ask = parseFloat(ticker.askPrice);

      prices = [{
        symbol: normalizedSymbol,
        bid,
        ask,
        mid: (bid + ask) / 2,
        spread: ask - bid,
        timestamp: new Date().toISOString(),
        source: 'binance'
      }];
    } else {
      prices = await fetchAllBinancePrices();
    }

    const savedCount = await savePricesToDatabase(prices);
    await updateFallbackCache(prices);

    console.log(`[BinanceCollector] Completed: ${savedCount}/${prices.length} prices saved`);

    if (singleSymbol && prices.length === 1) {
      const price = prices[0];
      return {
        statusCode: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ok: true,
          symbol: price.symbol,
          bid: price.bid,
          ask: price.ask,
          mid: price.mid,
          spread: price.spread,
          timestamp: price.timestamp,
          source: price.source,
          dataQuality: 'LIVE'
        })
      };
    }

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ok: true,
        message: `Collected ${prices.length} crypto prices, saved ${savedCount}`,
        symbols: prices.map(p => p.symbol),
        prices: prices.map(p => ({
          symbol: p.symbol,
          bid: p.bid,
          ask: p.ask,
          spread: p.spread
        }))
      })
    };

  } catch (error) {
    console.error('[BinanceCollector] Fatal error:', error);

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
