/* eslint-disable */
const fetch = require('node-fetch');

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

// ---- TRY 1: SDK path -------------------------------------------------------
async function trySdkTick({ adminToken, accountId, region, symbol }) {
  try {
    // Prefer the Node build of the SDK for serverless
    let MetaApi;
    try {
      const nodeMod = require('metaapi.cloud-sdk/node');
      MetaApi = nodeMod.default || nodeMod.MetaApi || nodeMod;
    } catch {
      const mainMod = require('metaapi.cloud-sdk');
      MetaApi = mainMod.default || mainMod.MetaApi || mainMod;
    }
    if (typeof MetaApi !== 'function') throw new Error('MetaApi constructor not found');

    const client = new MetaApi(adminToken, { region });
    const account = await client.metatraderAccountApi.getAccount(accountId);

    // Ensure terminal is connected (SDK usually handles internal waits, but we’ll be explicit)
    // Many SDKs expose .getSymbolPrice / .getPrice / .getTick – try the common ones in sequence.
    if (account && typeof account.getSymbolPrice === 'function') {
      const price = await account.getSymbolPrice(symbol);
      if (price && (price.bid || price.ask)) {
        return {
          bid: asNumber(price.bid),
          ask: asNumber(price.ask),
          time: price.time || price.timestamp || new Date().toISOString()
        };
      }
    }
    if (account && typeof account.getPrice === 'function') {
      const price = await account.getPrice(symbol);
      if (price && (price.bid || price.ask)) {
        return {
          bid: asNumber(price.bid),
          ask: asNumber(price.ask),
          time: price.time || price.timestamp || new Date().toISOString()
        };
      }
    }
    if (account && typeof account.getTick === 'function') {
      const price = await account.getTick(symbol);
      if (price && (price.bid || price.ask)) {
        return {
          bid: asNumber(price.bid),
          ask: asNumber(price.ask),
          time: price.time || price.timestamp || new Date().toISOString()
        };
      }
    }

    throw new Error('SDK did not return a price (no usable method or empty response)');
  } catch (err) {
    console.error('[get-latest-price][SDK] ❌', err.message);
    return null;
  }
}

// ---- TRY 2: REST path ------------------------------------------------------
// We use adminToken directly (Bearer) server-side. You can swap this to a narrowed
// token later by calling your get-metaapi-token function if you prefer.
async function tryRestTick({ adminToken, accountId, region, symbol }) {
  // region is like "new-york"; REST host is fixed:
  const host = 'https://mt-client-api-v1.agiliumtrade.ai';
  const headers = {
    Authorization: `Bearer ${adminToken}`,
    'Content-Type': 'application/json',
  };

  // We’ll try a few endpoint shapes commonly used by MetaAPI:
  const candidates = [
    // 1) symbols/{symbol}/tick
    `${host}/users/current/accounts/${accountId}/symbols/${encodeURIComponent(symbol)}/tick`,
    // 2) market-data/last-tick?symbol=...
    `${host}/users/current/accounts/${accountId}/market-data/last-tick?symbol=${encodeURIComponent(symbol)}`,
    // 3) symbols/{symbol}/price
    `${host}/users/current/accounts/${accountId}/symbols/${encodeURIComponent(symbol)}/price`,
  ];

  for (const url of candidates) {
    try {
      const r = await fetch(url, { headers, method: 'GET' });
      const text = await r.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* keep raw */ }

      if (!r.ok) {
        console.error(`[get-latest-price][REST] ✗ ${r.status} ${url}`, json || text);
        continue;
      }

      // Try to normalize various shapes
      let bid, ask, time;

      if (json) {
        // Common shapes: { bid, ask, time } or { tick: { bid, ask, time }} or { price: { bid, ask }}
        if (json.bid !== undefined || json.ask !== undefined) {
          bid = asNumber(json.bid);
          ask = asNumber(json.ask);
          time = json.time || json.timestamp || json.serverTime || new Date().toISOString();
        } else if (json.tick && (json.tick.bid !== undefined || json.tick.ask !== undefined)) {
          bid = asNumber(json.tick.bid);
          ask = asNumber(json.tick.ask);
          time = json.tick.time || json.tick.timestamp || new Date().toISOString();
        } else if (json.price && (json.price.bid !== undefined || json.price.ask !== undefined)) {
          bid = asNumber(json.price.bid);
          ask = asNumber(json.price.ask);
          time = json.price.time || json.price.timestamp || new Date().toISOString();
        }
      }

      if (Number.isFinite(bid) && Number.isFinite(ask)) {
        return { bid, ask, time };
      } else {
        console.error('[get-latest-price][REST] Unknown JSON shape from', url, json);
      }
    } catch (err) {
      console.error('[get-latest-price][REST] ❌', url, err.message);
      // try next candidate
    }
  }

  return null;
}

// ---- MAIN HANDLER ----------------------------------------------------------
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return httpRes(200, { ok: true });

  try {
    const adminToken = process.env.METAAPI_ADMIN_TOKEN;
    const accountId  = process.env.METAAPI_ACCOUNT_ID;
    const region     = process.env.METAAPI_REGION || 'new-york';

    if (!adminToken || !accountId) {
      console.error('[get-latest-price] Missing env vars', { hasAdmin: !!adminToken, hasAccount: !!accountId });
      return httpRes(500, { error: 'Server not configured: METAAPI_ADMIN_TOKEN or METAAPI_ACCOUNT_ID missing' });
    }

    const url = new URL(event.rawUrl || `https://${event.headers.host}${event.path}${event.rawQuery ? '?' + event.rawQuery : ''}`);
    const symbol = (url.searchParams.get('symbol') || 'EURUSD').trim().toUpperCase();

    // 1) Try SDK
    let tick = await trySdkTick({ adminToken, accountId, region, symbol });

    // 2) Fallback to REST if needed
    if (!tick) tick = await tryRestTick({ adminToken, accountId, region, symbol });

    if (!tick) {
      return httpRes(500, { error: 'Unable to fetch live price (SDK+REST failed)', symbol });
    }

    const bid = asNumber(tick.bid);
    const ask = asNumber(tick.ask);
    if (!Number.isFinite(bid) || !Number.isFinite(ask)) {
      return httpRes(502, { error: 'Bad price payload from provider', tick });
    }

    const mid = (bid + ask) / 2;
    const spread = ask - bid;

    return httpRes(200, {
      ok: true,
      symbol,
      bid,
      ask,
      mid,
      spread,
      timestamp: tick.time || new Date().toISOString(),
      source: 'metaapi',
      region,
      connection: 'polling'
    });
  } catch (err) {
    console.error('[get-latest-price] Uncaught error', err);
    return httpRes(500, { error: 'Internal server error', message: err.message });
  }
};
