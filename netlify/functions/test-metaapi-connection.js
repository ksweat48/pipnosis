/* eslint-disable */
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

exports.handler = async (event) => {
  const logger = createLogger('test-metaapi-connection');

  if (event.httpMethod === 'OPTIONS') {
    return httpRes(200, { ok: true });
  }

  try {
    logger.info('Starting MetaAPI REST connection diagnostics');

    const diagnostics = {
      timestamp: new Date().toISOString(),
      environment: {},
      rest_api: {},
      account: {},
      errors: []
    };

    const token = process.env.METAAPI_ADMIN_TOKEN;
    const accountId = process.env.METAAPI_ACCOUNT_ID || process.env.VITE_METAAPI_ACCOUNT_ID;
    const region = process.env.METAAPI_REGION || process.env.VITE_METAAPI_REGION || 'cloud-g2';

    diagnostics.environment = {
      hasToken: !!token,
      tokenLength: token ? token.length : 0,
      hasAccountId: !!accountId,
      accountId: accountId ? accountId.substring(0, 8) + '...' : 'MISSING',
      region: region
    };

    if (!token || !accountId) {
      diagnostics.errors.push('Missing required environment variables');
      logger.error('Missing credentials', diagnostics.environment);
      return httpRes(500, diagnostics);
    }

    logger.info('Testing REST API connection');

    try {
      const client = createRestClient(token, { region, timeout: 10000 });

      const healthCheck = await client.healthCheck();
      diagnostics.rest_api.health = healthCheck;

      logger.info('Health check completed', healthCheck);

      if (!healthCheck.healthy) {
        diagnostics.errors.push(`Health check failed: ${healthCheck.error}`);
      }

      logger.info('Fetching account information');
      const account = await client.getAccountInformation(accountId);

      diagnostics.account = {
        found: true,
        id: account._id || account.id,
        name: account.name,
        state: account.state,
        platform: account.platform,
        server: account.server,
        region: account.region,
        connectionStatus: account.connectionStatus
      };

      logger.info('Account info retrieved', diagnostics.account);

      if (account.state !== 'DEPLOYED') {
        diagnostics.errors.push(`Account not deployed: ${account.state}`);
      }

      try {
        logger.info('Fetching account state');
        const state = await client.getAccountState(accountId);

        diagnostics.account.connected = state.connected;
        diagnostics.account.synchronized = state.synchronized;
        diagnostics.account.brokerTime = state.brokerTime;

        logger.info('Account state retrieved', {
          connected: state.connected,
          synchronized: state.synchronized
        });

        if (!state.connected) {
          diagnostics.errors.push('Account not connected');
        }

        if (!state.synchronized) {
          diagnostics.errors.push('Account not synchronized');
        }
      } catch (stateErr) {
        diagnostics.errors.push(`Failed to get account state: ${stateErr.message}`);
        logger.error('State fetch failed', { error: stateErr.message });
      }

      try {
        logger.info('Testing price fetch for EURUSD');
        const priceData = await client.getSymbolPrice(accountId, 'EURUSD');

        diagnostics.price_test = {
          success: true,
          symbol: 'EURUSD',
          bid: priceData.bid,
          ask: priceData.ask,
          time: priceData.time
        };

        logger.success('Price fetch successful', diagnostics.price_test);
      } catch (priceErr) {
        diagnostics.price_test = {
          success: false,
          error: priceErr.message
        };
        diagnostics.errors.push(`Price fetch failed: ${priceErr.message}`);
        logger.error('Price fetch failed', { error: priceErr.message });
      }

    } catch (apiErr) {
      diagnostics.rest_api = {
        error: apiErr.message,
        statusCode: apiErr.statusCode
      };
      diagnostics.errors.push(`REST API error: ${apiErr.message}`);
      logger.error('REST API test failed', {
        error: apiErr.message,
        statusCode: apiErr.statusCode
      });
    }

    const statusCode = diagnostics.errors.length > 0 ? 500 : 200;
    diagnostics.ok = diagnostics.errors.length === 0;
    diagnostics.method = 'rest-api';

    logger.success('Diagnostics complete', {
      ok: diagnostics.ok,
      errorCount: diagnostics.errors.length
    });

    await logger.saveToDatabase(statusCode, logger.getExecutionTime(), null, diagnostics, null);

    return httpRes(statusCode, diagnostics);

  } catch (err) {
    logger.error('Diagnostic failed', {
      message: err.message,
      stack: err.stack
    });

    await logger.saveToDatabase(500, logger.getExecutionTime(), null, null, err);

    return httpRes(500, {
      ok: false,
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
};
