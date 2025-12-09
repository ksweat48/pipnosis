import type { Handler } from '@netlify/functions';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

export const handler: Handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  try {
    const accountId = process.env.METAAPI_ACCOUNT_ID;
    const token = process.env.METAAPI_TOKEN;
    const region = process.env.METAAPI_REGION || 'london';

    if (!accountId || !token) {
      return {
        statusCode: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ok: false,
          error: 'MetaAPI credentials not configured',
          accountId: accountId ? accountId.slice(0, 8) + '...' : 'NOT_SET',
          region,
          timestamp: new Date().toISOString()
        })
      };
    }

    const response = {
      ok: true,
      accountId: accountId.slice(0, 8) + '...',
      region,
      message: 'Single MetaAPI account configured',
      timestamp: new Date().toISOString()
    };

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('[MetaAPI-HealthCheck] Error:', error);

    return {
      statusCode: 500,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      })
    };
  }
};
