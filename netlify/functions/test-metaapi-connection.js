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

function resolveMetaApiCtor() {
  try {
    const m = require('metaapi.cloud-sdk');
    return m.default || m.MetaApi || m;
  } catch (e) {
    throw new Error('MetaApi SDK not installed: ' + e.message);
  }
}

exports.handler = async (event) => {
  const logger = createLogger('test-metaapi-connection');

  if (event.httpMethod === 'OPTIONS') {
    return httpRes(200, { ok: true });
  }

  try {
    logger.info('Starting MetaAPI connection diagnostics');

    const diagnostics = {
      timestamp: new Date().toISOString(),
      environment: {},
      dns: {},
      metaapi: {},
      errors: []
    };

    // Check environment variables
    const token = process.env.METAAPI_ADMIN_TOKEN;
    const accountId = process.env.METAAPI_ACCOUNT_ID || process.env.VITE_METAAPI_ACCOUNT_ID;
    const region = process.env.METAAPI_REGION || process.env.VITE_METAAPI_REGION || 'london';

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

    // Test DNS resolution
    logger.info('Testing DNS resolution for MetaAPI domains');
    const dns = require('dns').promises;

    try {
      const provisioningHost = 'mt-provisioning-api-v1.agiliumtrade.ai';
      logger.info('Resolving', provisioningHost);
      const addresses = await dns.resolve4(provisioningHost);
      diagnostics.dns.provisioning = {
        host: provisioningHost,
        resolved: true,
        addresses: addresses,
        error: null
      };
      logger.info('DNS resolved', { host: provisioningHost, addresses });
    } catch (dnsError) {
      diagnostics.dns.provisioning = {
        host: 'mt-provisioning-api-v1.agiliumtrade.ai',
        resolved: false,
        addresses: [],
        error: dnsError.message
      };
      diagnostics.errors.push(`DNS resolution failed: ${dnsError.message}`);
      logger.error('DNS resolution failed', { error: dnsError.message });
    }

    // Test MetaAPI connection
    logger.info('Testing MetaAPI SDK initialization');
    try {
      const MetaApi = resolveMetaApiCtor();

      const metaApi = new MetaApi(token, {
        application: 'pipnosis-ai-trading',
        domain: 'agiliumtrade.ai',
        region: region,
        requestTimeout: 15000
      });

      logger.info('MetaAPI SDK initialized, fetching account info');

      const account = await metaApi.metatraderAccountApi.getAccount(accountId);

      diagnostics.metaapi = {
        sdkInitialized: true,
        accountFound: true,
        accountId: accountId.substring(0, 8) + '...',
        accountName: account.name,
        accountState: account.state,
        connectionStatus: account.connectionStatus,
        platform: account.platform,
        server: account.server,
        region: account.region,
        error: null
      };

      logger.success('MetaAPI connection test successful', diagnostics.metaapi);

      if (account.state !== 'DEPLOYED') {
        diagnostics.errors.push(`Account not deployed: ${account.state}`);
      }

    } catch (metaApiError) {
      diagnostics.metaapi = {
        sdkInitialized: false,
        accountFound: false,
        error: metaApiError.message,
        stack: metaApiError.stack
      };
      diagnostics.errors.push(`MetaAPI error: ${metaApiError.message}`);
      logger.error('MetaAPI test failed', {
        error: metaApiError.message,
        code: metaApiError.code
      });
    }

    const statusCode = diagnostics.errors.length > 0 ? 500 : 200;
    diagnostics.ok = diagnostics.errors.length === 0;

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
