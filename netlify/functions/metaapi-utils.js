// MetaAPI Utility Module for Serverless Functions
// This module ensures we always use the Node.js distribution of the SDK

/**
 * Initialize MetaAPI SDK with proper Node.js imports
 * This function handles all the complexity of loading the correct SDK version
 */
function initializeMetaApiSDK() {
  try {
    // Force Node.js distribution by using direct path
    // This prevents bundlers from selecting the browser version
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

  const MetaApi = initializeMetaApiSDK();

  const defaultOptions = {
    application: 'Pipnosis',
    requestTimeout: 60000,
    connectTimeout: 60000,
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
 * Generate a narrowed token for a specific account
 * @param {string} adminToken - Admin token with full permissions
 * @param {string} accountId - MetaAPI account ID
 * @param {string} region - MetaAPI region (default: 'new-york')
 * @param {number} validityHours - Token validity in hours (default: 1)
 * @returns {Promise<string>} Narrowed token
 */
async function generateNarrowedToken(adminToken, accountId, region = 'new-york', validityHours = 1) {
  if (!adminToken) {
    throw new Error('Admin token is required');
  }

  if (!accountId) {
    throw new Error('Account ID is required');
  }

  console.log(`Generating narrowed token for account ${accountId} in ${region} region`);

  const metaApi = createMetaApiClient(adminToken, {
    domain: `${region}.agiliumtrade.ai`
  });

  try {
    const narrowedToken = await metaApi.tokenManagementApi.narrowDownToken({
      applications: [
        'trading-account-management-api',
        'metaapi-rest-api',
        'metaapi-rpc-api',
        'metaapi-real-time-streaming-api',
        'metastats-api',
        'risk-management-api'
      ],
      roles: ['reader', 'writer'],
      resources: [{ entity: 'account', id: accountId }]
    }, validityHours);

    if (!narrowedToken || typeof narrowedToken !== 'string') {
      throw new Error('Invalid token format returned from MetaAPI');
    }

    console.log(`✓ Narrowed token generated successfully (length: ${narrowedToken.length})`);
    return narrowedToken;

  } catch (error) {
    console.error('Token generation failed:', error);
    throw new Error(`Failed to generate narrowed token: ${error.message}`);
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

  console.log(`Verifying account ${accountId} in ${region} region`);

  const metaApi = createMetaApiClient(token, {
    domain: `${region}.agiliumtrade.ai`
  });

  try {
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

  } catch (error) {
    console.error('Account verification failed:', error);
    throw new Error(`Failed to verify account: ${error.message}`);
  }
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
  generateNarrowedToken,
  verifyAccount,
  getSDKInfo
};
