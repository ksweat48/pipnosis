/**
 * Get Latest Prices - Regular Netlify Function
 *
 * SSOT for cached price data delivery
 *
 * Replaces edge function with regular serverless function
 * Environment variables work properly in regular functions
 *
 * Architecture:
 * - Query latest prices from realtime_prices table
 * - Cache for 5 seconds (via HTTP headers)
 * - Return all symbols in one response
 * - Scales with Netlify's CDN
 */

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const handler: Handler = async (event) => {
  // Handle OPTIONS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  try {
    // Get Supabase credentials from environment
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('[get-latest-prices] Missing Supabase configuration');
      return {
        statusCode: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Supabase configuration missing',
          timestamp: new Date().toISOString()
        })
      };
    }

    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Fetch latest prices (one per symbol, within last 2 minutes)
    const { data: prices, error } = await supabase
      .from('realtime_prices')
      .select('symbol, bid, ask, timestamp')
      .gte('timestamp', new Date(Date.now() - 120000).toISOString()) // Last 2 minutes
      .order('timestamp', { ascending: false })
      .limit(20); // Get more than we need, we'll deduplicate

    if (error) {
      console.error('[get-latest-prices] Supabase error:', error);
      return {
        statusCode: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Failed to fetch prices',
          message: error.message,
          timestamp: new Date().toISOString()
        })
      };
    }

    // Deduplicate - keep only latest per symbol
    const latestPrices = new Map();
    if (prices) {
      for (const price of prices) {
        if (!latestPrices.has(price.symbol)) {
          latestPrices.set(price.symbol, price);
        }
      }
    }

    const result = Array.from(latestPrices.values());

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        // 5-second cache via CDN
        'Cache-Control': 'public, max-age=5, s-maxage=5, stale-while-revalidate=10',
        'CDN-Cache-Control': 'public, max-age=5'
      },
      body: JSON.stringify({
        prices: result,
        timestamp: new Date().toISOString(),
        count: result.length
      })
    };

  } catch (error) {
    console.error('[get-latest-prices] Unexpected error:', error);

    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      })
    };
  }
};
