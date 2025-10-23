// netlify/functions/test-metaapi-token.js
// Comprehensive test function for MetaAPI token generation and account verification

const {
  initializeMetaApiSDK,
  createMetaApiClient,
  generateNarrowedToken,
  verifyAccount,
  getSDKInfo,
  withTimeout,
  FUNCTION_TIMEOUT_MS
} = require('./metaapi-utils');

const { createClient } = require('@supabase/supabase-js');

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
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Test function started`);

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const testResults = [];

  // Create a global timeout to ensure we always return a response
  const globalTimeoutPromise = new Promise((resolve) => {
    setTimeout(() => {
      console.log(`[${new Date().toISOString()}] Global timeout reached after ${FUNCTION_TIMEOUT_MS}ms`);
      resolve({
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          testResults,
          error: 'Function execution time limit reached',
          details: `The test took longer than ${FUNCTION_TIMEOUT_MS}ms to complete. This indicates MetaAPI servers are responding slowly. The function has been configured with automatic retries and extended timeouts, but the service may still be experiencing high load.`
        })
      });
    }, FUNCTION_TIMEOUT_MS);
  });

  // Main test execution
  const testExecutionPromise = (async () => {
    try {
      const body = JSON.parse(event.body || '{}');
      const { testAdminToken, testAccountId } = body;

      // Use provided tokens or fall back to environment variables
      const adminToken = testAdminToken || process.env.METAAPI_ADMIN_TOKEN;
      const accountId = testAccountId || process.env.VITE_METAAPI_ACCOUNT_ID;
      const region = process.env.VITE_METAAPI_REGION || 'new-york';
      const supabaseUrl = process.env.VITE_SUPABASE_URL;
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      // Step 1: Check environment variables
      // Step 0: Check cache configuration
      addStep(
        testResults,
        '0. Cache Configuration',
        'running',
        'Checking token cache configuration...'
      );

      const cacheEnabled = !!(supabaseUrl && supabaseServiceKey);
      let cacheHealthy = false;

      if (cacheEnabled) {
        try {
          const supabase = createClient(supabaseUrl, supabaseServiceKey);
          const { data, error } = await supabase
            .from('metaapi_token_cache')
            .select('id')
            .limit(1);

          if (error) {
            addStep(
              testResults,
              '0. Cache Configuration',
              'error',
              'Cache table accessible but query failed',
              {
                error: error.message,
                code: error.code,
                hasServiceKey: !!supabaseServiceKey,
                hint: 'Check RLS policies and service role permissions'
              }
            );
          } else {
            cacheHealthy = true;
            addStep(
              testResults,
              '0. Cache Configuration',
              'success',
              'Token cache is properly configured and accessible',
              {
                cacheEnabled: true,
                cacheHealthy: true,
                recordsFound: data ? data.length : 0,
                note: 'Service role key working correctly'
              }
            );
          }
        } catch (cacheError) {
          addStep(
            testResults,
            '0. Cache Configuration',
            'error',
            'Cache health check failed',
            {
              error: cacheError.message,
              hasServiceKey: !!supabaseServiceKey,
              warning: 'Token generation will work but will be slow (no caching)'
            }
          );
        }
      } else {
        addStep(
          testResults,
          '0. Cache Configuration',
          'error',
          'Token cache not configured - missing environment variables',
          {
            hasSupabaseUrl: !!supabaseUrl,
            hasServiceRoleKey: !!supabaseServiceKey,
            impact: 'Every token request will take 18-25 seconds',
            fix: 'Add SUPABASE_SERVICE_ROLE_KEY to Netlify environment variables'
          }
        );
      }

      // Step 1: Check environment variables
      addStep(
        testResults,
        '1. Environment Check',
        'running',
        'Checking environment variables...'
      );

      if (!adminToken) {
        addStep(
          testResults,
          '1. Environment Check',
          'error',
          'METAAPI_ADMIN_TOKEN not found in environment variables',
          {
            hasEnvToken: !!process.env.METAAPI_ADMIN_TOKEN,
            hasProvidedToken: !!testAdminToken
          }
        );

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            testResults,
            error: 'Admin token not configured'
          })
        };
      }

      if (!accountId) {
        addStep(
          testResults,
          '1. Environment Check',
          'error',
          'Account ID not found',
          {
            hasEnvAccountId: !!process.env.VITE_METAAPI_ACCOUNT_ID,
            hasProvidedAccountId: !!testAccountId
          }
        );

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            testResults,
            error: 'Account ID not configured'
          })
        };
      }

      addStep(
        testResults,
        '1. Environment Check',
        'success',
        'Environment variables found',
        {
          hasAdminToken: true,
          tokenLength: adminToken.length,
          tokenPrefix: adminToken.substring(0, 20) + '...',
          accountId,
          region,
          cacheEnabled,
          cacheHealthy,
          nodeVersion: process.version,
          platform: process.platform,
          envVarSource: testAdminToken ? 'provided' : 'environment'
        }
      );

      // Step 2: Check SDK loading
      addStep(
        testResults,
        '2. SDK Import',
        'running',
        'Loading MetaAPI SDK...'
      );

      let sdkInfo;
      try {
        console.log(`[${new Date().toISOString()}] Checking SDK info...`);
        sdkInfo = getSDKInfo();

        if (!sdkInfo.loaded) {
          addStep(
            testResults,
            '2. SDK Import',
            'error',
            'Failed to load MetaAPI SDK',
            sdkInfo
          );

          return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              success: false,
              testResults,
              error: 'SDK import failed'
            })
          };
        }

        addStep(
          testResults,
          '2. SDK Import',
          'success',
          'MetaAPI SDK loaded successfully',
          sdkInfo
        );
      } catch (sdkError) {
        addStep(
          testResults,
          '2. SDK Import',
          'error',
          'SDK import threw an error',
          {
            error: sdkError.message,
            stack: sdkError.stack
          }
        );

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            testResults,
            error: 'SDK import failed'
          })
        };
      }

      // Step 3: Initialize MetaAPI client
      addStep(
        testResults,
        '3. Initialize Client',
        'running',
        'Initializing MetaAPI client...'
      );

      let metaApi;
      try {
        console.log(`[${new Date().toISOString()}] Creating MetaAPI client...`);
        metaApi = createMetaApiClient(adminToken, {
          domain: `${region}.agiliumtrade.ai`
        });

        addStep(
          testResults,
          '3. Initialize Client',
          'success',
          'MetaAPI client initialized',
          {
            hasTokenManagementApi: !!metaApi.tokenManagementApi,
            hasMetatraderAccountApi: !!metaApi.metatraderAccountApi,
            region: region,
            domain: `${region}.agiliumtrade.ai`
          }
        );
      } catch (initError) {
        addStep(
          testResults,
          '3. Initialize Client',
          'error',
          'Failed to initialize MetaAPI client',
          {
            error: initError.message,
            stack: initError.stack
          }
        );

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            testResults,
            error: 'Client initialization failed'
          })
        };
      }

      // Step 4: Generate narrowed token with optimized timeout
      const tokenMessage = cacheHealthy
        ? 'Generating narrowed token (will be cached for future use)...'
        : 'Generating narrowed token (WARNING: caching disabled - this will be slow)...';

      addStep(
        testResults,
        '4. Generate Token',
        'running',
        tokenMessage
      );

      let narrowedToken;
      try {
        console.log(`[${new Date().toISOString()}] Starting token generation with optimized timeout...`);
        console.log(`[${new Date().toISOString()}] Timeout: 20 seconds per attempt, 1 retry on failure`);

        narrowedToken = await generateNarrowedToken(
          adminToken,
          accountId,
          region,
          1
        );
        console.log(`[${new Date().toISOString()}] Token generation completed successfully`);

        const generationTime = Date.now() - startTime;
        addStep(
          testResults,
          '4. Generate Token',
          'success',
          cacheHealthy ? 'Token generated and cached successfully' : 'Token generated (not cached)',
          {
            tokenLength: narrowedToken.length,
            tokenPrefix: narrowedToken.substring(0, 20) + '...',
            validityHours: 1,
            expiresIn: 3600,
            generationTime: `${generationTime}ms`,
            cached: cacheHealthy,
            note: cacheHealthy
              ? 'Token cached - next request will be <100ms'
              : 'Token NOT cached - every request will take 18-25 seconds'
          }
        );
      } catch (tokenError) {
        const errorDetails = {
          error: tokenError.message,
          stack: tokenError.stack,
          troubleshooting: []
        };

        if (tokenError.message.includes('timed out') || tokenError.message.includes('timeout')) {
          errorDetails.troubleshooting.push('MetaAPI servers are responding slowly or experiencing high load');
          errorDetails.troubleshooting.push('The function automatically retried once with optimized timing');
          errorDetails.troubleshooting.push('Try again in a few minutes when server load decreases');
          errorDetails.troubleshooting.push('Consider using cached tokens if available');
        } else if (tokenError.message.includes('ECONNREFUSED') || tokenError.message.includes('ENOTFOUND')) {
          errorDetails.troubleshooting.push('Network connectivity issue to MetaAPI servers');
          errorDetails.troubleshooting.push('Check your internet connection');
          errorDetails.troubleshooting.push(`Verify region setting is correct (current: ${region})`);
        } else if (tokenError.message.includes('Unauthorized') || tokenError.message.includes('401')) {
          errorDetails.troubleshooting.push('Admin token is invalid or expired');
          errorDetails.troubleshooting.push('Verify METAAPI_ADMIN_TOKEN in environment variables');
        } else if (tokenError.message.includes('429') || tokenError.message.includes('rate limit')) {
          errorDetails.troubleshooting.push('MetaAPI rate limit exceeded');
          errorDetails.troubleshooting.push('Wait 5-10 minutes before trying again');
        }

        addStep(
          testResults,
          '4. Generate Token',
          'error',
          'Failed to generate token after multiple retry attempts',
          errorDetails
        );

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            testResults,
            error: 'Token generation failed after retries',
            details: tokenError.message
          })
        };
      }

      // Step 5: Verify account with narrowed token
      addStep(
        testResults,
        '5. Verify Account',
        'running',
        'Verifying account access with generated token...'
      );

      try {
        console.log(`[${new Date().toISOString()}] Starting account verification...`);
        const accountInfo = await verifyAccount(narrowedToken, accountId, region);
        console.log(`[${new Date().toISOString()}] Account verification completed`);

        addStep(
          testResults,
          '5. Verify Account',
          'success',
          'Account verified successfully',
          accountInfo
        );
      } catch (verifyError) {
        addStep(
          testResults,
          '5. Verify Account',
          'error',
          'Failed to verify account',
          {
            error: verifyError.message,
            stack: verifyError.stack
          }
        );

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

      // All tests passed
      const executionTime = Date.now() - startTime;
      console.log(`[${new Date().toISOString()}] All tests passed in ${executionTime}ms`);

      return {
        statusCode: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          success: true,
          testResults,
          message: 'All MetaAPI token tests passed successfully!',
          token: {
            generated: true,
            prefix: narrowedToken.substring(0, 20) + '...',
            length: narrowedToken.length
          }
        }),
      };
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Unexpected error in test execution:`, error);

      addStep(
        testResults,
        'Unexpected Error',
        'error',
        'An unexpected error occurred',
        {
          error: error.message,
          stack: error.stack,
          name: error.name
        }
      );

      return {
        statusCode: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          success: false,
          testResults,
          error: 'Unexpected error occurred',
          details: error.message
        }),
      };
    }
  })();

  // Race between test execution and global timeout
  try {
    return await Promise.race([testExecutionPromise, globalTimeoutPromise]);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Fatal error in test-metaapi-token:`, error);

    addStep(
      testResults,
      'Fatal Error',
      'error',
      'A fatal error occurred',
      {
        error: error.message,
        stack: error.stack,
        name: error.name
      }
    );

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: false,
        testResults,
        error: 'Fatal error occurred',
        details: error.message
      }),
    };
  }
};
