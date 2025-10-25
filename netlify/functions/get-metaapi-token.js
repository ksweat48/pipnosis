// netlify/functions/get-metaapi-token.js
/* eslint-disable no-console */
const MetaApi = require('metaapi.cloud-sdk');

function listMethods(obj) {
  if (!obj) return [];
  const proto = Object.getPrototypeOf(obj);
  return Object.getOwnPropertyNames(proto)
    .filter((k) => typeof obj[k] === 'function' && k !== 'constructor')
    .sort();
}

async function tryNarrowDownToken(metaApi, accountId) {
  const tma = metaApi.tokenManagementApi;
  if (!tma) throw new Error('tokenManagementApi is not available on MetaAPI client');

  // Log available methods to the function logs so we see what this SDK actually has
  const methods = listMethods(tma);
  console.log('[tokenManagementApi] available methods:', methods);

  // We will try a small sequence of payload shapes that match server error hints
  const attempts = [];

  // Attempt A: modern array shape with accessRules, resources use `entity` (NOT `type`)
  attempts.push({
    label: 'A.accessRules[...].resources[{ entity:"account", id }]',
    call: () => tma.narrowDownTokenResources([
      {
        application: 'trading-account-management-api',
        accessRules: [
          {
            resources: [{ entity: 'account', id: accountId }],
          },
        ],
      },
    ]),
  });

  // Attempt B: same but app = mt-client-api (some accounts require this app name)
  attempts.push({
    label: 'B.accessRules[...] (application: "mt-client-api")',
    call: () => tma.narrowDownTokenResources([
      {
        application: 'mt-client-api',
        accessRules: [
          {
            resources: [{ entity: 'account', id: accountId }],
          },
        ],
      },
    ]),
  });

  // Attempt C: legacy minimal—SDKs used to accept just accountId object
  attempts.push({
    label: 'C.legacy object { accountId }',
    call: () => tma.narrowDownTokenResources({ accountId }),
  });

  // If `narrowToken` exists in your SDK, try the simple object style there too
  if (typeof tma.narrowToken === 'function') {
    attempts.push({
      label: 'D.narrowToken({ application:"mt-client-api", resources:[{ entity:"account", id }] })',
      call: () => tma.narrowToken({
        application: 'mt-client-api',
        resources: [{ entity: 'account', id: accountId }],
      }),
    });
    attempts.push({
      label: 'E.narrowToken({ application:"trading-account-management-api", resources:[{ entity:"account", id }] })',
      call: () => tma.narrowToken({
        application: 'trading-account-management-api',
        resources: [{ entity: 'account', id: accountId }],
      }),
    });
  }

  let lastErr;
  for (const attempt of attempts) {
    try {
      console.log('→ Trying payload:', attempt.label);
      const res = await attempt.call();
      if (res && res.token) {
        console.log('✓ Token generated with', attempt.label);
        return res.token;
      }
      // Some SDKs return string token directly
      if (typeof res === 'string') {
        console.log('✓ Token (string) generated with', attempt.label);
        return res;
      }
      console.log('⚠️ Attempt returned no token field, moving on…');
    } catch (e) {
      lastErr = e;
      // Surface server validation details if present
      if (e && e.details) console.error('Server details:', e.details);
      console.error(`✗ Attempt failed (${attempt.label}):`, e.message || e);
    }
  }

  throw lastErr || new Error('All token narrowing attempts failed');
}

exports.handler = async () => {
  console.log('MetaAPI token generation request received');

  const adminToken = process.env.METAAPI_ADMIN_TOKEN;
  const accountId = process.env.METAAPI_ACCOUNT_ID;
  const region = process.env.METAAPI_REGION || 'new-york';

  if (!adminToken || !accountId) {
    console.error('Missing required MetaAPI env vars');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing METAAPI_ADMIN_TOKEN or METAAPI_ACCOUNT_ID' }),
    };
  }

  try {
    console.log(`Requesting narrow token for account: ${accountId} in region: ${region}`);

    const metaApi = new MetaApi(adminToken, { region });

    // Dump top-level client capabilities once
    const top = Object.keys(metaApi).sort();
    console.log('[MetaApi client] keys:', top);

    const token = await tryNarrowDownToken(metaApi, accountId);

    console.log('✅ Token successfully generated');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    };
  } catch (error) {
    console.error('❌ Failed to generate MetaAPI token:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to generate MetaAPI token',
        details: error.message,
      }),
    };
  }
};
