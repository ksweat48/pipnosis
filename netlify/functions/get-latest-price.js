/* eslint-disable */
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

exports.handler = async (event) => {
  const logger = createLogger('get-latest-price');

  if (event.httpMethod === 'OPTIONS') {
    logger.info('OPTIONS request received');
    return httpRes(200, { ok: true });
  }

  try {
    const token = process.env.METAAPI_ADMIN_TOKEN || process.env.VITE_METAAPI_ADMIN_TOKEN;
    const accountId = process.env.METAAPI_ACCOUNT_ID || process.env.VITE_METAAPI_ACCOUNT_ID;
    const region = process.env.METAAPI_REGION || process.env.VITE_METAAPI_REGION || 'london';

    logger.info('Environment check', {
      hasToken: !!token,
      hasAccountId: !!accountId,
      region,
      tokenLength: token?.length || 0,
      accountIdLength: accountId?.length || 0
    });

    if (!token || !accountId) {
      logger.error('MetaAPI not configured', {
        hasToken: !!token,
        hasAccountId: !!accountId
      });

      const statusCode = 500;
      await logger.saveToDatabase(statusCode, logger.getExecutionTime(), null, null, 'Missing token or accountId');

      return httpRes(statusCode, {
        error: 'MetaAPI not configured (Missing token or accountId)',
        details: {
          hasToken: !!token,
          hasAccountId: !!accountId
        }
      });
    }

    const urlObj = new URL(event.rawUrl);
    const symbol = (urlObj.searchParams.get('symbol') || 'EURUSD').trim().toUpperCase();

    logger.info('Fetching price', { symbol, region });

    const restUrl = `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}/symbols/${symbol}/tick`;

    logger.debug('Request URL', { restUrl: restUrl.replace(accountId, 'REDACTED') });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    let response;
    try {
      response = await fetch(restUrl, {
        headers: { Authorization: `Bearer ${token}` },
        method: 'GET',
        signal: controller.signal
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);

      if (fetchError.name === 'AbortError') {
        logger.error('Request timeout after 8 seconds', { symbol });
        const statusCode = 504;
        await logger.saveToDatabase(statusCode, logger.getExecutionTime(), { symbol }, null, 'Request timeout');
        return httpRes(statusCode, { error: 'Request timeout - MetaAPI took too long to respond' });
      }

      throw fetchError;
    }

    clearTimeout(timeoutId);

    logger.info('Response received', {
      status: response.status,
      ok: response.ok,
      statusText: response.statusText
    });

    const json = await response.json();

    logger.debug('Response data', {
      hasBid: !!json.bid,
      hasAsk: !!json.ask,
      keys: Object.keys(json)
    });

    if (!response.ok) {
      logger.error('MetaAPI error response', {
        status: response.status,
        response: json
      });

      const statusCode = 502;
      await logger.saveToDatabase(statusCode, logger.getExecutionTime(), { symbol }, json, `MetaAPI returned ${response.status}`);

      return httpRes(statusCode, {
        error: 'MetaAPI error',
        status: response.status,
        details: json
      });
    }

    if (!json.bid || !json.ask) {
      logger.error('Invalid tick data - missing bid/ask', { response: json });

      const statusCode = 502;
      await logger.saveToDatabase(statusCode, logger.getExecutionTime(), { symbol }, json, 'Missing bid or ask');

      return httpRes(statusCode, {
        error: 'Invalid tick data - missing bid or ask',
        raw: json
      });
    }

    const bid = Number(json.bid);
    const ask = Number(json.ask);
    const mid = (bid + ask) / 2;
    const spread = ask - bid;

    const result = {
      ok: true,
      symbol,
      bid,
      ask,
      mid,
      spread,
      timestamp: json.time || json.timestamp || new Date().toISOString(),
      source: 'metaapi',
      connection: 'polling'
    };

    logger.success('Price fetched successfully', { symbol, bid, ask });

    await logger.saveToDatabase(200, logger.getExecutionTime(), { symbol }, result, null);

    return httpRes(200, result);

  } catch (err) {
    logger.error('Unexpected error', {
      message: err.message,
      stack: err.stack,
      name: err.name
    });

    await logger.saveToDatabase(500, logger.getExecutionTime(), null, null, err);

    return httpRes(500, {
      error: err.message || 'Internal error',
      details: {
        name: err.name,
        message: err.message
      }
    });
  }
};
