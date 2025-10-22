import type { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import MetaApi from 'metaapi.cloud-sdk';

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

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
      body: JSON.stringify({ error: 'Method not allowed. Use POST.' })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { accountId } = body;

    if (!accountId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Missing required parameter: accountId',
          hint: 'Include accountId in request body'
        })
      };
    }

    const adminToken = process.env.METAAPI_ADMIN_TOKEN;
    if (!adminToken) {
      console.error('METAAPI_ADMIN_TOKEN environment variable not set');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Server configuration error',
          message: 'MetaAPI admin token not configured'
        })
      };
    }

    console.log(`Generating temporary token for account: ${accountId}`);

    const metaApi = new MetaApi(adminToken);

    const temporaryToken = await metaApi.tokenManagementApi.narrowDownTokenResources(
      [
        {
          entity: 'account',
          id: accountId
        }
      ],
      1
    );

    console.log(`Successfully generated temporary token for account: ${accountId}`);

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, private'
      },
      body: JSON.stringify({
        token: temporaryToken,
        expiresIn: 3600,
        accountId
      })
    };

  } catch (error) {
    console.error('Error generating MetaAPI token:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to generate token',
        message: errorMessage
      })
    };
  }
};

export { handler };
