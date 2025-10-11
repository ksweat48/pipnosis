import type { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";

/**
 * Netlify Function to refresh historical candle data
 * 
 * This function allows admin users to trigger a refresh of historical data
 * for specified symbols and timeframes.
 * 
 * Query Parameters:
 * - symbol: Trading symbol (e.g., EURUSD, GBPUSD, XAUUSD)
 * - timeframe: Timeframe (5m, 15m, 1h)
 * - daysBack: Number of days to fetch (default: 3 for refresh)
 * - overwrite: Whether to overwrite existing data (default: true)
 * - adminKey: Secret admin key for authorization
 * 
 * Example:
 * POST /api/refresh-candles?symbol=EURUSD&timeframe=5m&daysBack=3&adminKey=YOUR_SECRET
 */

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed. Use POST.' })
    };
  }

  try {
    // Parse query parameters
    const params = event.queryStringParameters || {};
    const symbol = params.symbol;
    const timeframe = params.timeframe as '5m' | '15m' | '1h' | undefined;
    const daysBack = params.daysBack ? parseInt(params.daysBack) : 3;
    const overwrite = params.overwrite !== 'false';
    const adminKey = params.adminKey;

    // Validate admin key
    const expectedAdminKey = process.env.ADMIN_REFRESH_KEY || 'change-this-secret-key';
    if (!adminKey || adminKey !== expectedAdminKey) {
      return {
        statusCode: 401,
        body: JSON.stringify({ 
          error: 'Unauthorized. Invalid or missing admin key.',
          hint: 'Provide adminKey query parameter'
        })
      };
    }

    // Validate required parameters
    if (!symbol) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Missing required parameter: symbol',
          example: '/api/refresh-candles?symbol=EURUSD&timeframe=5m&adminKey=YOUR_KEY'
        })
      };
    }

    if (!timeframe || !['5m', '15m', '1h'].includes(timeframe)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Invalid or missing timeframe. Must be one of: 5m, 15m, 1h',
          provided: timeframe
        })
      };
    }

    if (daysBack < 1 || daysBack > 365) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'daysBack must be between 1 and 365',
          provided: daysBack
        })
      };
    }

    // Note: This is a placeholder implementation
    // In a real deployment, you would need to:
    // 1. Import the fetchHistoricalCandles function (may need serverless-compatible version)
    // 2. Set up Supabase client with service role key
    // 3. Set up MetaApi with server-side credentials
    
    // For now, return a success response indicating the request was received
    return {
      statusCode: 202,
      body: JSON.stringify({
        status: 'accepted',
        message: 'Refresh request received and queued',
        params: {
          symbol,
          timeframe,
          daysBack,
          overwrite
        },
        note: 'This is a placeholder. Implement the actual fetch logic by importing fetchHistoricalCandles service.',
        implementation: {
          step1: 'Import { fetchHistoricalCandles } from your service',
          step2: 'Call fetchHistoricalCandles({ symbol, timeframe, daysBack, overwrite })',
          step3: 'Return the result to the client'
        }
      })
    };

  } catch (error) {
    console.error('Error in refresh-candles function:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};

export { handler };
