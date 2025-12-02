import { Handler } from '@netlify/functions';
import { getWorkingMetaApiAccount, markAccountFailed, markAccountSuccess } from '../../src/services/metaapi-account-manager';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

interface MetaApiAccount {
  id: string;
  name: string;
  state: string;
  connectionStatus: string;
}

async function verifyMetaApiConnection(): Promise<{ ok: boolean; account?: MetaApiAccount; error?: string }> {
  const token = process.env.METAAPI_TOKEN;
  const accountId = getWorkingMetaApiAccount();

  if (!token) {
    return {
      ok: false,
      error: 'MetaAPI token not configured'
    };
  }

  // Use the Provisioning API (not the Streaming API) to get account information
  const url = `https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/users/current/accounts/${accountId}`;

  try {
    console.log(`[verify-metaapi-account] Checking account ${accountId} via Provisioning API`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'auth-token': token,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[verify-metaapi-account] API error: ${response.status} - ${errorText}`);
      const error = new Error(`MetaAPI HTTP ${response.status}`);
      (error as any).response = { status: response.status };
      markAccountFailed(accountId, error);
      return {
        ok: false,
        error: `MetaAPI returned ${response.status}: ${errorText}`
      };
    }

    const account: MetaApiAccount = await response.json();

    console.log(`[verify-metaapi-account] Account state: ${account.state}, connection: ${account.connectionStatus}`);

    // Mark account success
    markAccountSuccess(accountId);

    const isDeployed = account.state === 'DEPLOYED';
    const isConnected = account.connectionStatus === 'CONNECTED';

    if (!isDeployed) {
      return {
        ok: false,
        error: `Account is not deployed (state: ${account.state})`,
        account
      };
    }

    if (!isConnected) {
      return {
        ok: false,
        error: `Account is not connected (status: ${account.connectionStatus})`,
        account
      };
    }

    return {
      ok: true,
      account
    };

  } catch (error) {
    console.error('[verify-metaapi-account] Error:', error);

    if (error instanceof Error && error.name === 'AbortError') {
      return {
        ok: false,
        error: 'Connection timeout - MetaAPI is not responding'
      };
    }

    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  try {
    console.log('[verify-metaapi-account] Starting verification...');

    const result = await verifyMetaApiConnection();

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('[verify-metaapi-account] Unexpected error:', error);

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : 'Unexpected error during verification'
      })
    };
  }
};
