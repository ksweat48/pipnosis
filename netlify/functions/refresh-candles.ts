import type { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { refreshSingleSymbol, refreshBatchSchedules } from '../../src/services/refresh-service';

/**
 * Netlify Function to refresh historical candle data
 *
 * This function allows admin users to trigger a refresh of historical data
 * for specified symbols and timeframes, or batch refresh all active schedules.
 *
 * Query Parameters:
 * - mode: 'single' (default) or 'batch'
 *
 * Single Mode Parameters:
 * - symbol: Trading symbol (e.g., EURUSD, GBPUSD, XAUUSD)
 * - timeframe: Timeframe (5m, 15m, 1h)
 * - daysBack: Number of days to fetch (default: 3)
 * - overwrite: Whether to overwrite existing data (default: true)
 * - adminKey: Secret admin key for authorization
 *
 * Batch Mode Parameters:
 * - adminKey: Secret admin key for authorization
 *
 * Examples:
 * Single: POST /.netlify/functions/refresh-candles?symbol=EURUSD&timeframe=5m&daysBack=3&adminKey=YOUR_SECRET
 * Batch:  POST /.netlify/functions/refresh-candles?mode=batch&adminKey=YOUR_SECRET
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
    const adminKey = params.adminKey;
    const mode = params.mode || 'single';

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

    // Handle batch mode
    if (mode === 'batch') {
      console.log('Processing batch refresh request...');

      const result = await refreshBatchSchedules();

      return {
        statusCode: 200,
        body: JSON.stringify({
          status: 'completed',
          mode: 'batch',
          totalSchedules: result.totalSchedules,
          successful: result.successful,
          failed: result.failed,
          duration: result.duration,
          results: result.results,
          message: `Batch refresh completed: ${result.successful} successful, ${result.failed} failed`
        })
      };
    }

    // Handle single mode
    const symbol = params.symbol;
    const timeframe = params.timeframe as '5m' | '15m' | '1h' | undefined;
    const daysBack = params.daysBack ? parseInt(params.daysBack) : 3;
    const overwrite = params.overwrite !== 'false';

    // Validate required parameters for single mode
    if (!symbol) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Missing required parameter: symbol',
          example: '/.netlify/functions/refresh-candles?symbol=EURUSD&timeframe=5m&adminKey=YOUR_KEY'
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

    console.log(`Processing single refresh: ${symbol} ${timeframe} (${daysBack} days)`);

    // Perform single refresh
    const result = await refreshSingleSymbol({
      symbol,
      timeframe,
      daysBack,
      overwrite
    });

    if (result.success) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          status: 'completed',
          mode: 'single',
          symbol: result.symbol,
          timeframe: result.timeframe,
          candlesFetched: result.candlesFetched,
          candlesSaved: result.candlesSaved,
          duration: result.duration,
          message: `Successfully refreshed ${result.candlesSaved} candles`
        })
      };
    } else {
      return {
        statusCode: 500,
        body: JSON.stringify({
          status: 'failed',
          mode: 'single',
          symbol: result.symbol,
          timeframe: result.timeframe,
          error: result.error,
          message: 'Refresh failed'
        })
      };
    }

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
