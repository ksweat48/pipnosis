// Allow MetaAPI SSL even if cert chain is outdated
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders };
  }

  console.info("MetaAPI token generation request received");

  const adminToken = process.env.METAAPI_ADMIN_TOKEN;
  const accountId = process.env.METAAPI_ACCOUNT_ID;
  const region = process.env.METAAPI_REGION || "new-york";

  // Manual safety check (no validator, no supabase)
  if (!adminToken || !accountId) {
    console.error("Missing MetaAPI environment variables");
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing MetaAPI environment variables' })
    };
  }

  try {
    const url = `https://mt-provisioning-api-v1.${region}.metaapi.cloud/users/current/tokens`;

    console.info(`Requesting MetaAPI token from: ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'auth-token': adminToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ accountId })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`MetaAPI returned error:`, errText);
      return {
        statusCode: response.status,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'MetaAPI request failed', details: errText })
      };
    }

    const data = await response.json();
    console.info("✅ MetaAPI token successfully generated");

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(data)
    };

  } catch (err) {
    console.error("❌ Unexpected token generation error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Unexpected MetaAPI token error', details: err.message })
    };
  }
};
