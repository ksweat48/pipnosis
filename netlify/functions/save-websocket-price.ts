/**
 * Save WebSocket Price
 *
 * Persists real-time price data from browser WebSocket connections.
 * Accepts batched prices for efficient database writes.
 */

import type { Handler } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase-admin';

const supabase = getSupabaseAdmin();

const VALID_SYMBOLS = [
  'BTCUSD', 'ETHUSD',
  'XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY', 'NAS100', 'SPX500'
];

const PRICE_RANGES: Record<string, { min: number; max: number }> = {
  BTCUSD: { min: 10000, max: 500000 },
  ETHUSD: { min: 500, max: 50000 },
  XAUUSD: { min: 1000, max: 5000 },
  US30: { min: 20000, max: 60000 },
  EURUSD: { min: 0.5, max: 2.0 },
  GBPUSD: { min: 0.5, max: 2.5 },
  USDJPY: { min: 50, max: 250 },
  NAS100: { min: 8000, max: 30000 },
  SPX500: { min: 2000, max: 8000 },
};

interface WebSocketPrice {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  timestamp: string;
  source: string;
}

function validatePrice(price: WebSocketPrice): boolean {
  if (!VALID_SYMBOLS.includes(price.symbol)) {
    return false;
  }

  const range = PRICE_RANGES[price.symbol];
  if (!range) return false;

  if (price.bid < range.min || price.bid > range.max) {
    console.warn(`[SaveWSPrice] Invalid bid for ${price.symbol}: ${price.bid}`);
    return false;
  }

  if (price.ask < range.min || price.ask > range.max) {
    console.warn(`[SaveWSPrice] Invalid ask for ${price.symbol}: ${price.ask}`);
    return false;
  }

  if (price.ask < price.bid) {
    console.warn(`[SaveWSPrice] Ask < bid for ${price.symbol}: ask=${price.ask}, bid=${price.bid}`);
    return false;
  }

  const maxSpread = price.bid * 0.01;
  if (price.spread > maxSpread) {
    console.warn(`[SaveWSPrice] Excessive spread for ${price.symbol}: ${price.spread}`);
    return false;
  }

  return true;
}

export const handler: Handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const prices: WebSocketPrice[] = body.prices || [];

    if (!Array.isArray(prices) || prices.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No prices provided' }),
      };
    }

    if (prices.length > 100) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Too many prices in batch (max 100)' }),
      };
    }

    const validPrices = prices.filter(validatePrice);
    const invalidCount = prices.length - validPrices.length;

    if (validPrices.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'No valid prices',
          invalidCount,
        }),
      };
    }

    const records = validPrices.map(price => ({
      symbol: price.symbol,
      bid: price.bid,
      ask: price.ask,
      mid: price.mid,
      spread: price.spread,
      broker_time: price.timestamp,
      source: `browser_${price.source}`,
      created_at: new Date().toISOString(),
    }));

    console.log(`[SaveWSPrice] Attempting to insert ${records.length} price records`);
    console.log(`[SaveWSPrice] Symbols: ${records.map(r => r.symbol).join(', ')}`);

    const { error } = await supabase
      .from('realtime_prices')
      .insert(records);

    if (error) {
      console.error('[SaveWSPrice] Database error:', {
        message: error.message,
        code: (error as any).code,
        details: (error as any).details,
        hint: (error as any).hint,
        recordCount: records.length,
        symbols: records.map(r => r.symbol).join(', ')
      });

      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Database error',
          message: error.message,
          code: (error as any).code,
          details: (error as any).details,
          hint: (error as any).hint,
        }),
      };
    }

    console.log(`[SaveWSPrice] Successfully inserted ${records.length} price records`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        savedCount: validPrices.length,
        invalidCount,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    console.error('[SaveWSPrice] Unexpected error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Internal error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
