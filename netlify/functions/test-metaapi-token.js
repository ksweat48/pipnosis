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
      const accountId = testAccountId || process.env.METAAPI_ACCOUNT_ID;
      const region = process.env.METAAPI_REGION || 'new-york';
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE;

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

          // Check if cache table exists and is accessible
          const { data: cacheData, error: cacheError } = await supabase
            .from('metaapi_token_cache')
            .select('id, account_id, expires_at, is_valid, created_at')
            .limit(10);

          if (cacheError) {
            addStep(
              testResults,
              '0. Cache Configuration',
              'error',
              'Cache table accessible but query failed',
              {
                error: cacheError.message,
                code: cacheError.code,
                hasServiceKey: !!supabaseServiceKey,
                hint: 'Check RLS policies and service role permissions'
              }
            );
          } else {
            // Check for existing cached tokens for this account
            const { data: accountTokens, error: accountError } = await supabase
              .from('metaapi_token_cache')
              .select('*')
              .eq('account_id', accountId)
              .eq('region', region)
              .order('expires_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            const now = new Date();
            let tokenStatus = 'No cached token for this account';
            let tokenExpired = false;
            let tokenAge = null;

            if (accountTokens && !accountError) {
              const expiresAt = new Date(accountTokens.expires_at);
              const createdAt = new Date(accountTokens.created_at);
              tokenAge = Math.round((now - createdAt) / 1000 / 60);
              tokenExpired = expiresAt < now;

              if (tokenExpired) {
                const expiredMinutes = Math.round((now - expiresAt) / 1000 / 60);
                tokenStatus = `Cached token EXPIRED ${expiredMinutes} minutes ago`;
              } else {
                const expiresInMinutes = Math.round((expiresAt - now) / 1000 / 60);
                tokenStatus = `Valid cached token found (expires in ${expiresInMinutes} minutes)`;
              }
            }

            cacheHealthy = true;
            addStep(
              testResults,
              '0. Cache Configuration',
              'success',
              'Token cache is properly configured and accessible',
              {
                cacheEnabled: true,
                cacheHealthy: true,
                totalCachedTokens: cacheData ? cacheData.length : 0,
                accountTokenStatus: tokenStatus,
                tokenExpired,
                tokenAgeMinutes: tokenAge,
                accountId,
                region,
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
            hasEnvAccountId: !!process.env.METAAPI_ACCOUNT_ID,
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

      // Step 4: Generate narrowed token with cache-first approach
      let tokenMessage = 'Checking for cached token...';
      if (cacheHealthy) {
        tokenMessage = 'Checking cache, will generate fresh token if needed (14-second timeout, no retries)...';
      } else {
        tokenMessage = 'Generating token (WARNING: caching disabled - this will be slow)...';
      }

      addStep(
        testResults,
        '4. Generate Token',
        'running',
        tokenMessage
      );

      let tokenResult;
      try {
        console.log(`[${new Date().toISOString()}] Starting token generation with cache-first approach...`);
        console.log(`[${new Date().toISOString()}] Timeout: 14 seconds per attempt, 1 total attempt (no retries)`);

        tokenResult = await generateNarrowedToken(
          adminToken,
          accountId,
          region,
          1
        );
        console.log(`[${new Date().toISOString()}] Token retrieval completed successfully`);

        const generationTime = Date.now() - startTime;
        const sourceDescription = tokenResult.source === 'cache'
          ? 'Retrieved from cache (< 100ms)'
          : tokenResult.source === 'fallback'
          ? 'Emergency fallback token used'
          : 'Generated fresh token and cached';

        addStep(
          testResults,
          '4. Generate Token',
          'success',
          sourceDescription,
          {
            tokenLength: tokenResult.token.length,
            tokenPrefix: tokenResult.token.substring(0, 20) + '...',
            source: tokenResult.source,
            expiresAt: tokenResult.expiresAt,
            generationTime: `${generationTime}ms`,
            cached: tokenResult.cached,
            warning: tokenResult.warning || null,
            note: tokenResult.source === 'cache'
              ? 'Token retrieved from cache - very fast'
              : tokenResult.source === 'fallback'
              ? 'Using fallback token - MetaAPI may be experiencing issues'
              : 'Fresh token generated and cached for future use'
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
          errorDetails.troubleshooting.push('Function timeout increased to 14 seconds with no retries');
          errorDetails.troubleshooting.push('Try again in a few minutes when server load decreases');
          errorDetails.troubleshooting.push('Emergency fallback attempted but no cached token available');
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
        } else if (tokenError.message.includes('not a function')) {
          errorDetails.troubleshooting.push('MetaAPI SDK method issue - narrowDownTokenResources may not be available');
          errorDetails.troubleshooting.push('Check MetaAPI SDK version in package.json');
          errorDetails.troubleshooting.push('SDK version should be v6+ for narrowDownTokenResources support');
        }

        addStep(
          testResults,
          '4. Generate Token',
          'error',
          'Failed to generate token (single attempt with 14s timeout)',
          errorDetails
        );

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            testResults,
            error: 'Token generation failed',
            details: tokenError.message
          })
        };
      }

      // Step 5: Verify account with token
      addStep(
        testResults,
        '5. Verify Account',
        'running',
        'Verifying account access with token...'
      );

      try {
        console.log(`[${new Date().toISOString()}] Starting account verification...`);
        const accountInfo = await verifyAccount(tokenResult.token, accountId, region);
        console.log(`[${new Date().toISOString()}] Account verification completed`);

        addStep(
          testResults,
          '5. Verify Account',
          'success',
          'Account verified successfully',
          {
            ...accountInfo,
            tokenSource: tokenResult.source
          }
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
            source: tokenResult.source,
            prefix: tokenResult.token.substring(0, 20) + '...',
            length: tokenResult.token.length,
            expiresAt: tokenResult.expiresAt,
            cached: tokenResult.cached,
            warning: tokenResult.warning || null
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
