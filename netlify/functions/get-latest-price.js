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
    const symbol = (new URL(event.rawUrl).searchParams.get('symbol') || 'EURUSD')
      .trim()
      .toUpperCase();

    if (!token || !accountId) {
      return httpRes(500, { error: 'MetaAPI configuration missing' });
    }

    const url = `https://mt-client-api-v1.agiliumtrade.ai/users/current/accounts/${accountId}/symbols/${symbol}/tick`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const json = await res.json();

    if (!res.ok || !json.bid || !json.ask) {
      return httpRes(502, {
        error: 'Bad price payload from MetaAPI',
        raw: json
      });
    }

    return httpRes(200, {
      ok: true,
      symbol,
      bid: Number(json.bid),
      ask: Number(json.ask),
      time: json.time || new Date().toISOString(),
      source: 'metaapi',
      region,
      connection: 'polling'
    });
  } catch (err) {
    return httpRes(500, { error: 'Internal error', message: err.message });
  }
};
