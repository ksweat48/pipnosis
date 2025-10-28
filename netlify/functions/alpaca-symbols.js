const Alpaca = require('@alpacahq/alpaca-trade-api');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const alpacaKey = process.env.ALPACA_API_KEY;
  const alpacaSecret = process.env.ALPACA_API_SECRET;

  if (!alpacaKey || !alpacaSecret) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Alpaca API credentials not configured'
      })
    };
  }

  try {
    const alpaca = new Alpaca({
      keyId: alpacaKey,
      secretKey: alpacaSecret,
      paper: true
    });

    const assets = await alpaca.getAssets({
      status: 'active',
      asset_class: 'us_equity'
    });

    const popularSymbols = [
      'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'JPM',
      'V', 'WMT', 'DIS', 'NFLX', 'BA', 'NKE', 'COST', 'INTC'
    ];

    const symbols = assets
      .filter(asset =>
        asset.tradable &&
        asset.fractionable &&
        popularSymbols.includes(asset.symbol)
      )
      .map(asset => ({
        symbol: asset.symbol,
        name: asset.name,
        exchange: asset.exchange,
        tradable: asset.tradable
      }));

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        count: symbols.length,
        symbols
      })
    };

  } catch (error) {
    console.error('[Alpaca] Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: error.message
      })
    };
  }
};
