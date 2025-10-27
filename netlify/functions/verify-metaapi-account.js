const { createRestClient } = require('./metaapi-rest-client.js');
const { createLogger } = require('./function-logger.js');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function httpRes(statusCode, body) {
  return {
    statusCode,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  const logger = createLogger('verify-metaapi-account');

  if (event.httpMethod === 'OPTIONS') {
    return httpRes(204, {});
  }

  if (event.httpMethod !== 'GET') {
    return httpRes(405, { error: 'Method not allowed' });
  }

  const adminToken = process.env.METAAPI_ADMIN_TOKEN;
  const accountId = process.env.METAAPI_ACCOUNT_ID || process.env.VITE_METAAPI_ACCOUNT_ID;
  const region = process.env.METAAPI_REGION || process.env.VITE_METAAPI_REGION || 'cloud-g2';

  if (!adminToken || !accountId) {
    logger.error('Missing credentials', { hasToken: !!adminToken, hasAccountId: !!accountId });
    await logger.saveToDatabase(500, logger.getExecutionTime(), null, null, new Error('Missing credentials'));
    return httpRes(500, {
      ok: false,
      error: 'Missing METAAPI_ADMIN_TOKEN or METAAPI_ACCOUNT_ID'
    });
  }

  try {
    logger.info('Verifying MetaAPI account via REST API', {
      region,
      accountId: accountId.substring(0, 8) + '...',
      baseUrl: `https://mt-client-api-v1.${region}.agiliumtrade.ai`
    });

    const client = createRestClient(adminToken, { region, timeout: 10000 });

    const account = await client.getAccountInformation(accountId);

    logger.info('Account info retrieved', {
      state: account.state,
      connectionStatus: account.connectionStatus,
      platform: account.platform
    });

    let state = null;
    try {
      state = await client.getAccountState(accountId);
      logger.info('Account state retrieved', {
        connected: state.connected,
        synchronized: state.synchronized
      });
    } catch (stateErr) {
      logger.warn('Could not fetch account state', { error: stateErr.message });
    }

    const response = {
      ok: true,
      id: account._id || account.id,
      name: account.name,
      state: account.state,
      region: account.region,
      server: account.server,
      platform: account.platform,
      connectionStatus: account.connectionStatus,
      connected: state?.connected || false,
      synchronized: state?.synchronized || false,
      method: 'rest-api'
    };

    logger.success('Account verified successfully');
    await logger.saveToDatabase(200, logger.getExecutionTime(), { accountId }, response, null);

    return httpRes(200, response);

  } catch (err) {
    logger.error('Verification failed', {
      message: err.message,
      statusCode: err.statusCode,
      stack: err.stack
    });

    await logger.saveToDatabase(500, logger.getExecutionTime(), { accountId }, null, err);

    return httpRes(500, {
      ok: false,
      error: err.message,
      details: err.statusCode ? `HTTP ${err.statusCode}` : 'Connection failed'
    });
  }
};
