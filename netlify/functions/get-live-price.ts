import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

interface MetaApiPrice {
  bid: number;
  ask: number;
  time?: string;
}

async function getMetaApiPrice(symbol: string): Promise<{ bid: number; ask: number; timestamp: string; source: string }> {
  const token = process.env.METAAPI_TOKEN;
  const accountId = process.env.METAAPI_ACCOUNT_ID;
  const region = process.env.METAAPI_REGION || 'new-york';

  if (!token || !accountId) {
    throw new Error('MetaAPI credentials not configured');
  }

  const url = `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}/symbols/${symbol}/current-price`;

  console.log(`[get-live-price] Fetching ${symbol} from MetaAPI`);
  console.log(`[get-live-price] URL: ${url}`);
  console.log(`[get-live-price] Region: ${region}`);
  console.log(`[get-live-price] Account ID: ${accountId}`);
  console.log(`[get-live-price] Token present: ${token ? 'YES' : 'NO'}`);
  console.log(`[get-live-price] Token length: ${token ? token.length : 0}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'auth-token': token,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    console.log(`[get-live-price] Response status: ${response.status}`);
    console.log(`[get-live-price] Response ok: ${response.ok}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[get-live-price] MetaAPI error response body:`, errorText);

      let errorDetail = errorText;
      if (response.status === 401) {
        errorDetail = 'Invalid or expired MetaAPI token';
      } else if (response.status === 403) {
        errorDetail = 'Access forbidden - check account permissions';
      } else if (response.status === 404) {
        errorDetail = `Symbol ${symbol} not found or account not connected`;
      } else if (response.status === 429) {
        errorDetail = 'Rate limit exceeded - too many requests';
      } else if (response.status >= 500) {
        errorDetail = 'MetaAPI server error - service may be down';
      }

      throw new Error(`MetaAPI HTTP ${response.status}: ${errorDetail}`);
    }

    const data: MetaApiPrice = await response.json();
    console.log(`[get-live-price] Price data received for ${symbol}:`, {
      bid: data.bid,
      ask: data.ask,
      hasTime: !!data.time
    });

    if (!data.bid || !data.ask) {
      console.error(`[get-live-price] Invalid price data:`, data);
      throw new Error(`Invalid price data from MetaAPI: bid=${data.bid}, ask=${data.ask}`);
    }

    if (isNaN(data.bid) || isNaN(data.ask)) {
      console.error(`[get-live-price] Price values are NaN:`, data);
      throw new Error(`Invalid numeric values: bid=${data.bid}, ask=${data.ask}`);
    }

    return {
      bid: parseFloat(String(data.bid)),
      ask: parseFloat(String(data.ask)),
      timestamp: data.time || new Date().toISOString(),
      source: 'metaapi-live'
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      console.error(`[get-live-price] Request timeout for ${symbol} after 8 seconds`);
      throw new Error(`MetaAPI request timeout after 8 seconds for ${symbol}`);
    }
    console.error(`[get-live-price] Fetch error for ${symbol}:`, error);
    throw error;
  }
}

async function getCachedPrice(symbol: string): Promise<{ bid: number; ask: number; timestamp: string; source: string; ageSeconds: number } | null> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const thirtySecondsAgo = new Date(Date.now() - 30000).toISOString();

  const { data, error } = await supabase
    .from('realtime_prices')
    .select('bid, ask, broker_time, created_at')
    .eq('symbol', symbol.toUpperCase())
    .gte('created_at', thirtySecondsAgo)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const ageSeconds = Math.floor((Date.now() - new Date(data.created_at).getTime()) / 1000);

  return {
    bid: parseFloat(data.bid),
    ask: parseFloat(data.ask),
    timestamp: data.broker_time,
    source: 'supabase-cache',
    ageSeconds
  };
}

export const handler: Handler = async (event) => {
  console.log('[get-live-price] Function invoked');
  console.log('[get-live-price] HTTP Method:', event.httpMethod);

  if (event.httpMethod === 'OPTIONS') {
    console.log('[get-live-price] Handling OPTIONS preflight request');
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  try {
    const params = new URLSearchParams(event.rawUrl?.split('?')[1] || '');
    const symbol = params.get('symbol') || 'EURUSD';
    const requestId = Math.random().toString(36).substring(7);

    console.log(`[get-live-price][${requestId}] ========== NEW REQUEST ==========`);
    console.log(`[get-live-price][${requestId}] Symbol: ${symbol}`);
    console.log(`[get-live-price][${requestId}] Env check - METAAPI_TOKEN: ${process.env.METAAPI_TOKEN ? 'SET' : 'MISSING'}`);
    console.log(`[get-live-price][${requestId}] Env check - METAAPI_ACCOUNT_ID: ${process.env.METAAPI_ACCOUNT_ID || 'MISSING'}`);
    console.log(`[get-live-price][${requestId}] Env check - METAAPI_REGION: ${process.env.METAAPI_REGION || 'MISSING'}`);

    let priceData;
    let ok = true;
    let fetchMethod = 'unknown';

    try {
      console.log(`[get-live-price][${requestId}] Attempting to fetch live price from MetaAPI...`);
      priceData = await getMetaApiPrice(symbol);
      fetchMethod = 'metaapi-live';
      console.log(`[get-live-price][${requestId}] ✓ Live price fetched successfully: ${priceData.bid}/${priceData.ask}`);
    } catch (metaError) {
      console.warn(`[get-live-price][${requestId}] ✗ MetaAPI failed:`, metaError instanceof Error ? metaError.message : String(metaError));
      console.log(`[get-live-price][${requestId}] Attempting to use cached price...`);

      const cached = await getCachedPrice(symbol);
      if (cached) {
        priceData = cached;
        fetchMethod = 'cache';
        console.log(`[get-live-price][${requestId}] ✓ Using cached price (${cached.ageSeconds}s old): ${priceData.bid}/${priceData.ask}`);
      } else {
        console.error(`[get-live-price][${requestId}] ✗ No cached data available`);
        throw new Error('Unable to fetch live price and no cached data available');
      }
    }

    console.log(`[get-live-price][${requestId}] ========== REQUEST SUCCESS (${fetchMethod}) ==========`);

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ok,
        symbol: symbol.toUpperCase(),
        ...priceData
      })
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error('[get-live-price] ========== REQUEST FAILED ==========');
    console.error('[get-live-price] ERROR:', error);
    console.error('[get-live-price] Error type:', error instanceof Error ? error.constructor.name : typeof error);
    console.error('[get-live-price] Error message:', errorMessage);
    if (errorStack) {
      console.error('[get-live-price] Error stack:', errorStack);
    }

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ok: false,
        error: errorMessage,
        source: 'error',
        timestamp: new Date().toISOString()
      })
    };
  }
};
