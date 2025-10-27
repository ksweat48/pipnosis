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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return httpRes(200, { ok: true });

  try {
    const token = process.env.METAAPI_ADMIN_TOKEN;
    const accountId = process.env.METAAPI_ACCOUNT_ID;
    const region = process.env.METAAPI_REGION || 'london';

    if (!token || !accountId) {
      return httpRes(500, { error: 'MetaAPI not configured (Missing token or accountId)' });
    }

    const urlObj = new URL(event.rawUrl);
    const symbol = (urlObj.searchParams.get('symbol') || 'EURUSD').trim().toUpperCase();

    // ✅ REST API call directly to MetaAPI with region support
    const restUrl = `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}/symbols/${symbol}/tick`;

    const response = await fetch(restUrl, {
      headers: { Authorization: `Bearer ${token}` },
      method: 'GET',
    });

    const json = await response.json();

    if (!response.ok || !json.bid || !json.ask) {
      return httpRes(502, {
        error: 'Invalid tick data',
        raw: json
      });
    }

    const bid = Number(json.bid);
    const ask = Number(json.ask);
    const mid = (bid + ask) / 2;
    const spread = ask - bid;

    return httpRes(200, {
      ok: true,
      symbol,
      bid,
      ask,
      mid,
      spread,
      timestamp: json.time || json.timestamp || new Date().toISOString(),
      source: 'metaapi',
      connection: 'polling'
    });

  } catch (err) {
    console.error('[get-latest-price] ERROR', err);
    return httpRes(500, { error: err.message || 'Internal error' });
  }
};
