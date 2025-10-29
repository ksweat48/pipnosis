const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

exports.handler = async (event) => {
  console.log('[get-metaapi-token] Function invoked');
  console.log('[get-metaapi-token] HTTP Method:', event.httpMethod);

  if (event.httpMethod === 'OPTIONS') {
    console.log('[get-metaapi-token] Handling OPTIONS preflight request');
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  try {
    const token = process.env.METAAPI_TOKEN;
    console.log('[get-metaapi-token] Token check:', token ? `Found (${token.length} chars)` : 'MISSING');

    if (!token) {
      console.error('[get-metaapi-token] ERROR: MetaAPI token not configured in environment');
      return {
        statusCode: 500,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          success: false,
          error: 'MetaAPI token not configured'
        })
      };
    }

    console.log('[get-metaapi-token] Success: Returning token to client');
    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'Cache-Control': 'private, max-age=3000'
      },
      body: JSON.stringify({
        success: true,
        token: token
      })
    };

  } catch (error) {
    console.error('Error getting MetaAPI token:', error.message);

    return {
      statusCode: 500,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
