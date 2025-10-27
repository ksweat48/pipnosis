/* eslint-disable */
const { createClient } = require('@supabase/supabase-js');
const { createLogger } = require('./function-logger.js');
const { createRestClient } = require('./metaapi-rest-client.js');

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

async function getPriceFromMetaApi(symbol, logger) {
  const token = process.env.METAAPI_ADMIN_TOKEN;
  const accountId = process.env.METAAPI_ACCOUNT_ID || process.env.VITE_METAAPI_ACCOUNT_ID;
  const region = process.env.METAAPI_REGION || process.env.VITE_METAAPI_REGION || 'cloud-g2';

  if (!token || !accountId) {
    throw new Error('MetaAPI credentials not configured');
  }

  logger.info('Fetching price via MetaAPI REST', { symbol, region });

  const client = createRestClient(token, { region, timeout: 8000 });

  const priceData = await client.getSymbolPrice(accountId, symbol);

  if (!priceData || !priceData.bid || !priceData.ask) {
    throw new Error('Price data not available');
  }

  logger.success('Price fetched from MetaAPI REST', {
    symbol,
    bid: priceData.bid,
    ask: priceData.ask
  });

  return {
    symbol,
    bid: priceData.bid,
    ask: priceData.ask,
    mid: (priceData.bid + priceData.ask) / 2,
    spread: priceData.ask - priceData.bid,
    time: priceData.time || new Date().toISOString(),
    source: 'metaapi-rest',
    cached: false
  };
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
  const ageSeconds = Math.floor(age / 1000);

  logger.info('Found cached price', { symbol, ageSeconds });

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
    age,
    ageSeconds
  };
}

async function getPriceFromCandleFallback(symbol, logger, supabase) {
  logger.info('Falling back to market data', { symbol });

  const { data, error } = await supabase
    .from('market_data')
    .select('close, high, low, timestamp, timeframe')
    .eq('symbol', symbol)
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    logger.error('Market data fallback failed', { error: error?.message });
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
    time: data.timestamp,
    source: 'market-data-fallback',
    cached: true,
    timeframe: data.timeframe
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
