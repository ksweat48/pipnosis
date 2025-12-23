import { Handler } from '@netlify/functions';

interface SentimentProxyEvent {
  source: 'finnhub' | 'fmp';
  apiKey: string;
}

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const body: SentimentProxyEvent = JSON.parse(event.body || '{}');
    const { source, apiKey } = body;

    if (!apiKey) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'API key required' })
      };
    }

    let url: string;
    let data: any;

    switch (source) {
      case 'finnhub':
        url = `https://finnhub.io/api/v1/news?category=forex&token=${apiKey}`;
        break;

      case 'fmp':
        url = `https://financialmodelingprep.com/api/v3/fmp/articles?page=0&size=10&apikey=${apiKey}`;
        break;

      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid source' })
        };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      data = await response.json();
    } finally {
      clearTimeout(timeoutId);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data })
    };

  } catch (error) {
    console.error('[SentimentProxy] Error:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};
