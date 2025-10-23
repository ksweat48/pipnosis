// netlify/functions/get-metaapi-token.js
// Serverless function that returns a short-lived MetaAPI token using admin token.
// Expects POST JSON body: { accountId: "<account-id>" }
// Now includes aggressive timeout protection and token caching via Supabase

const { generateNarrowedToken, FUNCTION_TIMEOUT_MS } = require('./metaapi-utils');
const { createClient } = require('@supabase/supabase-js');

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

async function getCachedToken(supabase, accountId, region) {
  const startTime = Date.now();
  try {
    console.log(`[${new Date().toISOString()}] Checking cache for account ${accountId} in ${region} region...`);

    const { data, error } = await supabase
      .from('metaapi_token_cache')
      .select('*')
      .eq('account_id', accountId)
      .eq('region', region)
      .eq('is_valid', true)
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(`[${new Date().toISOString()}] ERROR: Failed to fetch cached token:`, error);
      console.error(`[${new Date().toISOString()}] Error details:`, JSON.stringify(error, null, 2));
      return { success: false, error: error.message, token: null };
    }

    const elapsed = Date.now() - startTime;
    if (data) {
      console.log(`[${new Date().toISOString()}] ✓ Found cached token for ${accountId}, expires at ${data.expires_at} (${elapsed}ms)`);
      return { success: true, token: data.token, cached: true };
    }

    console.log(`[${new Date().toISOString()}] No cached token found for ${accountId} (${elapsed}ms)`);
    return { success: true, token: null, cached: false };
  } catch (err) {
    console.error(`[${new Date().toISOString()}] EXCEPTION in getCachedToken:`, err);
    console.error(`[${new Date().toISOString()}] Stack trace:`, err.stack);
    return { success: false, error: err.message, token: null };
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

        // Try to get cached token
        const cacheResult = await getCachedToken(supabase, accountId, region);

        if (!cacheResult.success) {
          cacheError = cacheResult.error;
          console.error(`[${new Date().toISOString()}] Cache read failed, will generate fresh token`);
        } else if (cacheResult.token) {
          narrowedToken = cacheResult.token;
          fromCache = true;
          console.log(`[${new Date().toISOString()}] ✓ Using cached token for account ${accountId}`);
        } else {
          console.log(`[${new Date().toISOString()}] No cached token found, generating new token for ${accountId}`);
        }

        // Generate new token if needed
        if (!narrowedToken) {
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
