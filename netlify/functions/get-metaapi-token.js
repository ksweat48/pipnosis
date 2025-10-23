// netlify/functions/get-metaapi-token.js
// Serverless function that returns a short-lived MetaAPI token using admin token.
// Expects POST JSON body: { accountId: "<account-id>" }
// Now includes aggressive timeout protection and token caching via Supabase

const { generateNarrowedToken, FUNCTION_TIMEOUT_MS, STALE_TOKEN_GRACE_PERIOD_MS } = require('./metaapi-utils');
const { createClient } = require('@supabase/supabase-js');

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

async function getCachedToken(supabase, accountId, region, allowStale = false) {
  const startTime = Date.now();
  try {
    console.log(`[${new Date().toISOString()}] Checking cache for account ${accountId} in ${region} region (allowStale: ${allowStale})...`);

    // First try to get a fresh (non-expired) token
    const { data: freshData, error: freshError } = await supabase
      .from('metaapi_token_cache')
      .select('*')
      .eq('account_id', accountId)
      .eq('region', region)
      .eq('is_valid', true)
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (freshError) {
      console.error(`[${new Date().toISOString()}] ERROR: Failed to fetch cached token:`, freshError);
      console.error(`[${new Date().toISOString()}] Error details:`, JSON.stringify(freshError, null, 2));
      return { success: false, error: freshError.message, token: null, stale: false };
    }

    const elapsed = Date.now() - startTime;
    if (freshData) {
      console.log(`[${new Date().toISOString()}] ✓ Found FRESH cached token for ${accountId}, expires at ${freshData.expires_at} (${elapsed}ms)`);
      return { success: true, token: freshData.token, cached: true, stale: false, expiresAt: freshData.expires_at };
    }

    // If no fresh token and allowStale is true, try to get a recently expired token
    if (allowStale) {
      const staleThreshold = new Date(Date.now() - STALE_TOKEN_GRACE_PERIOD_MS).toISOString();
      console.log(`[${new Date().toISOString()}] No fresh token found, checking for stale tokens (grace period: 5 minutes)...`);

      const { data: staleData, error: staleError } = await supabase
        .from('metaapi_token_cache')
        .select('*')
        .eq('account_id', accountId)
        .eq('region', region)
        .eq('is_valid', true)
        .gt('expires_at', staleThreshold)
        .order('expires_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (staleError) {
        console.error(`[${new Date().toISOString()}] ERROR: Failed to fetch stale token:`, staleError);
        return { success: false, error: staleError.message, token: null, stale: false };
      }

      if (staleData) {
        console.log(`[${new Date().toISOString()}] ⚠️  Found STALE cached token for ${accountId}, expired at ${staleData.expires_at} (within grace period) (${elapsed}ms)`);
        return { success: true, token: staleData.token, cached: true, stale: true, expiresAt: staleData.expires_at };
      }
    }

    console.log(`[${new Date().toISOString()}] No cached token found for ${accountId} (${elapsed}ms)`);
    return { success: true, token: null, cached: false, stale: false };
  } catch (err) {
    console.error(`[${new Date().toISOString()}] EXCEPTION in getCachedToken:`, err);
    console.error(`[${new Date().toISOString()}] Stack trace:`, err.stack);
    return { success: false, error: err.message, token: null, stale: false };
  }
}

async function cacheToken(supabase, accountId, region, token, validityHours) {
  const startTime = Date.now();
  try {
    console.log(`[${new Date().toISOString()}] Attempting to cache token for ${accountId}...`);

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + validityHours);

    const { data, error } = await supabase
      .from('metaapi_token_cache')
      .insert({
        account_id: accountId,
        region: region,
        token: token,
        expires_at: expiresAt.toISOString(),
        validity_hours: validityHours,
        is_valid: true
      })
      .select();

    const elapsed = Date.now() - startTime;

    if (error) {
      console.error(`[${new Date().toISOString()}] ERROR: Failed to cache token:`, error);
      console.error(`[${new Date().toISOString()}] Error code:`, error.code);
      console.error(`[${new Date().toISOString()}] Error details:`, JSON.stringify(error, null, 2));
      return { success: false, error: error.message };
    }

    console.log(`[${new Date().toISOString()}] ✓ Token cached successfully for ${accountId}, expires at ${expiresAt.toISOString()} (${elapsed}ms)`);
    return { success: true, data };
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`[${new Date().toISOString()}] EXCEPTION in cacheToken (${elapsed}ms):`, err);
    console.error(`[${new Date().toISOString()}] Stack trace:`, err.stack);
    return { success: false, error: err.message };
  }
}

exports.handler = async (event) => {
  const startTime = Date.now();

  // Create aggressive timeout promise that returns before gateway timeout
  const aggressiveTimeoutPromise = new Promise((resolve) => {
    setTimeout(() => {
      console.log(`[${new Date().toISOString()}] Aggressive timeout reached after ${FUNCTION_TIMEOUT_MS}ms`);
      resolve({
        statusCode: 504,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Token generation timeout',
          message: 'MetaAPI service is responding slowly. Please try again in a moment.',
          retryAfter: 5,
          cached: false
        })
      });
    }, FUNCTION_TIMEOUT_MS);
  });

  const mainLogicPromise = (async () => {
    try {
      // Handle CORS preflight
      if (event.httpMethod === 'OPTIONS') {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: ''
        };
      }

      // Only allow POST
      if (event.httpMethod !== 'POST') {
        return {
          statusCode: 405,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Method Not Allowed. Use POST.' })
        };
      }

      // Parse body
      let body = {};
      try {
        body = event.body ? JSON.parse(event.body) : {};
      } catch (err) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Invalid JSON body' })
        };
      }

      const { accountId } = body;
      if (!accountId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Missing accountId in request body' })
        };
      }

      // Get configuration from environment
      const adminToken = process.env.METAAPI_ADMIN_TOKEN;
      if (!adminToken) {
        console.error('METAAPI_ADMIN_TOKEN not configured in environment');
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Server misconfiguration: METAAPI_ADMIN_TOKEN missing' })
        };
      }

      const supabaseUrl = process.env.VITE_SUPABASE_URL;
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!supabaseUrl || !supabaseServiceKey) {
        console.error(`[${new Date().toISOString()}] WARNING: Supabase configuration incomplete`);
        console.error(`[${new Date().toISOString()}] VITE_SUPABASE_URL: ${supabaseUrl ? 'present' : 'MISSING'}`);
        console.error(`[${new Date().toISOString()}] SUPABASE_SERVICE_ROLE_KEY: ${supabaseServiceKey ? 'present' : 'MISSING'}`);
        console.error(`[${new Date().toISOString()}] Token caching will be disabled`);
      }

      const region = process.env.VITE_METAAPI_REGION || 'new-york';
      const validityInHours = 1;

      // Try to get cached token first
      let narrowedToken = null;
      let fromCache = false;
      let cacheError = null;
      let cacheWriteError = null;

      if (supabaseUrl && supabaseServiceKey) {
        console.log(`[${new Date().toISOString()}] Using service role key for cache operations`);
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Try to get cached token (fresh only, no stale)
        const cacheResult = await getCachedToken(supabase, accountId, region, false);

        if (!cacheResult.success) {
          cacheError = cacheResult.error;
          console.error(`[${new Date().toISOString()}] Cache read failed, will generate fresh token`);
        } else if (cacheResult.token) {
          narrowedToken = cacheResult.token;
          fromCache = true;
          const isStale = cacheResult.stale ? ' (STALE)' : '';
          console.log(`[${new Date().toISOString()}] ✓ Using cached token for account ${accountId}${isStale}`);
        } else {
          console.log(`[${new Date().toISOString()}] No cached token found, generating new token for ${accountId}`);
        }

        // Generate new token if needed
        if (!narrowedToken) {
          try {
            narrowedToken = await generateNarrowedToken(
              adminToken,
              accountId,
              region,
              validityInHours
            );

            // Try to cache the new token
            console.log(`[${new Date().toISOString()}] Attempting to cache newly generated token...`);
            const cacheWriteResult = await cacheToken(supabase, accountId, region, narrowedToken, validityInHours);

            if (!cacheWriteResult.success) {
              cacheWriteError = cacheWriteResult.error;
              console.error(`[${new Date().toISOString()}] WARNING: Token generated but failed to cache - next request will be slow`);
            }
          } catch (tokenError) {
            console.error(`[${new Date().toISOString()}] Token generation failed: ${tokenError.message}`);
            console.log(`[${new Date().toISOString()}] Attempting stale token fallback...`);

            // Try to get a stale token as emergency fallback
            const staleCacheResult = await getCachedToken(supabase, accountId, region, true);

            if (staleCacheResult.success && staleCacheResult.token) {
              narrowedToken = staleCacheResult.token;
              fromCache = true;
              console.log(`[${new Date().toISOString()}] ✓ Using STALE cached token as emergency fallback (expired at ${staleCacheResult.expiresAt})`);
              cacheError = 'Using stale token due to generation timeout';
            } else {
              // No stale token available, re-throw the error
              throw tokenError;
            }
          }
        }
      } else {
        // Fallback: generate without caching
        console.log(`[${new Date().toISOString()}] Generating token WITHOUT caching for account ${accountId} in ${region} region`);
        console.log(`[${new Date().toISOString()}] WARNING: Token caching disabled - every request will be slow`);
        narrowedToken = await generateNarrowedToken(
          adminToken,
          accountId,
          region,
          validityInHours
        );
      }

      const timeToLive = validityInHours * 60 * 60;
      const executionTime = Date.now() - startTime;

      console.log(`Token generation completed in ${executionTime}ms (cached: ${fromCache})`);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          token: narrowedToken,
          expiresIn: timeToLive,
          cached: fromCache,
          executionTime,
          cacheStatus: {
            enabled: !!(supabaseUrl && supabaseServiceKey),
            readError: cacheError,
            writeError: cacheWriteError
          }
        })
      };

    } catch (err) {
      const executionTime = Date.now() - startTime;
      console.error(`Error in get-metaapi-token after ${executionTime}ms:`, err);

      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Failed to generate MetaAPI token',
          detail: err.message,
          executionTime
        })
      };
    }
  })();

  // Race between aggressive timeout and main logic
  return Promise.race([mainLogicPromise, aggressiveTimeoutPromise]);
};
