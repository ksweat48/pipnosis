import { Handler } from '@netlify/functions';
import * as metaApiSdk from 'metaapi.cloud-sdk';

const MetaApi = (metaApiSdk as any).default || (metaApiSdk as any).MetaApi || metaApiSdk;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const handler: Handler = async (event) => {
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

    // Initialize MetaAPI with the provided token
    const metaApi = new MetaApi(token, {
      application: 'Pipnosis',
      domain: `${region || 'new-york'}.agiliumtrade.ai`,
      requestTimeout: 60000,
      connectTimeout: 60000,
    });

    // Get account information
    const account = await metaApi.metatraderAccountApi.getAccount(accountId);

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        account: {
          id: account.id,
          name: account.name,
          state: account.state,
          region: account.region,
          server: account.server,
          platform: account.platform,
          magic: account.magic,
        },
      }),
    };
  } catch (error: any) {
    console.error('MetaAPI account verification error:', error);

    return {
      statusCode: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: false,
        error: error?.message || 'Failed to verify MetaAPI account',
        details: error?.details || null,
      }),
    };
  }
};
