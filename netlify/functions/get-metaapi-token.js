// netlify/functions/get-metaapi-token.js
// Serverless function that returns a short-lived MetaAPI token using admin token.
// Expects POST JSON body: { accountId: "<account-id>" }
// Uses cache-first approach with emergency fallback via metaapi-utils.js

const { generateNarrowedToken, FUNCTION_TIMEOUT_MS } = require('./metaapi-utils');

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};


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

      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE;

      if (!supabaseUrl || !supabaseServiceKey) {
        console.error(`[${new Date().toISOString()}] WARNING: Supabase configuration incomplete`);
        console.error(`[${new Date().toISOString()}] SUPABASE_URL: ${supabaseUrl ? 'present' : 'MISSING'}`);
        console.error(`[${new Date().toISOString()}] SUPABASE_SERVICE_ROLE: ${supabaseServiceKey ? 'present' : 'MISSING'}`);
        console.error(`[${new Date().toISOString()}] Token caching will be disabled`);
      }

      const region = process.env.METAAPI_REGION || 'new-york';
      const validityInHours = 1;

      // Use the unified generateNarrowedToken function with built-in caching and fallback
      console.log(`[${new Date().toISOString()}] Requesting token for account ${accountId} in ${region} region`);

      const tokenResult = await generateNarrowedToken(
        adminToken,
        accountId,
        region,
        validityInHours
      );

      const timeToLive = validityInHours * 60 * 60;
      const executionTime = Date.now() - startTime;

      console.log(`[${new Date().toISOString()}] Token retrieval completed in ${executionTime}ms (source: ${tokenResult.source})`);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          token: tokenResult.token,
          expiresIn: timeToLive,
          expiresAt: tokenResult.expiresAt,
          cached: tokenResult.cached,
          source: tokenResult.source,
          region: tokenResult.region || region,
          fallbackUsed: tokenResult.fallbackUsed || false,
          executionTime,
          warning: tokenResult.warning || null,
          cacheStatus: {
            enabled: !!(supabaseUrl && supabaseServiceKey)
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
