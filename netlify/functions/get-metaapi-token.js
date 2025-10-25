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

    // ✅ Correct endpoint for narrowing in your SDK
    const response = await metaApi.tokenManagementApi.narrowDownAuthToken({
      application: 'mt-client-api',
      accessRules: [
        {
          application: 'mt-client-api',
          resources: [
            {
              type: 'account',
              id: accountId
            }
          ]
        }
      ]
    });

    const token = response.token;
    console.log('✅ Narrow token successfully generated');

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
