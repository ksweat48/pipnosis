const { createClient } = require('@supabase/supabase-js');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

function getTimeframeMinutes(timeframe) {
  const map = {
    'M1': 1,
    'M5': 5,
    'M15': 15,
    'M30': 30,
    'H1': 60,
    'H4': 240,
    'D1': 1440,
    'W1': 10080
  };
  return map[timeframe] || 15;
}

async function getMetaApiCandles(symbol, timeframe, limit) {
  const token = process.env.METAAPI_TOKEN;
  const accountId = process.env.METAAPI_ACCOUNT_ID;
  const region = process.env.METAAPI_REGION || 'new-york';

  if (!token || !accountId) {
    throw new Error('MetaAPI credentials not configured. Set METAAPI_TOKEN and METAAPI_ACCOUNT_ID');
  }

  const now = new Date();
  const minutesPerCandle = getTimeframeMinutes(timeframe);
  const totalMinutes = limit * minutesPerCandle;

  const startTime = new Date(now.getTime() - (totalMinutes * 60 * 1000));

  if (startTime > now) {
    throw new Error(`Invalid date range: startTime (${startTime.toISOString()}) is in the future`);
  }

  const minDate = new Date('2020-01-01');
  if (startTime < minDate) {
    console.warn(`Requested startTime (${startTime.toISOString()}) is too far back, using ${minDate.toISOString()}`);
    startTime.setTime(minDate.getTime());
  }

  const url = `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}/historical-market-data/symbols/${symbol}/timeframes/${timeframe}/candles?startTime=${startTime.toISOString()}`;

  console.log(`Fetching ${limit} ${timeframe} candles for ${symbol} from MetaAPI (${region})`);
  console.log(`Date range: ${startTime.toISOString()} to ${now.toISOString()}`);
  console.log(`Request URL: ${url}`);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'auth-token': token,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`MetaAPI error for ${symbol} ${timeframe}:`, errorText);

    // Handle 404 specifically - symbol not available for historical data
    if (response.status === 404 || errorText.includes('NotFoundError')) {
      const error = new Error(`Symbol ${symbol} not available for historical data from your broker`);
      error.code = 'SYMBOL_NOT_AVAILABLE';
      error.status = 404;
      throw error;
    }

    throw new Error(`MetaAPI error: ${response.status} - ${errorText}`);
  }

  const candles = await response.json();

  if (!Array.isArray(candles)) {
    throw new Error('Invalid candle data from MetaAPI');
  }

  console.log(`Received ${candles.length} candles from MetaAPI`);

  return candles.slice(-limit).map(candle => ({
    symbol,
    timeframe,
    open_time: candle.time,
    close_time: new Date(new Date(candle.time).getTime() + getTimeframeMinutes(timeframe) * 60000).toISOString(),
    open: parseFloat(candle.open),
    high: parseFloat(candle.high),
    low: parseFloat(candle.low),
    close: parseFloat(candle.close),
    volume: parseFloat(candle.tickVolume || 0)
  }));
}

async function saveCandlesToDatabase(candles) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn('Supabase not configured - skipping database save');
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Save to forex_candles (original table)
  const { error: forexError } = await supabase
    .from('forex_candles')
    .upsert(candles, {
      onConflict: 'symbol,timeframe,open_time',
      ignoreDuplicates: false
    });

  if (forexError) {
    console.error('Failed to save candles to forex_candles:', forexError.message);
  } else {
    console.log(`Saved ${candles.length} candles to forex_candles`);
  }

  // Also save to market_data (for AI scanner)
  const marketDataCandles = candles.map(c => ({
    symbol: c.symbol,
    timeframe: c.timeframe,
    timestamp: c.open_time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume
  }));

  const { error: marketDataError } = await supabase
    .from('market_data')
    .upsert(marketDataCandles, {
      onConflict: 'symbol,timeframe,timestamp',
      ignoreDuplicates: false
    });

  if (marketDataError) {
    console.error('Failed to save candles to market_data:', marketDataError.message);
  } else {
    console.log(`Saved ${marketDataCandles.length} candles to market_data`);
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
    const timeframe = params.get('timeframe') || 'M15';
    const limit = parseInt(params.get('limit') || '100', 10);

    console.log(`Requesting ${limit} ${timeframe} candles for ${symbol}`);

    const candles = await getMetaApiCandles(symbol, timeframe, limit);

    await saveCandlesToDatabase(candles);

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        data: {
          symbol,
          timeframe,
          count: candles.length,
          candles
        }
      })
    };

  } catch (error) {
    console.error('Error fetching candles:', error.message);

    // Return appropriate status code based on error type
    const statusCode = error.status === 404 ? 404 : 500;
    const errorCode = error.code || 'UNKNOWN_ERROR';

    return {
      statusCode,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        errorCode,
        symbol: params.get('symbol'),
        timeframe: params.get('timeframe')
      })
    };
  }
};
