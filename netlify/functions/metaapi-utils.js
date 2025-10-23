// MetaAPI Utility Module for Serverless Functions
// This module ensures we always use the Node.js distribution of the SDK

// Global timeout constants - Optimized to avoid Netlify gateway timeouts
const FUNCTION_TIMEOUT_MS = 25700; // 25.7 seconds (300ms safety buffer before 26s gateway timeout)
const TOKEN_GENERATION_TIMEOUT_MS = 14000; // 14 seconds for token generation API call (optimized)
const ACCOUNT_VERIFICATION_TIMEOUT_MS = 8000; // 8 seconds for account verification
const SDK_INIT_TIMEOUT_MS = 2000; // 2 seconds for SDK initialization
const MAX_RETRIES = 0; // 0 retry attempts (1 total attempt only)
const RETRY_DELAYS = []; // No retries
const STALE_TOKEN_GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes - accept slightly expired tokens in emergencies
const TOKEN_EXPIRATION_BUFFER_MS = 5 * 60 * 1000; // 5 minutes - refresh token if expiring within 5 minutes

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
  const startTime = Date.now();
  try {
    const result = await Promise.race([
      promise,
      createTimeout(timeoutMs, operation)
    ]);
    const elapsed = Date.now() - startTime;
    console.log(`✓ ${operation} completed in ${elapsed}ms`);
    return result;
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`✗ ${operation} failed after ${elapsed}ms:`, error.message);
    throw error;
  }
}

/**
 * Delay execution for a specified number of milliseconds
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic and exponential backoff
 * @param {Function} fn - Async function to execute
 * @param {string} operationName - Name of operation for logging
 * @param {number} maxRetries - Maximum number of retry attempts
 * @returns {Promise} Result of the function
 */
async function withRetry(fn, operationName, maxRetries = MAX_RETRIES) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delayMs = RETRY_DELAYS[attempt - 1] || 10000;
        console.log(`[${new Date().toISOString()}] Retry attempt ${attempt}/${maxRetries} for ${operationName} after ${delayMs}ms delay...`);
        await delay(delayMs);
      }

      console.log(`[${new Date().toISOString()}] Executing ${operationName} (attempt ${attempt + 1}/${maxRetries + 1})...`);
      const result = await fn();

      if (attempt > 0) {
        console.log(`[${new Date().toISOString()}] ✓ ${operationName} succeeded on retry attempt ${attempt}`);
      }

      return result;
    } catch (error) {
      lastError = error;
      const isTimeout = error.message.includes('timed out') || error.message.includes('timeout');
      const isNetworkError = error.message.includes('ECONNREFUSED') || error.message.includes('ETIMEDOUT') || error.message.includes('ENOTFOUND');

      if (attempt < maxRetries && (isTimeout || isNetworkError)) {
        console.warn(`[${new Date().toISOString()}] ${operationName} failed (attempt ${attempt + 1}/${maxRetries + 1}): ${error.message}. Will retry...`);
        continue;
      }

      console.error(`[${new Date().toISOString()}] ${operationName} failed after ${attempt + 1} attempts:`, error.message);
      throw error;
    }
  }

  throw lastError;
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
    requestTimeout: options.requestTimeout || TOKEN_GENERATION_TIMEOUT_MS,
    connectTimeout: 8000, // 8 second connection timeout
    retries: 0, // We handle retries at a higher level with better control
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
 * Check Supabase cache for a valid token
 * @param {string} accountId - MetaAPI account ID
 * @param {string} region - MetaAPI region
 * @returns {Promise<Object|null>} Cached token object or null
 */
async function getCachedToken(accountId, region) {
  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.log('[Cache] Supabase not configured - skipping cache check');
      return null;
    }

    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data, error } = await supabase
      .from('metaapi_token_cache')
      .select('*')
      .eq('account_id', accountId)
      .eq('region', region)
      .eq('is_valid', true)
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn('[Cache] Error querying cache:', error.message);
      return null;
    }

    if (!data) {
      console.log('[Cache] No cached token found for account:', accountId);
      return null;
    }

    const now = new Date();
    const expiresAt = new Date(data.expires_at);
    const timeUntilExpiry = expiresAt - now;

    if (timeUntilExpiry <= 0) {
      console.log('[Cache] Token expired at:', data.expires_at);
      return null;
    }

    if (timeUntilExpiry < TOKEN_EXPIRATION_BUFFER_MS) {
      const minutesRemaining = Math.round(timeUntilExpiry / 1000 / 60);
      console.log(`[Cache] Token expiring soon (${minutesRemaining} minutes) - will generate fresh token`);
      return null;
    }

    const minutesRemaining = Math.round(timeUntilExpiry / 1000 / 60);
    console.log(`[Cache] ✓ Valid cached token found (expires in ${minutesRemaining} minutes)`);
    return data;
  } catch (error) {
    console.warn('[Cache] Unexpected error during cache check:', error.message);
    return null;
  }
}

/**
 * Store a token in Supabase cache
 * @param {string} token - MetaAPI token to cache
 * @param {string} accountId - MetaAPI account ID
 * @param {string} region - MetaAPI region
 * @param {number} validityHours - Token validity in hours
 * @returns {Promise<void>}
 */
async function cacheToken(token, accountId, region, validityHours) {
  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.log('[Cache] Supabase not configured - skipping token caching');
      return;
    }

    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + validityHours * 60 * 60 * 1000);

    const { error } = await supabase
      .from('metaapi_token_cache')
      .upsert({
        account_id: accountId,
        region: region,
        token: token,
        expires_at: expiresAt.toISOString(),
        is_valid: true,
        created_at: now.toISOString(),
        updated_at: now.toISOString()
      }, {
        onConflict: 'account_id,region'
      });

    if (error) {
      console.warn('[Cache] Failed to cache token:', error.message);
    } else {
      console.log(`[Cache] ✓ Token cached successfully (expires: ${expiresAt.toISOString()})`);
    }
  } catch (error) {
    console.warn('[Cache] Unexpected error during token caching:', error.message);
  }
}

/**
 * Get emergency fallback token from cache (allows slightly expired tokens)
 * @param {string} accountId - MetaAPI account ID
 * @param {string} region - MetaAPI region
 * @returns {Promise<Object|null>} Fallback token or null
 */
async function getFallbackToken(accountId, region) {
  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return null;
    }

    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data, error } = await supabase
      .from('metaapi_token_cache')
      .select('*')
      .eq('account_id', accountId)
      .eq('region', region)
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    const now = new Date();
    const expiresAt = new Date(data.expires_at);
    const timeSinceExpiry = now - expiresAt;

    if (timeSinceExpiry > STALE_TOKEN_GRACE_PERIOD_MS) {
      console.log('[Fallback] Token too old for emergency use');
      return null;
    }

    if (timeSinceExpiry > 0) {
      const minutesExpired = Math.round(timeSinceExpiry / 1000 / 60);
      console.log(`[Fallback] ⚠ Using expired token as emergency fallback (expired ${minutesExpired} minutes ago)`);
    } else {
      console.log('[Fallback] Using recently cached token as fallback');
    }

    return data;
  } catch (error) {
    console.warn('[Fallback] Error retrieving fallback token:', error.message);
    return null;
  }
}

/**
 * Generate a narrowed token using narrowDownTokenResources (only method)
 * @param {string} adminToken - Admin token with full permissions
 * @param {string} accountId - MetaAPI account ID
 * @param {string} region - MetaAPI region (default: 'new-york')
 * @returns {Promise<string>} Narrowed token
 */
async function generateTokenFromAPI(adminToken, accountId, region = 'new-york') {
  const endpoint = `${region}.agiliumtrade.ai`;
  console.log(`[${new Date().toISOString()}] Generating token using narrowDownTokenResources() for account ${accountId}`);

  const requestStartTime = Date.now();

  const metaApi = createMetaApiClient(adminToken, {
    domain: endpoint,
    requestTimeout: TOKEN_GENERATION_TIMEOUT_MS,
    connectTimeout: 8000
  });

  if (!metaApi.tokenManagementApi) {
    throw new Error('MetaAPI client does not have tokenManagementApi');
  }

  console.log(`[${new Date().toISOString()}] Calling MetaAPI narrowDownTokenResources API at ${endpoint}...`);

  const tokenPromise = metaApi.tokenManagementApi.narrowDownTokenResources({
    accountId: accountId
  });

  const narrowedToken = await withTimeout(
    tokenPromise,
    TOKEN_GENERATION_TIMEOUT_MS,
    'narrowDownTokenResources API call'
  );

  if (!narrowedToken || typeof narrowedToken !== 'string') {
    throw new Error('Invalid token format returned from MetaAPI');
  }

  const requestDuration = Date.now() - requestStartTime;
  console.log(`[${new Date().toISOString()}] ✓ Token generated successfully`);
  console.log(`[${new Date().toISOString()}] Token length: ${narrowedToken.length} characters`);
  console.log(`[${new Date().toISOString()}] Request duration: ${requestDuration}ms`);

  return narrowedToken;
}

/**
 * Generate a token with cache-first strategy and emergency fallback
 * This is the main function that should be called by other modules
 * @param {string} adminToken - Admin token with full permissions
 * @param {string} accountId - MetaAPI account ID
 * @param {string} region - MetaAPI region (default: 'new-york')
 * @param {number} validityHours - Token validity in hours (default: 1)
 * @returns {Promise<Object>} Object containing token and metadata
 */
async function generateNarrowedToken(adminToken, accountId, region = 'new-york', validityHours = 1) {
  if (!adminToken) {
    throw new Error('Admin token is required');
  }

  if (!accountId) {
    throw new Error('Account ID is required');
  }

  const endpoint = `${region}.agiliumtrade.ai`;
  console.log(`[${new Date().toISOString()}] Starting token generation for account ${accountId}`);
  console.log(`[${new Date().toISOString()}] Target endpoint: ${endpoint}`);
  console.log(`[${new Date().toISOString()}] Token validity: ${validityHours} hour(s)`);

  // Step 1: Check cache first
  console.log(`[${new Date().toISOString()}] Checking Supabase cache...`);
  const cachedToken = await getCachedToken(accountId, region);

  if (cachedToken) {
    console.log(`[${new Date().toISOString()}] ✓ Using cached token (cached at: ${cachedToken.created_at})`);
    return {
      token: cachedToken.token,
      source: 'cache',
      expiresAt: cachedToken.expires_at,
      cached: true
    };
  }

  // Step 2: No valid cache - generate new token
  console.log(`[${new Date().toISOString()}] No valid cached token - generating fresh token...`);

  try {
    const token = await generateTokenFromAPI(adminToken, accountId, region);

    // Step 3: Cache the newly generated token
    await cacheToken(token, accountId, region, validityHours);

    const expiresAt = new Date(Date.now() + validityHours * 60 * 60 * 1000);

    return {
      token: token,
      source: 'generated',
      expiresAt: expiresAt.toISOString(),
      cached: false
    };
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Token generation failed:`, error.message);

    // Step 4: Emergency fallback - try to use recently expired token
    console.log(`[${new Date().toISOString()}] Attempting emergency fallback...`);
    const fallbackToken = await getFallbackToken(accountId, region);

    if (fallbackToken) {
      console.warn(`[${new Date().toISOString()}] ⚠ Using fallback token due to generation failure`);
      return {
        token: fallbackToken.token,
        source: 'fallback',
        expiresAt: fallbackToken.expires_at,
        cached: true,
        warning: 'Using fallback token - MetaAPI may be experiencing issues'
      };
    }

    // Step 5: No fallback available - throw error with helpful message
    console.error(`[${new Date().toISOString()}] No fallback token available`);

    if (error.message.includes('timed out') || error.message.includes('timeout')) {
      throw new Error(
        `MetaAPI token generation timed out. ` +
        `The ${endpoint} server may be experiencing high load or network issues. ` +
        `Please try again in a few moments.`
      );
    }

    if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
      throw new Error(
        `Unable to connect to MetaAPI server at ${endpoint}. ` +
        `Please check your network connection and verify the region setting (current: ${region}).`
      );
    }

    if (error.message.includes('Unauthorized') || error.message.includes('401')) {
      throw new Error(
        `Authentication failed with MetaAPI. ` +
        `Please verify your admin token is valid and has not expired.`
      );
    }

    if (error.message.includes('429') || error.message.includes('rate limit')) {
      throw new Error(
        `MetaAPI rate limit exceeded. ` +
        `Please wait a few minutes before trying again.`
      );
    }

    throw new Error(`Failed to generate token: ${error.message}`);
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
  console.log(`[${new Date().toISOString()}] Verifying account ${accountId} in ${region} region`);
  console.log(`[${new Date().toISOString()}] Target endpoint: ${endpoint}`);

  // Use retry logic for account verification
  return withRetry(async () => {
    const requestStartTime = Date.now();

    const metaApi = createMetaApiClient(token, {
      domain: endpoint,
      requestTimeout: ACCOUNT_VERIFICATION_TIMEOUT_MS,
      connectTimeout: 8000
    });

    if (!metaApi.metatraderAccountApi) {
      throw new Error('MetaAPI client does not have metatraderAccountApi');
    }

    console.log(`[${new Date().toISOString()}] Calling MetaAPI getAccount API at ${endpoint}...`);

    const accountPromise = metaApi.metatraderAccountApi.getAccount(accountId);
    const account = await withTimeout(
      accountPromise,
      ACCOUNT_VERIFICATION_TIMEOUT_MS,
      'getAccount API call'
    );

    const requestDuration = Date.now() - requestStartTime;
    console.log(`[${new Date().toISOString()}] ✓ Account verified: ${account.name} (${account.state})`);
    console.log(`[${new Date().toISOString()}] Request duration: ${requestDuration}ms`);

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
  }, 'Account Verification', MAX_RETRIES).catch(error => {
    console.error(`[${new Date().toISOString()}] Account verification failed after all retries:`, error.message);

    if (error.message.includes('timed out') || error.message.includes('timeout')) {
      throw new Error(
        `MetaAPI account verification timed out after multiple attempts. ` +
        `The ${endpoint} server may be experiencing high load. ` +
        `Please try again in a few moments.`
      );
    }

    if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
      throw new Error(
        `Unable to connect to MetaAPI server at ${endpoint}. ` +
        `Please check your network connection and verify the region setting (current: ${region}).`
      );
    }

    if (error.message.includes('Unauthorized') || error.message.includes('401')) {
      throw new Error(
        `Authentication failed with MetaAPI. ` +
        `The provided token may be invalid or expired.`
      );
    }

    if (error.message.includes('404') || error.message.includes('not found')) {
      throw new Error(
        `Account ${accountId} not found in ${region} region. ` +
        `Please verify the account ID and region are correct.`
      );
    }

    throw new Error(`Failed to verify account: ${error.message}`);
  });
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
  getCachedToken,
  cacheToken,
  getFallbackToken,
  withTimeout,
  withRetry,
  delay,
  FUNCTION_TIMEOUT_MS,
  TOKEN_GENERATION_TIMEOUT_MS,
  ACCOUNT_VERIFICATION_TIMEOUT_MS,
  MAX_RETRIES,
  STALE_TOKEN_GRACE_PERIOD_MS,
  TOKEN_EXPIRATION_BUFFER_MS
};
