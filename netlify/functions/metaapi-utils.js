// MetaAPI Utility Module for Serverless Functions
// This module ensures we always use the Node.js distribution of the SDK

// Global timeout constants - Optimized to avoid Netlify gateway timeouts
const FUNCTION_TIMEOUT_MS = 25000; // 25 seconds (1s safety buffer before 26s gateway timeout)
const TOKEN_GENERATION_TIMEOUT_MS = 8000; // 8 seconds per region attempt (fast failover)
const ACCOUNT_VERIFICATION_TIMEOUT_MS = 8000; // 8 seconds for account verification
const MULTI_REGION_FALLBACK_REGIONS = ['new-york', 'london', 'singapore']; // Regions to try in parallel
const SDK_INIT_TIMEOUT_MS = 2000; // 2 seconds for SDK initialization
const MAX_RETRIES = 2; // 2 retry attempts per region (3 total attempts)
const RETRY_DELAYS = [1000, 2000]; // 1s, 2s delays between retries
const STALE_TOKEN_GRACE_PERIOD_MS = 10 * 60 * 1000; // 10 minutes - accept slightly expired tokens in emergencies
const TOKEN_EXPIRATION_BUFFER_MS = 10 * 60 * 1000; // 10 minutes - refresh token if expiring within 10 minutes
const PARALLEL_REGION_ATTEMPTS = true; // Try regions in parallel for faster response

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
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE;

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

    // Update last_used_at and increment use_count
    try {
      await supabase
        .from('metaapi_token_cache')
        .update({
          last_used_at: new Date().toISOString(),
          use_count: (data.use_count || 0) + 1
        })
        .eq('account_id', accountId)
        .eq('region', region);
    } catch (updateError) {
      console.warn('[Cache] Failed to update usage stats:', updateError.message);
    }

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
 * @param {number} generationTimeMs - Time taken to generate token
 * @param {string} sourceRegion - Region that generated the token
 * @returns {Promise<void>}
 */
async function cacheToken(token, accountId, region, validityHours, generationTimeMs = null, sourceRegion = null) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE;

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
        updated_at: now.toISOString(),
        generation_time_ms: generationTimeMs,
        source_region: sourceRegion || region,
        use_count: 0,
        last_used_at: now.toISOString()
      }, {
        onConflict: 'account_id,region'
      });

    if (error) {
      console.warn('[Cache] Failed to cache token:', error.message);
    } else {
      console.log(`[Cache] ✓ Token cached successfully (expires: ${expiresAt.toISOString()}, generation: ${generationTimeMs}ms)`);
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
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE;

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
 * Check if a MetaAPI region is healthy and responsive
 * @param {string} region - MetaAPI region to check
 * @returns {Promise<Object>} Health check result
 */
async function checkRegionHealth(region) {
  const endpoint = `${region}.agiliumtrade.ai`;
  const startTime = Date.now();

  try {
    // Simple connectivity check with minimal timeout
    const healthTimeout = 3000; // 3 second health check
    const checkPromise = new Promise((resolve, reject) => {
      const https = require('https');
      const req = https.get(`https://${endpoint}/`, { timeout: healthTimeout }, (res) => {
        resolve({
          healthy: res.statusCode >= 200 && res.statusCode < 500,
          statusCode: res.statusCode,
          responseTime: Date.now() - startTime
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Health check timeout'));
      });
    });

    const result = await Promise.race([
      checkPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Health check timeout')), healthTimeout)
      )
    ]);

    console.log(`[Health] ${region} region is healthy (${result.responseTime}ms)`);
    return result;
  } catch (error) {
    console.warn(`[Health] ${region} region appears unhealthy: ${error.message}`);
    return {
      healthy: false,
      error: error.message,
      responseTime: Date.now() - startTime
    };
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
  console.log(`[${new Date().toISOString()}] Attempting region: ${region}`);

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
  console.log(`[${new Date().toISOString()}] ✓ Token generated successfully from ${region} region`);
  console.log(`[${new Date().toISOString()}] Token length: ${narrowedToken.length} characters`);
  console.log(`[${new Date().toISOString()}] Request duration: ${requestDuration}ms`);

  return narrowedToken;
}

/**
 * Try generating token from multiple regions with parallel attempts
 * @param {string} adminToken - Admin token with full permissions
 * @param {string} accountId - MetaAPI account ID
 * @param {string} primaryRegion - Primary region to try first
 * @returns {Promise<Object>} Object with token and successful region
 */
async function generateTokenWithMultiRegionFallback(adminToken, accountId, primaryRegion = 'new-york') {
  const regions = [primaryRegion, ...MULTI_REGION_FALLBACK_REGIONS.filter(r => r !== primaryRegion)];

  if (PARALLEL_REGION_ATTEMPTS) {
    console.log(`[${new Date().toISOString()}] Attempting parallel token generation from regions: ${regions.join(', ')}`);

    // Quick health check for all regions in parallel
    console.log(`[${new Date().toISOString()}] Running pre-flight health checks...`);
    const healthChecks = await Promise.all(
      regions.map(region => checkRegionHealth(region).catch(() => ({ healthy: false, region })))
    );

    // Sort regions by health and response time
    const sortedRegions = regions.sort((a, b) => {
      const healthA = healthChecks.find(h => h.region === a || true);
      const healthB = healthChecks.find(h => h.region === b || true);
      if (healthA.healthy && !healthB.healthy) return -1;
      if (!healthA.healthy && healthB.healthy) return 1;
      return (healthA.responseTime || 9999) - (healthB.responseTime || 9999);
    });

    console.log(`[${new Date().toISOString()}] Regions sorted by health: ${sortedRegions.join(', ')}`);

    // Create promises for all regions simultaneously
    const regionPromises = sortedRegions.map(async (region) => {
      try {
        console.log(`[${new Date().toISOString()}] Starting parallel attempt for ${region} region...`);
        const token = await generateTokenFromAPI(adminToken, accountId, region);
        console.log(`[${new Date().toISOString()}] ✓ Successfully generated token from ${region} region`);

        return {
          token,
          region,
          fallbackUsed: region !== primaryRegion,
          success: true
        };
      } catch (error) {
        console.warn(`[${new Date().toISOString()}] ✗ Failed to generate token from ${region} region: ${error.message}`);
        return {
          region,
          error: error.message,
          success: false
        };
      }
    });

    // Use Promise.race to return the first successful result
    const raceResult = await Promise.race([
      ...regionPromises.map(p => p.then(result => result.success ? result : Promise.reject(result))),
      // Add a timeout promise that resolves after all regions have had time to respond
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('All regions timed out')), TOKEN_GENERATION_TIMEOUT_MS * regions.length)
      )
    ].map(p => p.catch(e => e)));

    if (raceResult && raceResult.success) {
      return raceResult;
    }

    // If race didn't work, wait for all and check results
    const results = await Promise.all(regionPromises);
    const successfulResult = results.find(r => r.success);

    if (successfulResult) {
      return successfulResult;
    }

    // All regions failed
    const errors = results.filter(r => !r.success).map(r => `${r.region}: ${r.error}`);
    console.error(`[${new Date().toISOString()}] All regions failed to generate token (parallel)`);
    throw new Error(
      `Failed to generate token from all regions. Errors: ${errors.join('; ')}`
    );
  } else {
    // Sequential fallback (original behavior)
    const errors = [];
    console.log(`[${new Date().toISOString()}] Multi-region fallback enabled. Will try regions in order: ${regions.join(', ')}`);

    for (const region of regions) {
      try {
        console.log(`[${new Date().toISOString()}] Attempting token generation from ${region} region...`);
        const token = await generateTokenFromAPI(adminToken, accountId, region);
        console.log(`[${new Date().toISOString()}] ✓ Successfully generated token from ${region} region`);

        return {
          token,
          region,
          fallbackUsed: region !== primaryRegion
        };
      } catch (error) {
        const errorMessage = `${region}: ${error.message}`;
        errors.push(errorMessage);
        console.warn(`[${new Date().toISOString()}] ✗ Failed to generate token from ${region} region: ${error.message}`);

        // If this isn't the last region, continue to next
        if (region !== regions[regions.length - 1]) {
          console.log(`[${new Date().toISOString()}] Trying next region...`);
          continue;
        }
      }
    }

    // All regions failed
    console.error(`[${new Date().toISOString()}] All regions failed to generate token`);
    throw new Error(
      `Failed to generate token from all regions. Errors: ${errors.join('; ')}`
    );
  }
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

  // Step 2: No valid cache - generate new token with multi-region fallback
  console.log(`[${new Date().toISOString()}] No valid cached token - generating fresh token...`);

  try {
    const generationStartTime = Date.now();
    const result = await generateTokenWithMultiRegionFallback(adminToken, accountId, region);
    const { token, region: successfulRegion, fallbackUsed } = result;
    const generationTimeMs = Date.now() - generationStartTime;

    // Step 3: Cache the newly generated token with timing metadata
    await cacheToken(token, accountId, region, validityHours, generationTimeMs, successfulRegion);

    const expiresAt = new Date(Date.now() + validityHours * 60 * 60 * 1000);

    return {
      token: token,
      source: 'generated',
      expiresAt: expiresAt.toISOString(),
      cached: false,
      region: successfulRegion,
      fallbackUsed: fallbackUsed || false
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
        `MetaAPI Token Generation Timeout\n\n` +
        `The MetaAPI service is responding slowly or is unavailable.\n\n` +
        `What happened:\n` +
        `- All regions (${MULTI_REGION_FALLBACK_REGIONS.join(', ')}) failed to respond within ${TOKEN_GENERATION_TIMEOUT_MS / 1000} seconds\n` +
        `- No cached tokens are available for fallback\n\n` +
        `Troubleshooting steps:\n` +
        `1. Check MetaAPI service status at https://metaapi.cloud/status\n` +
        `2. Verify your internet connection is stable\n` +
        `3. Wait 2-3 minutes and try again (MetaAPI may be experiencing temporary issues)\n` +
        `4. Check if your MetaAPI account is active and not rate-limited\n` +
        `5. Try using a different region in your settings\n\n` +
        `If the issue persists, contact MetaAPI support with this timestamp: ${new Date().toISOString()}`
      );
    }

    if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
      throw new Error(
        `MetaAPI Connection Failed\n\n` +
        `Unable to establish connection to MetaAPI servers.\n\n` +
        `What happened:\n` +
        `- Failed to connect to ${endpoint}\n` +
        `- DNS resolution or network connectivity issue\n\n` +
        `Troubleshooting steps:\n` +
        `1. Check your internet connection\n` +
        `2. Verify firewall settings allow outbound HTTPS connections\n` +
        `3. Try accessing https://${endpoint}/ in your browser\n` +
        `4. Check if your hosting provider blocks MetaAPI domains\n` +
        `5. Try changing the VITE_METAAPI_REGION environment variable to 'london' or 'singapore'\n\n` +
        `Current region: ${region}`
      );
    }

    if (error.message.includes('Unauthorized') || error.message.includes('401')) {
      throw new Error(
        `MetaAPI Authentication Failed\n\n` +
        `Your MetaAPI admin token is invalid or expired.\n\n` +
        `What happened:\n` +
        `- The METAAPI_ADMIN_TOKEN was rejected by MetaAPI servers\n` +
        `- Token may be expired, revoked, or incorrect\n\n` +
        `Troubleshooting steps:\n` +
        `1. Log into https://app.metaapi.cloud/\n` +
        `2. Navigate to Settings > API Tokens\n` +
        `3. Verify your admin token is active and has not expired\n` +
        `4. Generate a new admin token if needed\n` +
        `5. Update the METAAPI_ADMIN_TOKEN environment variable in Netlify\n` +
        `6. Redeploy your application after updating the token\n\n` +
        `Token format should start with: "eyJ..."`
      );
    }

    if (error.message.includes('429') || error.message.includes('rate limit')) {
      throw new Error(
        `MetaAPI Rate Limit Exceeded\n\n` +
        `You have exceeded the MetaAPI API rate limit.\n\n` +
        `What happened:\n` +
        `- Too many API requests in a short time period\n` +
        `- MetaAPI throttling protection activated\n\n` +
        `Troubleshooting steps:\n` +
        `1. Wait 5-10 minutes before trying again\n` +
        `2. Check your MetaAPI dashboard for rate limit details\n` +
        `3. Consider upgrading your MetaAPI plan for higher limits\n` +
        `4. Review your application for excessive token generation requests\n` +
        `5. Ensure token caching is working properly (check Supabase connection)\n\n` +
        `Rate limits reset every hour. Current time: ${new Date().toISOString()}`
      );
    }

    if (error.message.includes('403') || error.message.includes('Forbidden')) {
      throw new Error(
        `MetaAPI Access Forbidden\n\n` +
        `Your token does not have permission to access this account.\n\n` +
        `What happened:\n` +
        `- The admin token doesn't have access to account ${accountId}\n` +
        `- Account may be in a different organization or region\n\n` +
        `Troubleshooting steps:\n` +
        `1. Verify the account ID is correct: ${accountId}\n` +
        `2. Check that the account belongs to your MetaAPI organization\n` +
        `3. Ensure your admin token has organization-wide permissions\n` +
        `4. Log into MetaAPI dashboard and verify account access\n` +
        `5. Try accessing the account with a different admin token`
      );
    }

    throw new Error(
      `MetaAPI Token Generation Failed\n\n` +
      `An unexpected error occurred while generating the token.\n\n` +
      `Error details: ${error.message}\n\n` +
      `Troubleshooting steps:\n` +
      `1. Check the full error logs for more details\n` +
      `2. Verify all MetaAPI environment variables are set correctly\n` +
      `3. Try accessing MetaAPI dashboard to verify service availability\n` +
      `4. Contact support with this error message and timestamp\n\n` +
      `Timestamp: ${new Date().toISOString()}\n` +
      `Region attempted: ${region}\n` +
      `Account ID: ${accountId}`
    );
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
  generateTokenWithMultiRegionFallback,
  verifyAccount,
  getSDKInfo,
  getCachedToken,
  cacheToken,
  getFallbackToken,
  checkRegionHealth,
  withTimeout,
  withRetry,
  delay,
  FUNCTION_TIMEOUT_MS,
  TOKEN_GENERATION_TIMEOUT_MS,
  ACCOUNT_VERIFICATION_TIMEOUT_MS,
  MAX_RETRIES,
  STALE_TOKEN_GRACE_PERIOD_MS,
  TOKEN_EXPIRATION_BUFFER_MS,
  MULTI_REGION_FALLBACK_REGIONS,
  PARALLEL_REGION_ATTEMPTS
};
