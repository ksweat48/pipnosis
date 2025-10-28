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

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'auth-token': token,
      'Content-Type': 'application/json'
    }
  });

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
}

async function getCachedPrice(symbol: string): Promise<{ bid: number; ask: number; timestamp: string; source: string; ageSeconds: number } | null> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data, error } = await supabase
    .from('realtime_prices')
    .select('bid, ask, broker_time, created_at')
    .eq('symbol', symbol.toUpperCase())
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
  if (event.httpMethod === 'OPTIONS') {
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
    console.error('[get-live-price] Error:', error);

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
