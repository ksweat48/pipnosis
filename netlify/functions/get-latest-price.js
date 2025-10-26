// netlify/functions/get-latest-price.js
// MT5 live price (polling) via MetaAPI REST + MID calculation
// - Uses your narrowed token from get-metaapi-token
// - No SDK usage
// - Returns bid/ask/mid/spread/timestamps
// - Region-aware

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: CORS,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const url = new URL(event.rawUrl || `${event.headers['x-forwarded-proto'] || 'https'}://${event.headers.host}${event.path}${event.rawQuery ? `?${event.rawQuery}` : ''}`);
    const symbol = (url.searchParams.get('symbol') || '').trim().toUpperCase();

    if (!symbol) {
      return {
        statusCode: 400,
        headers: CORS,
        body: JSON.stringify({ error: 'Missing required query param: symbol' })
      };
    }

    const accountId = process.env.METAAPI_ACCOUNT_ID;
    const region = (process.env.METAAPI_REGION || 'new-york').trim();

    if (!accountId) {
      return {
        statusCode: 500,
        headers: CORS,
        body: JSON.stringify({ error: 'Missing METAAPI_ACCOUNT_ID in environment' })
      };
    }

    // --- 1) Get narrowed token from our secure function ---
    const siteBase =
      process.env.SITE_BASE_URL?.replace(/\/+$/, '') ||
      process.env.URL?.replace(/\/+$/, '') ||
      `${url.protocol}//${url.host}`;

    const tokenRes = await fetch(`${siteBase}/.netlify/functions/get-metaapi-token`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!tokenRes.ok) {
      const txt = await tokenRes.text().catch(() => '');
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({
          error: 'Failed to obtain narrowed token',
          status: tokenRes.status,
          body: txt
        })
      };
    }

    const { token } = await tokenRes.json();
    if (!token) {
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({ error: 'Token service did not return a token' })
      };
    }

    // --- 2) Call MetaAPI MT5 REST tick endpoint ---
    // MT5 endpoint form:
    // https://mt-client-api-v1.<region>.agiliumtrade.ai/users/current/accounts/<accountId>/quotes/tick?symbol=EURUSD
    const tickUrl = `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${encodeURIComponent(
      accountId
    )}/quotes/tick?symbol=${encodeURIComponent(symbol)}`;

    const resp = await fetch(tickUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      }
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({
          error: 'MetaAPI tick request failed',
          status: resp.status,
          body: errBody
        })
      };
    }

    const data = await resp.json();

    // Expected MT5 shape usually includes bid/ask and a time field.
    // Safely extract:
    const bid = Number(data.bid ?? data.price?.bid);
    const ask = Number(data.ask ?? data.price?.ask);

    if (!Number.isFinite(bid) || !Number.isFinite(ask)) {
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({
          error: 'MetaAPI response missing bid/ask',
          raw: data
        })
      };
    }

    // MID & spread
    const mid = (bid + ask) / 2;
    const spread = ask - bid;

    // Simple pip size heuristic (good enough for majors/cfds)
    const pipSize =
      /JPY$/i.test(symbol) ? 0.01
      : /XAU|XAG|XBR|XTI/i.test(symbol) ? 0.1
      : 0.0001;

    const spreadPips = pipSize ? +(spread / pipSize).toFixed(2) : null;

    // Timestamps (normalize to ISO)
    const brokerTime =
      data.time ||
      data.brokerTime ||
      data.timestamp ||
      data.serverTime ||
      null;

    const serverTs = new Date().toISOString();

    return {
      statusCode: 200,
      headers: {
        ...CORS,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({
        ok: true,
        symbol,
        bid,
        ask,
        mid: +mid.toFixed(6),
        spread,
        spreadPips,
        timestamps: {
          brokerTime,
          serverTime: serverTs
        },
        source: 'metaapi-rest-mt5',
        region,
        accountId
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error: 'Unhandled get-latest-price error',
        message: err?.message || String(err)
      })
    };
  }
};
