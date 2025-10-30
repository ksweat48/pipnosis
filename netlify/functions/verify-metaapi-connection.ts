import { Handler } from '@netlify/functions';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

async function testPriceEndpoint(symbol: string, accountId: string, token: string, region: string): Promise<any> {
  const url = `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}/symbols/${symbol}/current-price`;

  console.log(`[verify-connection] Testing price endpoint: ${url}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'auth-token': token,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    console.log(`[verify-connection] Price endpoint response status: ${response.status}`);

    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = responseText;
    }

    return {
      status: response.status,
      ok: response.ok,
      data: responseData
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        status: 'timeout',
        ok: false,
        error: 'Request timeout after 8 seconds'
      };
    }
    return {
      status: 'error',
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export const handler: Handler = async (event) => {
  console.log('[verify-connection] Function invoked');

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  try {
    const token = process.env.METAAPI_TOKEN;
    const accountId = process.env.METAAPI_ACCOUNT_ID;
    const region = process.env.METAAPI_REGION || 'new-york';

    console.log('[verify-connection] Environment variables:');
    console.log(`  - Token: ${token ? 'SET (' + token.length + ' chars)' : 'MISSING'}`);
    console.log(`  - Account ID: ${accountId || 'MISSING'}`);
    console.log(`  - Region: ${region}`);

    if (!token || !accountId) {
      throw new Error('MetaAPI credentials not configured');
    }

    const testSymbol = 'EURUSD';
    const priceTest = await testPriceEndpoint(testSymbol, accountId, token, region);

    const diagnostics = {
      timestamp: new Date().toISOString(),
      environment: {
        tokenPresent: !!token,
        tokenLength: token ? token.length : 0,
        accountId: accountId,
        region: region
      },
      priceEndpointTest: {
        symbol: testSymbol,
        status: priceTest.status,
        ok: priceTest.ok,
        data: priceTest.data,
        hasValidPrice: priceTest.ok && priceTest.data?.bid && priceTest.data?.ask
      },
      issues: [] as string[],
      recommendations: [] as string[]
    };

    if (!priceTest.ok) {
      diagnostics.issues.push('Price endpoint test failed');
      diagnostics.recommendations.push('Check MetaAPI account status and market data subscription');
    } else if (!priceTest.data?.bid || !priceTest.data?.ask) {
      diagnostics.issues.push('Price endpoint returned invalid data');
      diagnostics.recommendations.push('Verify account has access to market data');
    }

    const isHealthy = diagnostics.issues.length === 0;

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ok: isHealthy,
        healthy: isHealthy,
        diagnostics
      })
    };

  } catch (error) {
    console.error('[verify-connection] ERROR:', error);

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ok: false,
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorType: error instanceof Error ? error.constructor.name : typeof error
      })
    };
  }
};
