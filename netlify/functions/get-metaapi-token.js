import MetaApi from 'metaapi.cloud-sdk';

export const handler = async () => {
  console.log('MetaAPI token generation request received');

  const adminToken = process.env.METAAPI_ADMIN_TOKEN;
  const accountId = process.env.METAAPI_ACCOUNT_ID;
  const region = process.env.METAAPI_REGION || 'new-york';

  if (!adminToken || !accountId) {
    console.error('Missing required MetaAPI env vars');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing METAAPI_ADMIN_TOKEN or METAAPI_ACCOUNT_ID' })
    };
  }

  try {
    console.log(`Requesting narrow token for account: ${accountId} in region: ${region}`);

    const metaApi = new MetaApi(adminToken, { region });

    const response = await metaApi.tokenManagementApi.narrowDownTokenResources([
      {
        application: 'mt-client-api',
        resources: [
          {
            type: 'account',
            id: accountId,
            permissions: ['read', 'trade']
          }
        ]
      }
    ]);

    const token = response.token;
    console.log('✅ Token successfully generated');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    };

  } catch (error) {
    console.error('❌ Failed to generate MetaAPI token:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to generate MetaAPI token',
        details: error.message
      })
    };
  }
};
