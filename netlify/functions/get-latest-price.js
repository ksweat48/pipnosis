// netlify/functions/get-latest-price.js
// Returns latest tick (bid/ask/ts) for a symbol by polling every call.
// Tries SDK first; falls back to REST if SDK method differs by version.

const MetaApi = require('metaapi.cloud-sdk');

const ok = (data) => ({
  statusCode: 200,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  },
  body: JSON.stringify(data),
});

const bad = (code, msg, details) => ({
  statusCode: code,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
  body: JSON.stringify({ error: msg, details }),
});

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
        body: '',
      };
    }
    if (event.httpMethod !== 'GET') {
      return bad(405, 'Method not allowed');
    }

    const symbol = (event.queryStringParameters?.symbol || 'EURUSD').toUpperCase();

    const adminToken = process.env.METAAPI_ADMIN_TOKEN;
    const accountId = process.env.METAAPI_ACCOUNT_ID;
    const region = process.env.METAAPI_REGION || 'new-york';

    if (!adminToken || !accountId) {
      return bad(500, 'Missing METAAPI_ADMIN_TOKEN or METAAPI_ACCOUNT_ID');
    }

    // 1) Try SDK first
    try {
      const metaApi = new MetaApi(adminToken, { region });

      // Different SDKs expose price helpers differently. Try a few:
      // A) getSymbolPrice(accountId, symbol)
      if (metaApi?.metatraderAccountApi?.getSymbolPrice) {
        const p = await metaApi.metatraderAccountApi.getSymbolPrice(accountId, symbol);
        // normalize shape
        return ok({
          source: 'sdk:getSymbolPrice',
          symbol,
          bid: p?.bid ?? p?.bidPrice ?? p?.price?.bid,
          ask: p?.ask ?? p?.askPrice ?? p?.price?.ask,
          time: p?.time || p?.timestamp || new Date().toISOString(),
        });
      }

      // B) getTick (some versions name it differently)
      if (metaApi?.metatraderAccountApi?.getTick) {
        const t = await metaApi.metatraderAccountApi.getTick(accountId, symbol);
        return ok({
          source: 'sdk:getTick',
          symbol,
          bid: t?.bid,
          ask: t?.ask,
          time: t?.time || t?.timestamp || new Date().toISOString(),
        });
      }

      // C) fallback: getSymbolSpecification + lastQuote (not always present)
      if (metaApi?.metatraderAccountApi?.getSymbolSpecification) {
        const spec = await metaApi.metatraderAccountApi.getSymbolSpecification(accountId, symbol);
        if (spec?.symbol) {
          // Some SDKs expose last quote via getSymbolPrice; if not present above, drop to REST.
          // No-op here; continue to REST.
        }
      }
      // If we reach here, SDK didn't expose a usable price method → REST fallback.
    } catch (sdkErr) {
      // Fall through to REST
      console.log('[get-latest-price] SDK path failed:', sdkErr?.message);
    }

    // 2) REST fallback (works across SDK versions)
    // Admin token can call client API endpoints directly.
    const fetch = globalThis.fetch || (await import('node-fetch')).default;
    const base = `https://mt-client-api-v1.agiliumtrade.ai`;
    const url = `${base}/users/current/accounts/${accountId}/symbols/${encodeURIComponent(symbol)}/price`;

    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return bad(r.status, 'Failed to fetch price from REST', { url, body: txt.slice(0, 500) });
    }

    const j = await r.json();
    // Normalize a few likely shapes
    const bid =
      j?.bid ?? j?.bidPrice ?? j?.price?.bid ?? j?.tick?.bid ?? null;
    const ask =
      j?.ask ?? j?.askPrice ?? j?.price?.ask ?? j?.tick?.ask ?? null;
    const time = j?.time || j?.timestamp || j?.price?.time || new Date().toISOString();

    if (bid == null || ask == null) {
      return bad(502, 'Price payload missing bid/ask', { payload: j });
    }

    return ok({
      source: 'rest',
      symbol,
      bid,
      ask,
      time,
    });
  } catch (err) {
    return bad(500, 'Unexpected error', { message: err?.message, stack: err?.stack });
  }
};
