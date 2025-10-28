const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  try {
    const token = process.env.METAAPI_TOKEN;

    if (!token) {
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
