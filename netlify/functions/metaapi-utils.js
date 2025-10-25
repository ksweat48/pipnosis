// MetaAPI Utility Module for Serverless Functions
// Fully patched and includes proper narrowed token support

/**
 * Initialize MetaAPI SDK with proper Node.js imports
 */
function initializeMetaApiSDK() {
  try {
    let MetaApi;

    try {
      const nodeModule = require('metaapi.cloud-sdk/node');
      MetaApi = nodeModule.default || nodeModule.MetaApi || nodeModule;
      if (MetaApi && typeof MetaApi === 'function') {
        console.log('✓ MetaAPI SDK loaded via /node export');
        return MetaApi;
      }
    } catch (nodeErr) {
      console.log('Note: /node export not available, trying /dist path');
    }

    try {
      const distModule = require('metaapi.cloud-sdk/dist');
      MetaApi = distModule.default || distModule.MetaApi || distModule;
      if (MetaApi && typeof MetaApi === 'function') {
        console.log('✓ MetaAPI SDK loaded via /dist export');
        return MetaApi;
      }
    } catch (distErr) {
      console.log('Note: /dist export not available, trying default import');
    }

    try {
      const mainModule = require('metaapi.cloud-sdk');
      MetaApi = mainModule.default || mainModule.MetaApi || mainModule;
      if (MetaApi && typeof MetaApi === 'function') {
        console.log('✓ MetaAPI SDK loaded via default export');
        return MetaApi;
      }
    } catch (mainErr) {
      console.error('Failed to load MetaAPI SDK from default export:', mainErr.message);
    }

    throw new Error('MetaAPI SDK constructor not found in any export path');

  } catch (error) {
    console.error('Failed to initialize MetaAPI SDK:', error);
    throw new Error(`SDK initialization failed: ${error.message}`);
  }
}

/**
 * Create a MetaAPI client instance
 */
function createMetaApiClient(token, options = {}) {
  if (!token) {
    throw new Error('Token is required to create MetaAPI client');
  }
  if (typeof token !== 'string' || token.length < 10) {
    throw new Error('Invalid token format');
  }

  const MetaApi = initializeMetaApiSDK();
  const defaultOptions = {
    application: 'Pipnosis',
    requestTimeout: 30000,
    connectTimeout: 8000,
    retries: 1,
    headers: {
      'User-Agent': 'Pipnosis/1.0',
      'Accept-Encoding': 'gzip, deflate',
      'Connection': 'keep-alive'
    }
  };

  const config = { ...defaultOptions, ...options };
  const client = new MetaApi(token, config);
  console.log('✓ MetaAPI client created successfully');
  return client;
}

/**
 * ✅ NEW — Generate a narrowed token for a specific account
 */
async function generateNarrowToken(metaApi, accountId) {
  if (!accountId) throw new Error('Account ID is required for token narrowing');

  const response = await metaApi.tokenManagementApi.narrowDownTokenResources([
    {
      application: 'mt-client-api',
      resources: [
        {
          type: 'account',
          id: accountId,
          permissions: ['read', 'trade']
        }
      ]
    }
  ]);

  if (!response || !response.token) {
    throw new Error('MetaAPI did not return a narrowed token');
  }

  return response.token;
}

/**
 * Verify account access with a token
 */
async function verifyAccount(token, accountId, region = 'new-york') {
  if (!token) throw new Error('Token is required');
  if (!accountId) throw new Error('Account ID is required');

  const endpoint = `${region}.agiliumtrade.ai`;
  console.log(`Verifying account ${accountId} in ${region}`);

  const metaApi = createMetaApiClient(token, {
    domain: endpoint,
    requestTimeout: 10000,
    connectTimeout: 8000
  });

  if (!metaApi.metatraderAccountApi) {
    throw new Error('MetaAPI client does not have metatraderAccountApi');
  }

  const account = await metaApi.metatraderAccountApi.getAccount(accountId);

  console.log(`✓ Account verified: ${account.name} (${account.state})`);

  return {
    id: account.id,
    name: account.name,
    state: account.state,
    region: account.region,
    server: account.server,
    platform: account.platform,
    magic: account.magic,
    connectionStatus: account.connectionStatus
  };
}

/**
 * SDK debug info helper
 */
function getSDKInfo() {
  try {
    const MetaApi = initializeMetaApiSDK();
    return {
      loaded: true,
      constructorType: typeof MetaApi,
      constructorName: MetaApi.name,
      nodeVersion: process.version,
      platform: process.platform
    };
  } catch (error) {
    return {
      loaded: false,
      error: error.message,
      nodeVersion: process.version,
      platform: process.platform
    };
  }
}

module.exports = {
  initializeMetaApiSDK,
  createMetaApiClient,
  verifyAccount,
  getSDKInfo,
  generateNarrowToken // ✅ exported
};
