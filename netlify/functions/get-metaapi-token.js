// netlify/functions/get-metaapi-token.js
// Generates narrowed MetaAPI tokens with Supabase caching

const { createClient } = require('@supabase/supabase-js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const TOKEN_VALIDITY_HOURS = 1;
const TOKEN_EXPIRATION_BUFFER_MS = 5 * 60 * 1000; // 5 minutes
const STALE_TOKEN_GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes
const TOKEN_GENERATION_TIMEOUT_MS = 14000; // 14 seconds
const FUNCTION_TIMEOUT_MS = 25700; // 25.7 seconds (safety buffer before 26s Netlify limit)

// Multi-region fallback order
const REGIONS = ['new-york', 'london', 'singapore'];

function resolveMetaApiCtor() {
  try {
    const m = require('metaapi.cloud-sdk');
    return m.default || m.MetaApi || m;
  } catch (e) {
    throw new Error('MetaApi SDK is not installed or could not be required');
  }
}

async function getCachedToken(accountId, region, supabase) {
  if (!supabase) return null;

  try {
    const now = new Date();
    const bufferTime = new Date(now.getTime() + TOKEN_EXPIRATION_BUFFER_MS);

    const { data, error } = await supabase
      .from('metaapi_token_cache')
      .select('token, expires_at')
      .eq('account_id', accountId)
      .eq('region', region)
      .gt('expires_at', bufferTime.toISOString())
      .maybeSingle();

    if (error) {
      console.warn('Cache lookup failed:', error.message);
      return null;
    }

    if (data && data.token) {
      const expiresAt = new Date(data.expires_at);
      const minutesUntilExpiry = Math.floor((expiresAt.getTime() - now.getTime()) / 60000);
      console.log(`✓ Valid cached token found (expires in ${minutesUntilExpiry} minutes)`);
      return {
        token: data.token,
        expiresAt: data.expires_at,
        source: 'cache'
      };
    }

    return null;
  } catch (e) {
    console.warn('Cache retrieval error:', e.message);
    return null;
  }
}

async function cacheToken(token, accountId, region, validityHours, supabase) {
  if (!supabase) return;

  try {
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
        updated_at: now.toISOString()
      }, {
        onConflict: 'account_id,region'
      });

    if (error) {
      console.warn('Token caching failed:', error.message);
    } else {
      console.log('✓ Token cached successfully');
    }
  } catch (e) {
    console.warn('Cache storage error:', e.message);
  }
}

async function getFallbackToken(accountId, region, supabase) {
  if (!supabase) return null;

  try {
    const now = new Date();
    const gracePeriodStart = new Date(now.getTime() - STALE_TOKEN_GRACE_PERIOD_MS);

    const { data, error } = await supabase
      .from('metaapi_token_cache')
      .select('token, expires_at')
      .eq('account_id', accountId)
      .eq('region', region)
      .gt('expires_at', gracePeriodStart.toISOString())
      .lt('expires_at', now.toISOString())
      .maybeSingle();

    if (error || !data) return null;

    console.warn('⚠ Using expired token as emergency fallback (expires_at:', data.expires_at, ')');
    return {
      token: data.token,
      expiresAt: data.expires_at,
      source: 'fallback',
      warning: 'Using recently expired token due to generation failure'
    };
  } catch (e) {
    console.warn('Fallback token retrieval error:', e.message);
    return null;
  }
}

async function generateTokenForRegion(adminToken, accountId, region, timeout) {
  const MetaApi = resolveMetaApiCtor();
  const metaApi = new MetaApi(adminToken, { region });

  const tokenPromise = metaApi.metatraderAccountApi.getAccount(accountId).then(account => {
    return account.accessToken || account.token;
  });

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Token generation timeout after ${timeout}ms`)), timeout);
  });

  return Promise.race([tokenPromise, timeoutPromise]);
}

async function generateNarrowedToken(adminToken, accountId, primaryRegion, supabase) {
  // 1. Try cache first
  const cached = await getCachedToken(accountId, primaryRegion, supabase);
  if (cached) {
    return {
      ...cached,
      cached: true
    };
  }

  console.log(`No valid cached token, generating new token...`);

  // 2. Try to generate token with multi-region fallback
  const regionsToTry = [primaryRegion, ...REGIONS.filter(r => r !== primaryRegion)];
  let lastError = null;

  for (const region of regionsToTry) {
    try {
      console.log(`Attempting token generation for region: ${region}`);
      const token = await generateTokenForRegion(adminToken, accountId, region, TOKEN_GENERATION_TIMEOUT_MS);

      if (token) {
        console.log(`Token generated successfully for region: ${region}`);

        // Cache the new token
        await cacheToken(token, accountId, region, TOKEN_VALIDITY_HOURS, supabase);

        const expiresAt = new Date(Date.now() + TOKEN_VALIDITY_HOURS * 60 * 60 * 1000).toISOString();
        return {
          token,
          source: 'generated',
          region,
          expiresAt,
          cached: false
        };
      }
    } catch (err) {
      console.warn(`Token generation failed for ${region}:`, err.message);
      lastError = err;
      continue;
    }
  }

  // 3. Emergency fallback - try to use recently expired token
  console.warn('All regions failed, attempting emergency fallback...');
  const fallback = await getFallbackToken(accountId, primaryRegion, supabase);
  if (fallback) {
    return {
      ...fallback,
      cached: true
    };
  }

  // 4. Total failure
  throw new Error(`Token generation failed for all regions. Last error: ${lastError?.message || 'Unknown error'}`);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }

  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const startTime = Date.now();

  try {
    // Environment validation
    const adminToken = process.env.METAAPI_ADMIN_TOKEN;
    const accountId = process.env.METAAPI_ACCOUNT_ID || process.env.VITE_METAAPI_ACCOUNT_ID;
    const region = process.env.METAAPI_REGION || process.env.VITE_METAAPI_REGION || 'new-york';

    if (!adminToken) {
      return {
        statusCode: 500,
        headers: CORS,
        body: JSON.stringify({ error: 'Missing METAAPI_ADMIN_TOKEN in environment' })
      };
    }

    if (!accountId) {
      return {
        statusCode: 500,
        headers: CORS,
        body: JSON.stringify({ error: 'Missing METAAPI_ACCOUNT_ID in environment' })
      };
    }

    // Initialize Supabase for caching (optional)
    let supabase = null;
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && supabaseKey) {
      supabase = createClient(supabaseUrl, supabaseKey);
      console.log('✓ Supabase caching enabled');
    } else {
      console.warn('⚠ Supabase caching disabled (missing credentials)');
    }

    // Generate token with timeout protection
    const tokenPromise = generateNarrowedToken(adminToken, accountId, region, supabase);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Function timeout after ${FUNCTION_TIMEOUT_MS}ms`)), FUNCTION_TIMEOUT_MS);
    });

    const result = await Promise.race([tokenPromise, timeoutPromise]);

    const duration = Date.now() - startTime;
    console.log(`Token retrieval completed in ${duration}ms (source: ${result.source})`);

    return {
      statusCode: 200,
      headers: {
        ...CORS,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({
        token: result.token,
        source: result.source,
        region: result.region || region,
        expiresAt: result.expiresAt,
        cached: result.cached,
        warning: result.warning,
        duration
      })
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error('Token generation error:', err);

    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error: 'Token generation failed',
        message: err?.message || String(err),
        duration
      })
    };
  }
};
