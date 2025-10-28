const Alpaca = require('@alpacahq/alpaca-trade-api');
const { createClient } = require('@supabase/supabase-js');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const alpacaKey = process.env.ALPACA_API_KEY;
  const alpacaSecret = process.env.ALPACA_API_SECRET;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!alpacaKey || !alpacaSecret) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Alpaca API credentials not configured',
        message: 'Please set ALPACA_API_KEY and ALPACA_API_SECRET'
      })
    };
  }

  try {
    const params = event.queryStringParameters || {};
    const symbol = params.symbol || 'AAPL';
    const timeframe = params.timeframe || '5Min';
    const limit = parseInt(params.limit || '100');

    const alpaca = new Alpaca({
      keyId: alpacaKey,
      secretKey: alpacaSecret,
      paper: true,
      feed: 'iex'
    });

    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);

    console.log(`[Alpaca] Fetching ${symbol} bars - ${timeframe} - ${start} to ${end}`);

    const bars = await alpaca.getBarsV2(symbol, {
      start: start.toISOString(),
      end: end.toISOString(),
      timeframe: timeframe,
      limit: limit
    });

    const candles = [];
    for await (let bar of bars) {
      candles.push({
        symbol: symbol,
        timestamp: new Date(bar.Timestamp).toISOString(),
        open: bar.OpenPrice,
        high: bar.HighPrice,
        low: bar.LowPrice,
        close: bar.ClosePrice,
        volume: bar.Volume,
        timeframe: timeframe.toLowerCase(),
        data_source: 'alpaca'
      });
    }

    if (candles.length > 0 && supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { error } = await supabase
        .from('market_data')
        .upsert(candles, { onConflict: 'symbol,timestamp,timeframe' });

      if (error) {
        console.error('[Supabase] Insert error:', error);
      } else {
        console.log(`[Supabase] Stored ${candles.length} candles for ${symbol}`);
      }
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        symbol,
        timeframe,
        count: candles.length,
        candles: candles
      })
    };

  } catch (error) {
    console.error('[Alpaca] Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: error.message,
        details: error.toString()
      })
    };
  }
};
