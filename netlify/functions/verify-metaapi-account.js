// verify-metaapi-account.js (CommonJS)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function resolveMetaApiCtor() {
  try {
    const m = require('metaapi.cloud-sdk');
    return m.default || m.MetaApi || m;
  } catch (e) {
    throw new Error('MetaApi SDK is not installed or could not be required');
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  const adminToken = process.env.METAAPI_ADMIN_TOKEN;
  const accountId  = process.env.METAAPI_ACCOUNT_ID || process.env.VITE_METAAPI_ACCOUNT_ID;
  const region     = process.env.METAAPI_REGION || process.env.VITE_METAAPI_REGION || 'london';

  if (!adminToken || !accountId) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing METAAPI_ADMIN_TOKEN or METAAPI_ACCOUNT_ID' })
    };
  }

  try {
    const MetaApi = resolveMetaApiCtor();
    const metaApi = new MetaApi(adminToken, { region });
    const account = await metaApi.metatraderAccountApi.getAccount(accountId);

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        id: account.id,
        name: account.name,
        state: account.state,
        region: account.region,
        server: account.server,
        platform: account.platform,
        connectionStatus: account.connectionStatus
      })
    };
  } catch (err) {
    console.error('verify-metaapi-account failed:', err);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err.message })
    };
  }
};
