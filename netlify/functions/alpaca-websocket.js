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

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const alpacaKey = process.env.ALPACA_API_KEY;
  const alpacaSecret = process.env.ALPACA_API_SECRET;

  if (!alpacaKey || !alpacaSecret) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Alpaca API credentials not configured',
        message: 'Please set ALPACA_API_KEY and ALPACA_API_SECRET in Netlify environment variables'
      })
    };
  }

  try {
    const alpaca = new Alpaca({
      keyId: alpacaKey,
      secretKey: alpacaSecret,
      paper: true,
      feed: 'iex'
    });

    const supabase = createClient(supabaseUrl, supabaseKey);
    const symbols = JSON.parse(event.body || '{"symbols": ["AAPL", "MSFT", "GOOGL", "AMZN"]}').symbols;

    const stream = alpaca.data_stream_v2;
    const quotes = [];

    stream.onConnect(() => {
      console.log('[Alpaca] Connected to data stream');
      stream.subscribeForQuotes(symbols);
    });

    stream.onStateChange((state) => {
      console.log('[Alpaca] State changed:', state);
    });

    stream.onQuote((quote) => {
      console.log('[Alpaca] Quote received:', quote.Symbol, quote.BidPrice, quote.AskPrice);

      const priceData = {
        symbol: quote.Symbol,
        bid: quote.BidPrice,
        ask: quote.AskPrice,
        timestamp: new Date(quote.Timestamp).toISOString(),
        data_source: 'alpaca'
      };

      supabase
        .from('realtime_prices')
        .insert(priceData)
        .then(({ error }) => {
          if (error) console.error('[Supabase] Insert error:', error);
        });

      quotes.push(priceData);
    });

    stream.onError((error) => {
      console.error('[Alpaca] Stream error:', error);
    });

    await stream.connect();

    setTimeout(async () => {
      await stream.disconnect();
    }, 30000);

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Alpaca stream started',
        symbols,
        quotes: quotes.slice(0, 10)
      })
    };

  } catch (error) {
    console.error('[Alpaca] Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: error.message,
        stack: error.stack
      })
    };
  }
};
