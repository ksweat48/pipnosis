/* eslint-disable */
const { createClient } = require('@supabase/supabase-js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function httpRes(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function asNumber(n) {
  if (typeof n === 'number') return n;
  if (typeof n === 'string') return Number(n);
  return NaN;
}

async function fetchSymbolPrice({ adminToken, accountId, symbol }) {
  const host = 'https://mt-client-api-v1.london.agiliumtrade.ai';
  const url = `${host}/users/current/accounts/${accountId}/symbols/${encodeURIComponent(symbol)}/current-price`;

  try {
    const r = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!r.ok) {
      console.error(`[REST] ❌ ${symbol}: HTTP`, r.status);
      return { error: `HTTP ${r.status}` };
    }

    const json = await r.json();
    if (!json || (!json.bid && !json.ask)) {
      return { error: 'No bid/ask in response' };
    }

    const bid = asNumber(json.bid);
    const ask = asNumber(json.ask);
    const mid = (bid + ask) / 2;
    const time = json.time || json.brokerTime || new Date().toISOString();

    console.log(`[REST] ✓ ${symbol}: bid=${bid}, ask=${ask}, mid=${mid}`);
    return { bid, ask, mid, time, source: 'metaapi' };
  } catch (err) {
    console.error(`[REST] ❌ ${symbol}:`, err.message);
    return { error: err.message };
  }
}

async function fetchFromSupabaseFallback(symbol) {
  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('[Supabase Fallback] Missing credentials');
      return { error: 'Supabase not configured' };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
      .from('candles')
      .select('close, timestamp')
      .eq('symbol', symbol)
      .eq('timeframe', 'M1')
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      console.error(`[Supabase Fallback] ❌ ${symbol}:`, error?.message || 'No data');
      return { error: error?.message || 'No cached data available' };
    }

    const close = asNumber(data.close);
    const spread = close * 0.00010;
    const bid = close - spread / 2;
    const ask = close + spread / 2;
    const mid = close;
    const time = data.timestamp;

    console.log(`[Supabase Fallback] ✓ ${symbol}: Using cached price from ${time}`);
    return {
      bid,
      ask,
      mid,
      time,
      source: 'supabase_cache',
      cached: true
    };
  } catch (err) {
    console.error(`[Supabase Fallback] ❌ ${symbol}:`, err.message);
    return { error: err.message };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return httpRes(200, { ok: true });

  const adminToken = process.env.METAAPI_ADMIN_TOKEN;
  const accountId  = process.env.METAAPI_ACCOUNT_ID;
  const requestedSymbol = event.queryStringParameters?.symbol;

  if (!adminToken || !accountId) {
    return httpRes(500, { error: 'Missing METAAPI_ADMIN_TOKEN or METAAPI_ACCOUNT_ID' });
  }

  if (requestedSymbol) {
    const symbol = requestedSymbol.toUpperCase();
    console.log(`[get-latest-price] Fetching price for single symbol: ${symbol}`);

    let result = await fetchSymbolPrice({ adminToken, accountId, symbol });

    if (result.error) {
      console.log(`[get-latest-price] MetaAPI failed, trying Supabase fallback for ${symbol}`);
      result = await fetchFromSupabaseFallback(symbol);
    }

    if (result.error) {
      return httpRes(200, {
        symbol,
        error: result.error,
        timestamp: new Date().toISOString()
      });
    }

    return httpRes(200, {
      symbol,
      bid: result.bid,
      ask: result.ask,
      mid: result.mid,
      time: result.time,
      source: result.source || 'metaapi',
      cached: result.cached || false,
      timestamp: new Date().toISOString()
    });
  }

  const symbols = ['XAUUSD', 'EURUSD', 'GBPUSD', 'US30'];
  const results = {};

  for (const s of symbols) {
    let result = await fetchSymbolPrice({ adminToken, accountId, symbol: s });

    if (result.error) {
      result = await fetchFromSupabaseFallback(s);
    }

    results[s] = result;
  }

  return httpRes(200, {
    ok: true,
    source: 'metaapi',
    connection: 'polling',
    data: results,
    timestamp: new Date().toISOString()
  });
};
