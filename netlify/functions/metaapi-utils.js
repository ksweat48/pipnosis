// MetaAPI Utility Module for Serverless Functions
// This module ensures we always use the Node.js distribution of the SDK

// Global timeout constants
const FUNCTION_TIMEOUT_MS = 25000; // 25 seconds (before Netlify's 28s limit)
const API_CALL_TIMEOUT_MS = 20000; // 20 seconds for individual API calls
const SDK_INIT_TIMEOUT_MS = 5000; // 5 seconds for SDK initialization

/**
 * Create a promise that rejects after a timeout
 * @param {number} ms - Timeout in milliseconds
 * @param {string} operation - Operation description for error message
 * @returns {Promise} Promise that rejects on timeout
 */
function createTimeout(ms, operation) {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Operation timed out after ${ms}ms: ${operation}`));
    }, ms);
  });
}

/**
 * Race a promise against a timeout
 * @param {Promise} promise - The promise to execute
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} operation - Operation description
 * @returns {Promise} Result of the promise or timeout error
 */
async function withTimeout(promise, timeoutMs, operation) {
  return Promise.race([
    promise,
    createTimeout(timeoutMs, operation)
  ]);
}

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

  if (typeof token !== 'string' || token.length < 10) {
    throw new Error('Invalid token format');
  }

  const MetaApi = initializeMetaApiSDK();

  const defaultOptions = {
    application: 'Pipnosis',
    requestTimeout: API_CALL_TIMEOUT_MS,
    connectTimeout: API_CALL_TIMEOUT_MS,
    retries: 1,
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

  console.log(`[${new Date().toISOString()}] Generating narrowed token for account ${accountId} in ${region} region`);

  const metaApi = createMetaApiClient(adminToken, {
    domain: `${region}.agiliumtrade.ai`
  });

  if (!metaApi.tokenManagementApi) {
    throw new Error('MetaAPI client does not have tokenManagementApi');
  }

  try {
    console.log(`[${new Date().toISOString()}] Calling narrowDownToken API...`);

    const tokenPromise = metaApi.tokenManagementApi.narrowDownToken({
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

    const narrowedToken = await withTimeout(
      tokenPromise,
      API_CALL_TIMEOUT_MS,
      'narrowDownToken API call'
    );

    if (!narrowedToken || typeof narrowedToken !== 'string') {
      throw new Error('Invalid token format returned from MetaAPI');
    }

    console.log(`[${new Date().toISOString()}] ✓ Narrowed token generated successfully (length: ${narrowedToken.length})`);
    return narrowedToken;

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Token generation failed:`, error.message);

    if (error.message.includes('timed out')) {
      throw new Error('MetaAPI API call timed out. The service may be slow or unavailable.');
    }

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

  console.log(`[${new Date().toISOString()}] Verifying account ${accountId} in ${region} region`);

  const metaApi = createMetaApiClient(token, {
    domain: `${region}.agiliumtrade.ai`
  });

  if (!metaApi.metatraderAccountApi) {
    throw new Error('MetaAPI client does not have metatraderAccountApi');
  }

  try {
    console.log(`[${new Date().toISOString()}] Calling getAccount API...`);

    const accountPromise = metaApi.metatraderAccountApi.getAccount(accountId);
    const account = await withTimeout(
      accountPromise,
      API_CALL_TIMEOUT_MS,
      'getAccount API call'
    );

    console.log(`[${new Date().toISOString()}] ✓ Account verified: ${account.name} (${account.state})`);

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
    console.error(`[${new Date().toISOString()}] Account verification failed:`, error.message);

    if (error.message.includes('timed out')) {
      throw new Error('MetaAPI API call timed out. The service may be slow or unavailable.');
    }

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
  getSDKInfo,
  withTimeout,
  FUNCTION_TIMEOUT_MS,
  API_CALL_TIMEOUT_MS
};
