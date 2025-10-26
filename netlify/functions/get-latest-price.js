const REGION = process.env.METAAPI_REGION || 'new-york';
const ACCOUNT_ID = process.env.METAAPI_ACCOUNT_ID;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders
    },
    body: JSON.stringify(obj),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders };
  }

  try {
    if (!ACCOUNT_ID) {
      return json(500, { error: 'METAAPI_ACCOUNT_ID not set' });
    }

    const params = new URLSearchParams(event.queryStringParameters || {});
    const symbol = params.get('symbol') || 'EURUSD';

    const origin =
      process.env.SITE_BASE_URL ||
      `https://${process.env.URL?.replace(/^https?:\/\//, '') || event.headers.host}`;

    const tokenResp = await fetch(`${origin}/.netlify/functions/get-metaapi-token`);
    if (!tokenResp.ok) {
      const t = await tokenResp.text();
      return json(500, { error: 'Failed to obtain MetaAPI token', details: t });
    }
    const { token } = await tokenResp.json();
    if (!token) {
      return json(500, { error: 'No token returned from token service' });
    }

    const base = `https://mt-client-api-v1.${REGION}.agiliumtrade.ai`;
    const url = `${base}/users/current/accounts/${ACCOUNT_ID}/symbols/${encodeURIComponent(
      symbol
    )}/price`;

    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return json(500, {
        error: 'MetaAPI price request failed',
        status: resp.status,
        details: errText,
      });
    }

    const data = await resp.json();
    const bid = Number(data.bid);
    const ask = Number(data.ask);
    const mid = (bid + ask) / 2;
    const spread = (isFinite(ask - bid) ? ask - bid : undefined);

    return json(200, {
      symbol: data.symbol || symbol,
      bid,
      ask,
      mid,
      spread,
      time: data.time || new Date().toISOString(),
      connectionState: 'connected',
    });
  } catch (err) {
    return json(500, {
      error: 'Unhandled error in get-latest-price',
      details: err.message
    });
  }
};
