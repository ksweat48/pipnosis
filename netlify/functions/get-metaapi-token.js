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
  try {
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
      console.error('Error fetching cached token:', error);
      return null;
    }

    if (data) {
      console.log(`Found cached token for ${accountId}, expires at ${data.expires_at}`);
      return data.token;
    }

    return null;
  } catch (err) {
    console.error('Exception in getCachedToken:', err);
    return null;
  }
}

async function cacheToken(supabase, accountId, region, token, validityHours) {
  try {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + validityHours);

    const { error } = await supabase
      .from('metaapi_token_cache')
      .insert({
        account_id: accountId,
        region: region,
        token: token,
        expires_at: expiresAt.toISOString(),
        validity_hours: validityHours,
        is_valid: true
      });

    if (error) {
      console.error('Error caching token:', error);
    } else {
      console.log(`Cached token for ${accountId}, expires at ${expiresAt.toISOString()}`);
    }
  } catch (err) {
    console.error('Exception in cacheToken:', err);
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
      const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseKey) {
        console.error('Supabase configuration missing');
      }

      const region = process.env.VITE_METAAPI_REGION || 'new-york';
      const validityInHours = 1;

      // Try to get cached token first
      let narrowedToken = null;
      let fromCache = false;

      if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey);
        narrowedToken = await getCachedToken(supabase, accountId, region);

        if (narrowedToken) {
          fromCache = true;
          console.log(`Using cached token for account ${accountId}`);
        } else {
          console.log(`No cached token found, generating new token for ${accountId}`);

          // Generate new token
          narrowedToken = await generateNarrowedToken(
            adminToken,
            accountId,
            region,
            validityInHours
          );

          // Cache the new token
          await cacheToken(supabase, accountId, region, narrowedToken, validityInHours);
        }
      } else {
        // Fallback: generate without caching
        console.log(`Generating token without caching for account ${accountId} in ${region} region`);
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
          executionTime
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
