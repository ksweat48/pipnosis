// netlify/functions/get-metaapi-token.js
// Serverless function that returns a short-lived MetaAPI token using admin token.
// Expects POST JSON body: { accountId: "<account-id>" }

const metaApiSdk = require('metaapi.cloud-sdk');
const MetaApi = metaApiSdk.default || metaApiSdk.MetaApi || metaApiSdk;

exports.handler = async (event) => {
  try {
    // Only allow POST
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Method Not Allowed. Use POST.' })
      };
    }

    // Parse body
    let body = {};
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch (err) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid JSON body' })
      };
    }

    const { accountId } = body;
    if (!accountId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing accountId in request body' })
      };
    }

    // OPTIONAL: Basic auth guard (recommended) - uncomment to enable
    // const authHeader = event.headers?.authorization || event.headers?.Authorization;
    // if (!authHeader || !authHeader.startsWith('Bearer ')) {
    //   return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
    // }
    // const tokenFromClient = authHeader.split(' ')[1];
    // validate tokenFromClient against your auth system (Supabase/JWT) here.

    // Must have METAAPI_ADMIN_TOKEN in environment variables
    const adminToken = process.env.METAAPI_ADMIN_TOKEN;
    if (!adminToken) {
      console.error('METAAPI_ADMIN_TOKEN not configured in environment');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Server misconfiguration: METAAPI_ADMIN_TOKEN missing' })
      };
    }

    // Create MetaApi client with admin token (server-side only)
    const region = process.env.VITE_METAAPI_REGION || 'new-york';
    const metaApi = new MetaApi(adminToken, {
      application: 'Pipnosis',
      domain: `${region}.agiliumtrade.ai`,
      requestTimeout: 60000,
      connectTimeout: 60000,
    });

    // Generate narrowed down token using Token Management API
    // Token is restricted to specific account and necessary applications
    const validityInHours = 1; // 1 hour validity
    const timeToLive = validityInHours * 60 * 60; // Convert to seconds

    let narrowedToken;
    try {
      narrowedToken = await metaApi.tokenManagementApi.narrowDownToken({
        applications: [
          'trading-account-management-api',
          'metaapi-rest-api',
          'metaapi-rpc-api',
          'metaapi-real-time-streaming-api',
          'metastats-api',
          'risk-management-api'
        ],
        roles: ['reader', 'writer'],
        resources: [{ entity: 'account', id: accountId }]
      }, validityInHours);
    } catch (err) {
      console.error('MetaAPI token generation error:', err && err.message ? err.message : err);
      // If MetaAPI returns a structured error object, include limited info
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to generate MetaAPI token', detail: err && err.message ? err.message : String(err) })
      };
    }

    if (!narrowedToken || typeof narrowedToken !== 'string') {
      console.error('MetaAPI returned invalid token:', narrowedToken);
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'MetaAPI returned invalid token' })
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        // Allow CORS if necessary; tighten in production (set to your front-end domain)
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: JSON.stringify({ token: narrowedToken, expiresIn: timeToLive })
    };
  } catch (err) {
    console.error('Unexpected error in get-metaapi-token:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal Server Error' })
    };
  }
};
