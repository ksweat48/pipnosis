/* eslint-disable */
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
  const host = 'https://mt-client-api-v1.agiliumtrade.ai';
  const url = `${host}/users/current/accounts/${accountId}/symbols/${encodeURIComponent(symbol)}/price`;

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
    if (!json || !json.bid || !json.ask) {
      return { error: 'No bid/ask in response' };
    }

    const bid = asNumber(json.bid);
    const ask = asNumber(json.ask);
    const mid = (bid + ask) / 2;
    const time = json.time || json.timestamp || new Date().toISOString();

    return { bid, ask, mid, time };
  } catch (err) {
    console.error(`[REST] ❌ ${symbol}:`, err.message);
    return { error: err.message };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return httpRes(200, { ok: true });

  const adminToken = process.env.METAAPI_ADMIN_TOKEN;
  const accountId  = process.env.METAAPI_ACCOUNT_ID;

  if (!adminToken || !accountId) {
    return httpRes(500, { error: 'Missing METAAPI_ADMIN_TOKEN or METAAPI_ACCOUNT_ID' });
  }

  const symbols = ['XAUUSD', 'EURUSD', 'GBPUSD', 'US30'];
  const results = {};

  for (const s of symbols) {
    results[s] = await fetchSymbolPrice({ adminToken, accountId, symbol: s });
  }

  return httpRes(200, {
    ok: true,
    source: 'metaapi',
    connection: 'polling',
    data: results,
    timestamp: new Date().toISOString()
  });
};
