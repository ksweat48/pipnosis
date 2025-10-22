// netlify/functions/verify-metaapi-account.js
// Verifies MetaAPI account access with a given token

const { verifyAccount } = require('./metaapi-utils');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { token, accountId, region } = JSON.parse(event.body || '{}');

    if (!token || !accountId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing token or accountId' }),
      };
    }

    console.log(`Verifying account ${accountId} in ${region || 'new-york'} region`);

    const accountInfo = await verifyAccount(
      token,
      accountId,
      region || 'new-york'
    );

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        account: accountInfo
      }),
    };
  } catch (error) {
    console.error('MetaAPI account verification error:', error);

    return {
      statusCode: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: false,
        error: error.message || 'Failed to verify MetaAPI account',
        details: error.details || null,
      }),
    };
  }
};
