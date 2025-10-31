import type { Handler } from '@netlify/functions';

const WATCHLIST_SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD'];
const TIMEFRAME = 'M15';
const CANDLE_LIMIT = 100;

export const handler: Handler = async (event, context) => {
  console.log('[Auto Fetch] Starting automated candle fetch...');

  const results = [];

  for (const symbol of WATCHLIST_SYMBOLS) {
    try {
      console.log(`[Auto Fetch] Fetching candles for ${symbol}...`);

      const forexCandlesUrl = `${process.env.URL}/.netlify/functions/forex-candles?symbol=${symbol}&timeframe=${TIMEFRAME}&limit=${CANDLE_LIMIT}`;

      const response = await fetch(forexCandlesUrl);

      if (!response.ok) {
        console.error(`[Auto Fetch] Failed to fetch ${symbol}: ${response.status}`);
        results.push({
          symbol,
          success: false,
          error: `HTTP ${response.status}`
        });
        continue;
      }

      const data = await response.json();

      if (data.success) {
        console.log(`[Auto Fetch] Successfully fetched ${data.data.count} candles for ${symbol}`);
        results.push({
          symbol,
          success: true,
          count: data.data.count
        });
      } else {
        console.error(`[Auto Fetch] Error fetching ${symbol}:`, data.error);
        results.push({
          symbol,
          success: false,
          error: data.error
        });
      }

      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.error(`[Auto Fetch] Exception fetching ${symbol}:`, error);
      results.push({
        symbol,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  console.log(`[Auto Fetch] Completed: ${successCount} successful, ${failCount} failed`);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      success: true,
      message: `Fetched candles for ${successCount}/${WATCHLIST_SYMBOLS.length} symbols`,
      results,
      timestamp: new Date().toISOString()
    })
  };
};
