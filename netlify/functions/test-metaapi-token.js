const MetaApi = require('metaapi.cloud-sdk');
const { createClient } = require('@supabase/supabase-js');
const { verifyAccount, getSDKInfo } = require('./metaapi-utils');
const { createLogger } = require('./function-logger');
const { handleCorsPreFlight } = require('./error-handler');

const FUNCTION_NAME = 'test-metaapi-token';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function addStep(results, step, status, message, details = null) {
  results.push({
    step,
    status,
    message,
    details,
    timestamp: new Date().toISOString()
  });
}

exports.handler = async (event) => {
  const logger = createLogger(FUNCTION_NAME);
  const startTime = Date.now();

  logger.info('MetaAPI token test initiated');

  if (event.httpMethod === 'OPTIONS') {
    return handleCorsPreFlight();
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const testResults = [];

  try {
    const body = JSON.parse(event.body || '{}');
    const { testAdminToken } = body;

    // Use provided admin token or fall back to environment variable
    const adminToken = testAdminToken || process.env.METAAPI_ADMIN_TOKEN;
    const accountId = process.env.METAAPI_ACCOUNT_ID;
    const region = process.env.METAAPI_REGION || 'new-york';
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Step 0: Check cache configuration
    addStep(
      testResults,
      '0. Cache Configuration',
      'running',
      'Checking Supabase token cache configuration...'
    );

    const cacheEnabled = !!(supabaseUrl && supabaseServiceKey);

    if (cacheEnabled) {
      try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const { data, error } = await supabase
          .from('metaapi_token_cache')
          .select('account_id, region, expires_at, use_count')
          .eq('account_id', accountId)
          .eq('region', region)
          .maybeSingle();

        if (error && error.code !== 'PGRST116') {
          throw error;
        }

        testResults[testResults.length - 1].status = 'success';
        testResults[testResults.length - 1].message = data
          ? `Cache enabled and healthy. Found cached token (expires: ${data.expires_at}, uses: ${data.use_count})`
          : 'Cache enabled and healthy. No cached token yet.';
        testResults[testResults.length - 1].details = {
          cacheEnabled: true,
          cachedToken: !!data,
          tokenDetails: data || null
        };
      } catch (err) {
        testResults[testResults.length - 1].status = 'error';
        testResults[testResults.length - 1].message = 'Cache configuration error: ' + err.message;
        testResults[testResults.length - 1].details = { error: err.message };
      }
    } else {
      testResults[testResults.length - 1].status = 'error';
      testResults[testResults.length - 1].message = 'Supabase cache not configured (SUPABASE_URL or SUPABASE_SERVICE_ROLE missing)';
      testResults[testResults.length - 1].details = {
        cacheEnabled: false,
        hasSupabaseUrl: !!supabaseUrl,
        hasSupabaseServiceKey: !!supabaseServiceKey
      };
    }

    // Step 1: Check environment variables
    addStep(
      testResults,
      '1. Environment Variables',
      'running',
      'Checking required environment variables...'
    );

    const missingVars = [];
    if (!adminToken) missingVars.push('METAAPI_ADMIN_TOKEN');
    if (!accountId) missingVars.push('METAAPI_ACCOUNT_ID');

    if (missingVars.length > 0) {
      testResults[testResults.length - 1].status = 'error';
      testResults[testResults.length - 1].message = `Missing required environment variables: ${missingVars.join(', ')}`;
      testResults[testResults.length - 1].details = {
        hasAdminToken: !!adminToken,
        hasAccountId: !!accountId,
        region
      };

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          testResults,
          error: 'Missing required environment variables'
        })
      };
    }

    testResults[testResults.length - 1].status = 'success';
    testResults[testResults.length - 1].message = 'All required environment variables are present';
    testResults[testResults.length - 1].details = {
      adminTokenPresent: true,
      accountId,
      region
    };

    // Step 2: Check SDK initialization
    addStep(
      testResults,
      '2. SDK Initialization',
      'running',
      'Checking MetaAPI SDK can be loaded...'
    );

    const sdkInfo = getSDKInfo();

    if (!sdkInfo.loaded) {
      testResults[testResults.length - 1].status = 'error';
      testResults[testResults.length - 1].message = 'Failed to load MetaAPI SDK: ' + sdkInfo.error;
      testResults[testResults.length - 1].details = sdkInfo;

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          testResults,
          error: 'SDK initialization failed'
        })
      };
    }

    testResults[testResults.length - 1].status = 'success';
    testResults[testResults.length - 1].message = 'MetaAPI SDK loaded successfully';
    testResults[testResults.length - 1].details = sdkInfo;

    // Step 3: Initialize MetaAPI client
    addStep(
      testResults,
      '3. MetaAPI Client',
      'running',
      'Creating MetaAPI client with admin token...'
    );

    let metaApi;
    try {
      metaApi = new MetaApi(adminToken, { region });
      testResults[testResults.length - 1].status = 'success';
      testResults[testResults.length - 1].message = 'MetaAPI client initialized successfully';
      testResults[testResults.length - 1].details = {
        region,
        hasTokenManagementApi: !!metaApi.tokenManagementApi
      };
    } catch (err) {
      testResults[testResults.length - 1].status = 'error';
      testResults[testResults.length - 1].message = 'Failed to create MetaAPI client: ' + err.message;
      testResults[testResults.length - 1].details = { error: err.message };

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          testResults,
          error: 'MetaAPI client creation failed'
        })
      };
    }

    // Step 4: Generate narrowed token
    addStep(
      testResults,
      '4. Token Generation',
      'running',
      'Generating narrowed token using narrowDownTokenResources()...'
    );

    let generatedToken;
    const tokenGenStartTime = Date.now();

    try {
      const result = await metaApi.tokenManagementApi.narrowDownTokenResources({
        accountId
      });

      generatedToken = result.token;
      const generationTimeMs = Date.now() - tokenGenStartTime;

      if (!generatedToken) {
        throw new Error('MetaAPI did not return a token');
      }

      testResults[testResults.length - 1].status = 'success';
      testResults[testResults.length - 1].message = `Token generated successfully in ${generationTimeMs}ms`;
      testResults[testResults.length - 1].details = {
        tokenLength: generatedToken.length,
        tokenPrefix: generatedToken.substring(0, 20) + '...',
        generationTimeMs,
        method: 'narrowDownTokenResources'
      };
    } catch (err) {
      const generationTimeMs = Date.now() - tokenGenStartTime;
      testResults[testResults.length - 1].status = 'error';
      testResults[testResults.length - 1].message = `Token generation failed after ${generationTimeMs}ms: ${err.message}`;
      testResults[testResults.length - 1].details = {
        error: err.message,
        generationTimeMs
      };

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          testResults,
          error: 'Token generation failed'
        })
      };
    }

    // Step 5: Verify account access
    addStep(
      testResults,
      '5. Account Verification',
      'running',
      'Verifying account access with generated token...'
    );

    try {
      const accountInfo = await verifyAccount(generatedToken, accountId, region);

      testResults[testResults.length - 1].status = 'success';
      testResults[testResults.length - 1].message = `Account verified: ${accountInfo.name}`;
      testResults[testResults.length - 1].details = accountInfo;
    } catch (err) {
      testResults[testResults.length - 1].status = 'error';
      testResults[testResults.length - 1].message = 'Account verification failed: ' + err.message;
      testResults[testResults.length - 1].details = { error: err.message };

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          testResults,
          error: 'Account verification failed'
        })
      };
    }

    // Step 6: Cache the token
    if (cacheEnabled) {
      addStep(
        testResults,
        '6. Token Caching',
        'running',
        'Storing token in Supabase cache...'
      );

      try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour

        const { error } = await supabase
          .from('metaapi_token_cache')
          .upsert({
            account_id: accountId,
            region: region,
            token: generatedToken,
            expires_at: expiresAt.toISOString(),
            is_valid: true,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
            generation_time_ms: Date.now() - tokenGenStartTime,
            source_region: region,
            use_count: 0,
            last_used_at: now.toISOString()
          }, {
            onConflict: 'account_id,region'
          });

        if (error) {
          throw error;
        }

        testResults[testResults.length - 1].status = 'success';
        testResults[testResults.length - 1].message = 'Token cached successfully';
        testResults[testResults.length - 1].details = {
          expiresAt: expiresAt.toISOString()
        };
      } catch (err) {
        testResults[testResults.length - 1].status = 'error';
        testResults[testResults.length - 1].message = 'Token caching failed: ' + err.message;
        testResults[testResults.length - 1].details = { error: err.message };
      }
    }

    const executionTime = Date.now() - startTime;

    logger.success('All tests passed', { executionTime, totalSteps: testResults.length });
    await logger.saveToDatabase(200, executionTime, { testAdminToken: !!body.testAdminToken }, { testResults });

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        testResults,
        message: `All tests passed in ${executionTime}ms`,
        token: {
          generated: true,
          prefix: generatedToken.substring(0, 20) + '...',
          length: generatedToken.length
        }
      })
    };

  } catch (error) {
    logger.error('Test function failed', { error: error.message, stack: error.stack });
    await logger.saveToDatabase(500, Date.now() - startTime, {}, null, error);

    addStep(
      testResults,
      'Unexpected Error',
      'error',
      'An unexpected error occurred: ' + error.message,
      { error: error.message, stack: error.stack }
    );

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        testResults,
        error: error.message
      })
    };
  }
};
