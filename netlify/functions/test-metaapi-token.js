// netlify/functions/test-metaapi-token.js
// Comprehensive test function for MetaAPI token generation and account verification

const {
  initializeMetaApiSDK,
  createMetaApiClient,
  generateNarrowedToken,
  verifyAccount,
  getSDKInfo
} = require('./metaapi-utils');

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

  try {
    const body = JSON.parse(event.body || '{}');
    const { testAdminToken, testAccountId } = body;

    // Use provided tokens or fall back to environment variables
    const adminToken = testAdminToken || process.env.METAAPI_ADMIN_TOKEN;
    const accountId = testAccountId || process.env.VITE_METAAPI_ACCOUNT_ID;
    const region = process.env.VITE_METAAPI_REGION || 'new-york';

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

    // Step 4: Generate narrowed token
    addStep(
      testResults,
      '4. Generate Token',
      'running',
      'Generating narrowed token for account...'
    );

    let narrowedToken;
    try {
      narrowedToken = await generateNarrowedToken(
        adminToken,
        accountId,
        region,
        1
      );

      addStep(
        testResults,
        '4. Generate Token',
        'success',
        'Token generated successfully',
        {
          tokenLength: narrowedToken.length,
          tokenPrefix: narrowedToken.substring(0, 20) + '...',
          validityHours: 1,
          expiresIn: 3600
        }
      );
    } catch (tokenError) {
      addStep(
        testResults,
        '4. Generate Token',
        'error',
        'Failed to generate token',
        {
          error: tokenError.message,
          stack: tokenError.stack
        }
      );

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

    // Step 5: Verify account with narrowed token
    addStep(
      testResults,
      '5. Verify Account',
      'running',
      'Verifying account access with generated token...'
    );

    try {
      const accountInfo = await verifyAccount(narrowedToken, accountId, region);

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
    console.error('Unexpected error in test-metaapi-token:', error);

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
};
