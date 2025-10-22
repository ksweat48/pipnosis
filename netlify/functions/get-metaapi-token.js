// netlify/functions/get-metaapi-token.js
// Serverless function that returns a short-lived MetaAPI token using admin token.
// Expects POST JSON body: { accountId: "<account-id>" }

const { generateNarrowedToken } = require('./metaapi-utils');

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

exports.handler = async (event) => {
  try {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: ''
      };
    }

    // Only allow POST
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: corsHeaders,
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
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid JSON body' })
      };
    }

    const { accountId } = body;
    if (!accountId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing accountId in request body' })
      };
    }

    // Get configuration from environment
    const adminToken = process.env.METAAPI_ADMIN_TOKEN;
    if (!adminToken) {
      console.error('METAAPI_ADMIN_TOKEN not configured in environment');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Server misconfiguration: METAAPI_ADMIN_TOKEN missing' })
      };
    }

    const region = process.env.VITE_METAAPI_REGION || 'new-york';
    const validityInHours = 1;

    console.log(`Generating token for account ${accountId} in ${region} region`);

    // Use the utility function to generate the token
    const narrowedToken = await generateNarrowedToken(
      adminToken,
      accountId,
      region,
      validityInHours
    );

    const timeToLive = validityInHours * 60 * 60;

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        token: narrowedToken,
        expiresIn: timeToLive
      })
    };

  } catch (err) {
    console.error('Error in get-metaapi-token:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to generate MetaAPI token',
        detail: err.message
      })
    };
  }
};
