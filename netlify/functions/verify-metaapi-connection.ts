import { Handler } from '@netlify/functions';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

interface AccountInfo {
  id: string;
  name: string;
  type: string;
  login: string;
  platform: string;
  state: string;
  connectionStatus: string;
  region: string;
}

async function getAccountInfo(accountId: string, token: string, region: string): Promise<AccountInfo> {
  const url = `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}`;

  console.log(`[verify-connection] Fetching account info from: ${url}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

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

    console.log(`[verify-connection] Account info response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[verify-connection] Error response:`, errorText);
      throw new Error(`MetaAPI HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log(`[verify-connection] Account info:`, data);

    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Account info request timeout after 10 seconds');
    }
    throw error;
  }
}

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

    const accountInfo = await getAccountInfo(accountId, token, region);

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
      account: {
        id: accountInfo.id,
        name: accountInfo.name,
        type: accountInfo.type,
        login: accountInfo.login,
        platform: accountInfo.platform,
        state: accountInfo.state,
        connectionStatus: accountInfo.connectionStatus
      },
      priceEndpointTest: {
        symbol: testSymbol,
        status: priceTest.status,
        ok: priceTest.ok,
        data: priceTest.data
      },
      issues: [] as string[],
      recommendations: [] as string[]
    };

    if (accountInfo.state !== 'DEPLOYED') {
      diagnostics.issues.push(`Account is in '${accountInfo.state}' state, not 'DEPLOYED'`);
      diagnostics.recommendations.push('Deploy the MetaAPI account to enable market data access');
    }

    if (accountInfo.connectionStatus !== 'CONNECTED') {
      diagnostics.issues.push(`Account connection status is '${accountInfo.connectionStatus}', not 'CONNECTED'`);
      diagnostics.recommendations.push('Ensure the trading account is connected to the broker');
    }

    if (!priceTest.ok) {
      diagnostics.issues.push('Price endpoint test failed');
      diagnostics.recommendations.push('Check account permissions and market data subscription');
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
