/* eslint-disable */
const { createClient } = require('@supabase/supabase-js');
const { createLogger } = require('./function-logger.js');

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

function resolveMetaApiCtor() {
  try {
    const m = require('metaapi.cloud-sdk');
    return m.default || m.MetaApi || m;
  } catch (e) {
    throw new Error('MetaApi SDK not installed: ' + e.message);
  }
}

let metaApiInstance = null;
let accountCache = null;
let connectionCache = null;
let lastConnectionCheck = 0;
const CONNECTION_CACHE_TTL = 60000;

async function getMetaApiConnection(logger) {
  const now = Date.now();

  if (connectionCache && (now - lastConnectionCheck) < CONNECTION_CACHE_TTL) {
    logger.debug('Using cached MetaAPI connection');
    return connectionCache;
  }

  const token = process.env.METAAPI_ADMIN_TOKEN;
  const accountId = process.env.METAAPI_ACCOUNT_ID;
  const region = process.env.METAAPI_REGION || 'london';

  if (!token || !accountId) {
    throw new Error('MetaAPI credentials not configured');
  }

  logger.info('Creating MetaAPI connection', { region, accountId: accountId.substring(0, 8) + '...' });

  const MetaApi = resolveMetaApiCtor();

  if (!metaApiInstance) {
    metaApiInstance = new MetaApi(token, {
      application: 'pipnosis-ai-trading',
      domain: 'agiliumtrade.ai',
      region: region,
      requestTimeout: 30000
    });
  }

  if (!accountCache) {
    accountCache = await metaApiInstance.metatraderAccountApi.getAccount(accountId);
  }

  logger.info('Account status', {
    state: accountCache.state,
    connectionStatus: accountCache.connectionStatus
  });

  if (accountCache.state !== 'DEPLOYED') {
    throw new Error(`Account not deployed. State: ${accountCache.state}`);
  }

  const connection = accountCache.getRPCConnection();

  if (!connectionCache) {
    logger.info('Connecting to MetaAPI terminal...');
    await connection.connect();
    logger.info('Waiting for synchronization...');
    await connection.waitSynchronized();
    logger.success('Connection synchronized');
  }

  connectionCache = connection;
  lastConnectionCheck = now;

  return connection;
}

async function getPriceFromMetaApi(symbol, logger) {
  try {
    const connection = await getMetaApiConnection(logger);

    logger.info('Fetching price via MetaAPI RPC', { symbol });

    await connection.subscribeToMarketData(symbol, [
      { type: 'quotes' }
    ]);

    await new Promise(resolve => setTimeout(resolve, 1000));

    const terminalState = connection.terminalState;
    const price = terminalState.price(symbol);

    if (!price || !price.bid || !price.ask) {
      throw new Error('Price data not available yet');
    }

    logger.success('Price fetched from MetaAPI', {
      symbol,
      bid: price.bid,
      ask: price.ask
    });

    return {
      symbol,
      bid: price.bid,
      ask: price.ask,
      mid: (price.bid + price.ask) / 2,
      spread: price.ask - price.bid,
      time: price.time || new Date().toISOString(),
      source: 'metaapi-rpc',
      cached: false
    };
  } catch (err) {
    logger.error('MetaAPI RPC failed', { error: err.message });
    throw err;
  }
}

async function getPriceFromSupabase(symbol, logger, supabase) {
  logger.info('Fetching price from Supabase', { symbol });

  const { data, error } = await supabase
    .from('realtime_prices')
    .select('*')
    .eq('symbol', symbol)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error('Supabase query failed', { error: error.message });
    throw error;
  }

  if (!data) {
    logger.warn('No recent prices in Supabase for', symbol);
    throw new Error('No cached prices available');
  }

  const age = Date.now() - new Date(data.created_at).getTime();
  logger.info('Found cached price', { symbol, age: Math.floor(age / 1000) + 's' });

  return {
    symbol,
    bid: parseFloat(data.bid),
    ask: parseFloat(data.ask),
    mid: parseFloat(data.mid),
    spread: parseFloat(data.spread),
    time: data.broker_time,
    timestamp: data.created_at,
    source: 'supabase-cache',
    cached: true,
    age
  };
}

async function getPriceFromCandleFallback(symbol, logger, supabase) {
  logger.info('Falling back to candle data', { symbol });

  const { data, error } = await supabase
    .from('candles')
    .select('close, high, low, time')
    .eq('symbol', symbol)
    .order('time', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    logger.error('Candle fallback failed', { error: error?.message });
    throw new Error('No fallback data available');
  }

  const close = parseFloat(data.close);
  const estimatedSpread = (parseFloat(data.high) - parseFloat(data.low)) * 0.1;

  return {
    symbol,
    bid: close - estimatedSpread / 2,
    ask: close + estimatedSpread / 2,
    mid: close,
    spread: estimatedSpread,
    time: data.time,
    source: 'candle-fallback',
    cached: true
  };
}

exports.handler = async (event) => {
  const logger = createLogger('get-live-price');

  if (event.httpMethod === 'OPTIONS') {
    logger.info('OPTIONS request');
    return httpRes(200, { ok: true });
  }

  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const urlObj = new URL(event.rawUrl);
    const symbol = (urlObj.searchParams.get('symbol') || 'EURUSD').trim().toUpperCase();

    logger.info('Fetching price', { symbol });

    let result;
    let statusCode = 200;

    try {
      result = await getPriceFromMetaApi(symbol, logger);

      await supabase.from('realtime_prices').insert({
        symbol: result.symbol,
        bid: result.bid,
        ask: result.ask,
        mid: result.mid,
        spread: result.spread,
        broker_time: result.time,
        source: result.source
      });

    } catch (metaApiError) {
      logger.warn('MetaAPI unavailable, using fallback', { error: metaApiError.message });

      try {
        result = await getPriceFromSupabase(symbol, logger, supabase);
        statusCode = 200;
      } catch (supabaseError) {
        logger.warn('Supabase cache unavailable, using candle fallback');
        result = await getPriceFromCandleFallback(symbol, logger, supabase);
        statusCode = 200;
      }
    }

    result.ok = true;
    result.timestamp = new Date().toISOString();

    logger.success('Price retrieved', {
      symbol,
      source: result.source,
      cached: result.cached
    });

    await logger.saveToDatabase(statusCode, logger.getExecutionTime(), { symbol }, result, null);

    return httpRes(statusCode, result);

  } catch (err) {
    logger.error('Failed to get price', {
      message: err.message,
      stack: err.stack
    });

    await logger.saveToDatabase(500, logger.getExecutionTime(), null, null, err);

    return httpRes(500, {
      error: err.message || 'Failed to retrieve price',
      details: {
        message: err.message,
        name: err.name
      }
    });
  }
};
