export async function handler(event, context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  try {
    const adminToken = process.env.METAAPI_ADMIN_TOKEN;
    const accountId = process.env.METAAPI_ACCOUNT_ID;
    const region = process.env.METAAPI_REGION || 'new-york';

    if (!adminToken || !accountId) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing required MetaApi environment variables' })
      };
    }

    const url = `https://mt-provisioning-api-v1.${region}.metaapi.cloud/users/current/accounts/${accountId}/token`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'auth-token': adminToken }
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('MetaApi Error:', data);
      return {
        statusCode: response.status,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'MetaApi token request failed', details: data })
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ token: data.token })
    };

  } catch (err) {
    console.error('Fatal server error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal Server Error', details: err.message })
    };
  }
}
