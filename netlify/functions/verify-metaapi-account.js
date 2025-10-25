/* eslint-disable no-console */
const MetaApi = require('metaapi.cloud-sdk');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors };
  }

  try {
    const adminToken = process.env.METAAPI_ADMIN_TOKEN;
    const accountId  = process.env.METAAPI_ACCOUNT_ID;
    const region     = process.env.METAAPI_REGION || 'new-york';

    if (!adminToken || !accountId) {
      return {
        statusCode: 500,
        headers: cors,
        body: JSON.stringify({ error: 'Missing METAAPI_ADMIN_TOKEN or METAAPI_ACCOUNT_ID' })
      };
    }

    const metaapi = new MetaApi(adminToken, { region });
    const account = await metaapi.metatraderAccountApi.getAccount(accountId);

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        id: account.id,
        name: account.name,
        platform: account.platform,
        server: account.server,
        region: account.region,
        state: account.state,
        connectionStatus: account.connectionStatus
      })
    };
  } catch (err) {
    console.error('verify-metaapi-account failed:', err);
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err.message })
    };
  }
};
