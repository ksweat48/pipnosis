const { createClient } = require('@supabase/supabase-js');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

async function getMetaApiPrice(symbol) {
  const token = process.env.METAAPI_TOKEN;
  const accountId = process.env.METAAPI_ACCOUNT_ID;
  const region = process.env.METAAPI_REGION || 'new-york';

  if (!token || !accountId) {
    throw new Error('MetaAPI credentials not configured. Set METAAPI_TOKEN and METAAPI_ACCOUNT_ID');
  }

  const url = `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}/symbols/${symbol}/current-price`;

  console.log(`Fetching price for ${symbol} from MetaAPI (${region})`);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'auth-token': token,
      'Content-Type': 'application/json'
    },
    timeout: 10000
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MetaAPI error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  if (!data.bid || !data.ask) {
    throw new Error('Invalid price data from MetaAPI');
  }

  return {
    symbol,
    bid: parseFloat(data.bid),
    ask: parseFloat(data.ask),
    timestamp: data.time || new Date().toISOString()
  };
}

async function savePriceToDatabase(priceData) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn('Supabase not configured - skipping database save');
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { error } = await supabase
    .from('forex_live_prices')
    .insert({
      symbol: priceData.symbol,
      bid: priceData.bid,
      ask: priceData.ask,
      timestamp: priceData.timestamp
    });

  if (error) {
    console.error('Failed to save price to database:', error.message);
  } else {
    console.log(`Saved ${priceData.symbol} price to database`);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  try {
    const params = new URLSearchParams(event.rawUrl.split('?')[1]);
    const symbol = params.get('symbol') || 'EURUSD';

    console.log(`Requesting price for ${symbol}`);

    const priceData = await getMetaApiPrice(symbol);

    await savePriceToDatabase(priceData);

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        data: priceData
      })
    };

  } catch (error) {
    console.error('Error fetching price:', error.message);

    return {
      statusCode: 500,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
