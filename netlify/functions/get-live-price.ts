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

  console.log(`[get-live-price] Fetching ${symbol} from MetaAPI (${region})`);

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

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MetaAPI error: ${response.status} - ${errorText}`);
    }

    const data: MetaApiPrice = await response.json();

    if (!data.bid || !data.ask) {
      throw new Error('Invalid price data from MetaAPI');
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
      throw new Error('MetaAPI request timeout after 8 seconds');
    }
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

    console.log(`[get-live-price] Request for ${symbol}`);
    console.log(`[get-live-price] Env check - METAAPI_TOKEN: ${process.env.METAAPI_TOKEN ? 'SET' : 'MISSING'}`);
    console.log(`[get-live-price] Env check - METAAPI_ACCOUNT_ID: ${process.env.METAAPI_ACCOUNT_ID || 'MISSING'}`);
    console.log(`[get-live-price] Env check - METAAPI_REGION: ${process.env.METAAPI_REGION || 'MISSING'}`);

    let priceData;
    let ok = true;

    try {
      priceData = await getMetaApiPrice(symbol);
      console.log(`[get-live-price] Live price fetched successfully`);
    } catch (metaError) {
      console.warn(`[get-live-price] MetaAPI failed, trying cache:`, metaError);

      const cached = await getCachedPrice(symbol);
      if (cached) {
        priceData = cached;
        console.log(`[get-live-price] Using cached price (${cached.ageSeconds}s old)`);
      } else {
        throw new Error('Unable to fetch live price and no cached data available');
      }
    }

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
    console.error('[get-live-price] ERROR:', error);
    console.error('[get-live-price] Error type:', error instanceof Error ? error.constructor.name : typeof error);
    console.error('[get-live-price] Error message:', error instanceof Error ? error.message : String(error));

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        source: 'error'
      })
    };
  }
};
