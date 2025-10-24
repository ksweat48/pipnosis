// MetaAPI Utility Module for Serverless Functions
// Simplified version for essential functionality

/**
 * Initialize MetaAPI SDK with proper Node.js imports
 */
function initializeMetaApiSDK() {
  try {
    let MetaApi;

    try {
      // First attempt: Try the /node export explicitly
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
      // Second attempt: Try the main dist path (CommonJS)
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
      // Third attempt: Default require
      const mainModule = require('metaapi.cloud-sdk');
      MetaApi = mainModule.default || mainModule.MetaApi || mainModule;

      if (MetaApi && typeof MetaApi === 'function') {
        console.log('✓ MetaAPI SDK loaded via default export');
        return MetaApi;
      }
    } catch (mainErr) {
      console.error('Failed to load MetaAPI SDK from default export:', mainErr.message);
    }

    // If we get here, none of the methods worked
    throw new Error('MetaAPI SDK constructor not found in any export path');

  } catch (error) {
    console.error('Failed to initialize MetaAPI SDK:', error);
    throw new Error(`SDK initialization failed: ${error.message}`);
  }
}

/**
 * Create a MetaAPI client instance
 * @param {string} token - MetaAPI token (admin or narrowed)
 * @param {Object} options - Configuration options
 * @returns {Object} MetaAPI client instance
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

  try {
    const client = new MetaApi(token, config);
    console.log('✓ MetaAPI client created successfully');
    return client;
  } catch (error) {
    console.error('Failed to create MetaAPI client:', error);
    throw new Error(`Client creation failed: ${error.message}`);
  }
}

/**
 * Verify account access with a token
 * @param {string} token - MetaAPI token
 * @param {string} accountId - Account ID to verify
 * @param {string} region - MetaAPI region
 * @returns {Promise<Object>} Account information
 */
async function verifyAccount(token, accountId, region = 'new-york') {
  if (!token) {
    throw new Error('Token is required');
  }

  if (!accountId) {
    throw new Error('Account ID is required');
  }

  const endpoint = `${region}.agiliumtrade.ai`;
  console.log(`Verifying account ${accountId} in ${region} region`);

  const metaApi = createMetaApiClient(token, {
    domain: endpoint,
    requestTimeout: 10000,
    connectTimeout: 8000
  });

  if (!metaApi.metatraderAccountApi) {
    throw new Error('MetaAPI client does not have metatraderAccountApi');
  }

  console.log(`Calling MetaAPI getAccount API at ${endpoint}...`);

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
 * Get detailed SDK information for debugging
 * @returns {Object} SDK information
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
  getSDKInfo
};
