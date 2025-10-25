import MetaApi from 'metaapi.cloud-sdk';

export const handler = async () => {
  console.log('Starting MetaAPI token test...');

  const adminToken = process.env.METAAPI_ADMIN_TOKEN;
  const accountId = process.env.METAAPI_ACCOUNT_ID;
  const region = process.env.METAAPI_REGION || 'new-york';

  if (!adminToken || !accountId) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing METAAPI_ADMIN_TOKEN or METAAPI_ACCOUNT_ID' })
    };
  }

  try {
    const metaApi = new MetaApi(adminToken, { region });

    // ✅ Step 1: generate narrowed token
    const narrowToken = await metaApi.tokenManagementApi.createNarrowAccessToken({
      application: 'mt-client-api',
      resources: [{ type: 'account', id: accountId }]
    });

    // ✅ Step 2: verify account using the returned token
    const mtClient = new MetaApi(narrowToken, { region });
    const accountInfo = await mtClient.metatraderAccountApi.getAccount(accountId);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        tokenPreview: narrowToken.substring(0, 25) + '...',
        accountVerified: true,
        accountName: accountInfo.name,
        connectionStatus: accountInfo.connectionStatus,
        server: accountInfo.server,
        region
      })
    };

  } catch (err) {
    console.error('❌ Token test failed:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
