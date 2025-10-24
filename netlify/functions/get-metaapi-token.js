import MetaApi from 'metaapi.cloud-sdk';

export async function handler(event, context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  try {
    const adminToken = process.env.METAAPI_ADMIN_TOKEN;
    const accountId = process.env.METAAPI_ACCOUNT_ID;
    const region = process.env.METAAPI_REGION || 'new-york';

    if (!adminToken) {
      console.error('❌ Missing METAAPI_ADMIN_TOKEN in Netlify env');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'METAAPI_ADMIN_TOKEN missing on server' })
      };
    }

    if (!accountId) {
      console.error('❌ Missing METAAPI_ACCOUNT_ID in Netlify env');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'METAAPI_ACCOUNT_ID missing on server' })
      };
    }

    console.log(`Generating MetaAPI token for account: ${accountId} in region: ${region}`);

    const metaApi = new MetaApi(adminToken, { region });

    const result = await metaApi.tokenManagementApi.narrowDownTokenResources({
      accountId
    });

    const token = result.token;

    if (!token) {
      console.error('❌ MetaApi returned no token');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'MetaApi token request failed (no token in response)' })
      };
    }

    console.log(`✅ MetaAPI Temporary Token Generated for account: ${accountId}`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ token })
    };

  } catch (err) {
    console.error('❌ Server error during MetaApi token generation:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal Server Error', details: err.message })
    };
  }
}
