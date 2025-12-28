import { Handler } from '@netlify/functions';

interface SentimentProxyEvent {
  source: 'finnhub' | 'fmp' | 'feargreed' | 'coingecko' | 'reddit' | 'newsapi' | 'alphavantage';
  apiKey?: string;
  redditUrl?: string;
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
    const { source, apiKey, redditUrl } = body;

    // Get API keys from environment (secure server-side storage)
    const finnhubKey = process.env.FINNHUB_API_KEY;
    const fmpKey = apiKey || process.env.FMP_API_KEY;
    const newsApiKey = process.env.NEWSAPI_KEY;
    const alphaVantageKey = process.env.ALPHA_VANTAGE_KEY;

    let url: string;
    let data: any;
    let fetchOptions: RequestInit = {};

    switch (source) {
      case 'finnhub':
        if (!finnhubKey) {
          console.warn('[SentimentProxy] Missing FINNHUB_API_KEY');
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
              success: false,
              error: 'Finnhub API key not configured',
              source: 'finnhub'
            })
          };
        }
        url = `https://finnhub.io/api/v1/news?category=forex&token=${finnhubKey}`;
        break;

      case 'fmp':
        if (!fmpKey) {
          console.warn('[SentimentProxy] Missing FMP_API_KEY');
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
              success: false,
              error: 'FMP API key not configured',
              source: 'fmp'
            })
          };
        }
        // Fixed FMP endpoint - using general news instead of articles
        url = `https://financialmodelingprep.com/api/v3/stock_news?limit=10&apikey=${fmpKey}`;
        break;

      case 'feargreed':
        url = 'https://api.alternative.me/fng/?limit=1';
        break;

      case 'coingecko':
        url = 'https://api.coingecko.com/api/v3/search/trending';
        break;

      case 'reddit':
        if (!redditUrl) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Reddit URL required' })
          };
        }
        url = redditUrl;
        // Add User-Agent to avoid Reddit blocking
        fetchOptions = {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; PipnosisBot/1.0)'
          }
        };
        break;

      case 'newsapi':
        if (!newsApiKey) {
          console.warn('[SentimentProxy] Missing NEWSAPI_KEY');
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
              success: false,
              error: 'NewsAPI key not configured',
              source: 'newsapi'
            })
          };
        }
        // Get top business headlines (free tier: 100 req/day)
        url = `https://newsapi.org/v2/top-headlines?category=business&language=en&pageSize=10&apiKey=${newsApiKey}`;
        break;

      case 'alphavantage':
        if (!alphaVantageKey) {
          console.warn('[SentimentProxy] Missing ALPHA_VANTAGE_KEY');
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
              success: false,
              error: 'Alpha Vantage key not configured',
              source: 'alphavantage'
            })
          };
        }
        // Get market news and sentiment (free tier: 25 req/day)
        url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&topics=finance,forex&apikey=${alphaVantageKey}`;
        break;

      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid source' })
        };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal
      });

      if (!response.ok) {
        console.error(`[SentimentProxy] ${source} returned ${response.status}`);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      data = await response.json();

      console.log(`[SentimentProxy] ✓ ${source} fetch successful`);

    } finally {
      clearTimeout(timeoutId);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data })
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const parsedBody = event.body ? JSON.parse(event.body) : {};

    console.error('[SentimentProxy] Error:', {
      source: parsedBody.source,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined
    });

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: errorMessage,
        source: parsedBody.source
      })
    };
  }
};
