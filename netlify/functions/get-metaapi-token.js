// netlify/functions/get-metaapi-token.js
// Serverless function that returns a short-lived MetaAPI token using admin token.
// Reads accountId from METAAPI_ACCOUNT_ID environment variable.
// Uses cache-first approach with Supabase for optimal performance.

const MetaApi = require('metaapi.cloud-sdk');
const { createClient } = require('@supabase/supabase-js');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type'
};

// Cache configuration
const TOKEN_EXPIRATION_BUFFER_MS = 10 * 60 * 1000; // 10 minutes - refresh token if expiring within 10 minutes

/**
 * Check Supabase cache for a valid token
 */
async function getCachedToken(accountId, region) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.log('[Cache] Supabase not configured - skipping cache check');
      return null;
    }

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
    console.log(`✅ Valid cached token found (expires in ${minutesRemaining} minutes)`);

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
 */
async function cacheToken(token, accountId, region, validityHours, generationTimeMs) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.log('[Cache] Supabase not configured - skipping token caching');
      return;
    }

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
        source_region: region,
        use_count: 0,
        last_used_at: now.toISOString()
      }, {
        onConflict: 'account_id,region'
      });

    if (error) {
      console.warn('[Cache] Failed to cache token:', error.message);
    } else {
      console.log(`✅ Token cached successfully (expires: ${expiresAt.toISOString()}, generation: ${generationTimeMs}ms)`);
    }
  } catch (error) {
    console.warn('[Cache] Unexpected error during token caching:', error.message);
  }
}

exports.handler = async (event, context) => {
  const startTime = Date.now();

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  try {
    const adminToken = process.env.METAAPI_ADMIN_TOKEN;
    const accountId = process.env.METAAPI_ACCOUNT_ID || process.env.VITE_METAAPI_ACCOUNT_ID;
    const region = process.env.METAAPI_REGION || process.env.VITE_METAAPI_REGION || 'new-york';

    if (!adminToken) {
      console.error('❌ Missing METAAPI_ADMIN_TOKEN in Netlify env');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'METAAPI_ADMIN_TOKEN missing on server' })
      };
    }

    if (!accountId) {
      console.error('❌ Missing METAAPI_ACCOUNT_ID in Netlify env');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'METAAPI_ACCOUNT_ID missing on server' })
      };
    }

    console.log(`Fetching secure temporary token for account: ${accountId} in region: ${region}`);

    // Step 1: Check cache first
    const cachedToken = await getCachedToken(accountId, region);

    if (cachedToken) {
      const executionTime = Date.now() - startTime;
      console.log(`✅ Using cached token (retrieved in ${executionTime}ms)`);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          token: cachedToken.token,
          expiresAt: cachedToken.expires_at,
          cached: true,
          source: 'cache',
          executionTime
        })
      };
    }

    // Step 2: No valid cache - generate new token
    console.log('No valid cached token - generating fresh token...');

    const generationStartTime = Date.now();

    // Initialize MetaApi SDK with admin token
    const metaApi = new MetaApi(adminToken, { region });

    // Generate a narrowed-down temporary token for this account
    const result = await metaApi.tokenManagementApi.narrowDownTokenResources({
      accountId
    });

    const token = result.token;

    if (!token) {
      console.error('❌ MetaApi did not return a token');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'MetaApi token request failed' })
      };
    }

    const generationTimeMs = Date.now() - generationStartTime;
    console.log(`✅ MetaAPI Temporary Token Generated for account: ${accountId} (${generationTimeMs}ms)`);

    // Step 3: Cache the newly generated token
    const validityHours = 1;
    await cacheToken(token, accountId, region, validityHours, generationTimeMs);

    const executionTime = Date.now() - startTime;
    const expiresAt = new Date(Date.now() + validityHours * 60 * 60 * 1000);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        token,
        expiresAt: expiresAt.toISOString(),
        cached: false,
        source: 'generated',
        executionTime,
        generationTimeMs
      })
    };

  } catch (err) {
    console.error('❌ Server error during MetaApi token generation:', err);
    const executionTime = Date.now() - startTime;

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Internal Server Error',
        details: err.message,
        executionTime
      })
    };
  }
};
