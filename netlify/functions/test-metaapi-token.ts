import { Handler } from '@netlify/functions';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

interface TestStep {
  step: string;
  status: 'pending' | 'running' | 'success' | 'error';
  message: string;
  details?: any;
  timestamp: string;
}

export const handler: Handler = async (event) => {
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

  const testResults: TestStep[] = [];

  function addStep(step: string, status: TestStep['status'], message: string, details?: any) {
    testResults.push({
      step,
      status,
      message,
      details,
      timestamp: new Date().toISOString()
    });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { testAdminToken, testAccountId } = body;

    // Use provided tokens or fall back to environment variables
    const adminToken = testAdminToken || process.env.METAAPI_ADMIN_TOKEN;
    const accountId = testAccountId || process.env.VITE_METAAPI_ACCOUNT_ID;
    const region = process.env.VITE_METAAPI_REGION || 'new-york';

    // Step 1: Check environment variables
    addStep(
      '1. Environment Check',
      'running',
      'Checking environment variables...'
    );

    if (!adminToken) {
      addStep(
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
        envVarSource: testAdminToken ? 'provided' : 'environment'
      }
    );

    // Step 2: Import MetaAPI SDK
    addStep(
      '2. SDK Import',
      'running',
      'Importing MetaAPI SDK...'
    );

    let MetaApi;
    try {
      // Import MetaApi using named import pattern (matches src/services/metaapi.ts)
      const metaApiModule = await import('metaapi.cloud-sdk');

      // Try to extract MetaApi - it may be exported as default or named export
      MetaApi = metaApiModule.default || metaApiModule.MetaApi || (metaApiModule as any).default;

      if (!MetaApi || typeof MetaApi !== 'function') {
        // If still not found, log available exports for debugging
        const availableExports = Object.keys(metaApiModule).filter(key =>
          typeof (metaApiModule as any)[key] === 'function'
        );

        addStep(
          '2. SDK Import',
          'error',
          'MetaApi constructor not found in module exports',
          {
            defaultType: typeof metaApiModule.default,
            hasMetaApiNamed: 'MetaApi' in metaApiModule,
            availableFunctions: availableExports,
            moduleKeys: Object.keys(metaApiModule).slice(0, 20)
          }
        );

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            testResults,
            error: 'MetaApi constructor not found'
          })
        };
      }

      addStep(
        '2. SDK Import',
        'success',
        'MetaAPI SDK imported successfully',
        {
          constructorFound: true,
          constructorType: typeof MetaApi,
          constructorName: MetaApi.name
        }
      );
    } catch (importError: any) {
      addStep(
        '2. SDK Import',
        'error',
        'Failed to import MetaAPI SDK',
        {
          error: importError.message,
          stack: importError.stack
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
      '3. Initialize Client',
      'running',
      'Initializing MetaAPI client...'
    );

    let metaApi;
    try {
      metaApi = new MetaApi(adminToken, {
        application: 'Pipnosis',
        domain: `${region}.agiliumtrade.ai`,
        requestTimeout: 60000,
        connectTimeout: 60000,
      });

      addStep(
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
    } catch (initError: any) {
      addStep(
        '3. Initialize Client',
        'error',
        'Failed to initialize MetaAPI client',
        {
          error: initError.message,
          stack: initError.stack,
          metaApiType: typeof MetaApi,
          isConstructor: typeof MetaApi === 'function'
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
      '4. Generate Token',
      'running',
      'Generating narrowed token for account...'
    );

    let narrowedToken;
    try {
      const validityInHours = 1;

      narrowedToken = await metaApi.tokenManagementApi.narrowDownToken({
        applications: [
          'trading-account-management-api',
          'metaapi-rest-api',
          'metaapi-rpc-api',
          'metaapi-real-time-streaming-api',
          'metastats-api',
          'risk-management-api'
        ],
        roles: ['reader', 'writer'],
        resources: [{ entity: 'account', id: accountId }]
      }, validityInHours);

      if (!narrowedToken || typeof narrowedToken !== 'string') {
        addStep(
          '4. Generate Token',
          'error',
          'Token generated but invalid format',
          {
            tokenType: typeof narrowedToken,
            tokenValue: narrowedToken
          }
        );

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            testResults,
            error: 'Invalid token format'
          })
        };
      }

      addStep(
        '4. Generate Token',
        'success',
        'Token generated successfully',
        {
          tokenLength: narrowedToken.length,
          tokenPrefix: narrowedToken.substring(0, 20) + '...',
          validityHours: validityInHours,
          expiresIn: validityInHours * 3600
        }
      );
    } catch (tokenError: any) {
      addStep(
        '4. Generate Token',
        'error',
        'Failed to generate token',
        {
          error: tokenError.message,
          stack: tokenError.stack,
          statusCode: tokenError.status || tokenError.statusCode,
          response: tokenError.response?.data || null
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
      '5. Verify Account',
      'running',
      'Verifying account access with generated token...'
    );

    try {
      const verifyMetaApi = new MetaApi(narrowedToken, {
        application: 'Pipnosis',
        domain: `${region}.agiliumtrade.ai`,
        requestTimeout: 60000,
        connectTimeout: 60000,
      });

      const account = await verifyMetaApi.metatraderAccountApi.getAccount(accountId);

      addStep(
        '5. Verify Account',
        'success',
        'Account verified successfully',
        {
          accountId: account.id,
          accountName: account.name,
          state: account.state,
          region: account.region,
          server: account.server,
          platform: account.platform,
          magic: account.magic,
          connectionStatus: account.connectionStatus
        }
      );
    } catch (verifyError: any) {
      addStep(
        '5. Verify Account',
        'error',
        'Failed to verify account',
        {
          error: verifyError.message,
          stack: verifyError.stack,
          statusCode: verifyError.status || verifyError.statusCode,
          response: verifyError.response?.data || null
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
          prefix: narrowedToken!.substring(0, 20) + '...',
          length: narrowedToken!.length
        }
      }),
    };
  } catch (error: any) {
    console.error('Unexpected error in test-metaapi-token:', error);

    addStep(
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
