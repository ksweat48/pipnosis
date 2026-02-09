import type { Handler } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase-admin';
import axios from 'axios';

const supabase = getSupabaseAdmin();

/**
 * Dukascopy Historical Backfill
 *
 * Uses Dukascopy's FREE forex data API to backfill historical candles
 * with proper OHLC data including wicks for all timeframes.
 *
 * Data source: https://www.dukascopy.com/swiss/english/marketwatch/historical/
 */

interface DukascopyCandle {
  timestamp: number;  // Unix timestamp in milliseconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ForexCandle {
  symbol: string;
  timeframe: string;
  open_time: string;
  close_time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  data_source: string;
}

interface BackfillRequest {
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  overwrite?: boolean;
  adminKey?: string;
}

interface BackfillResult {
  success: boolean;
  symbol: string;
  timeframe: string;
  candlesFetched: number;
  candlesInserted: number;
  candlesSkipped: number;
  candlesDeleted: number;
  error?: string;
  duration: number;
}

// Symbol mapping for Dukascopy
const SYMBOL_MAP: Record<string, string> = {
  'EURUSD': 'eurusd',
  'GBPUSD': 'gbpusd',
  'USDJPY': 'usdjpy',
  'XAUUSD': 'xauusd',
  // AUDUSD, USDCHF, etc. also available
};

// Timeframe to seconds mapping
const TIMEFRAME_SECONDS: Record<string, number> = {
  'M1': 60,
  'M5': 300,
  'M15': 900,
  'M30': 1800,
  'H1': 3600,
  'H4': 14400,
  'D1': 86400,
  'W1': 604800
};

// Dukascopy API uses specific period codes
const TIMEFRAME_TO_PERIOD: Record<string, string> = {
  'M1': '1',
  'M5': '5',
  'M15': '15',
  'M30': '30',
  'H1': '60',
  'H4': '240',
  'D1': 'D',
  'W1': 'W'
};

/**
 * Fetch candles from Dukascopy's HTTP API
 *
 * Dukascopy provides pre-aggregated OHLC candles which gives us
 * proper high/low wicks for each timeframe.
 */
async function fetchDukascopyCandles(
  symbol: string,
  timeframe: string,
  startTimestamp: number,
  endTimestamp: number
): Promise<DukascopyCandle[]> {
  const dukascopySymbol = SYMBOL_MAP[symbol];
  if (!dukascopySymbol) {
    throw new Error(`Symbol ${symbol} not supported by Dukascopy`);
  }

  const periodCode = TIMEFRAME_TO_PERIOD[timeframe];
  if (!periodCode) {
    throw new Error(`Timeframe ${timeframe} not supported`);
  }

  // Dukascopy API endpoint for candles
  // Format: https://freeserv.dukascopy.com/2.0/?path=/chart/candles/get.json
  const baseUrl = 'https://freeserv.dukascopy.com/2.0/';

  const params = {
    symbol: dukascopySymbol,
    timeframe: periodCode,
    start: startTimestamp,
    end: endTimestamp,
    format: 'json'
  };

  console.log(`Fetching ${symbol} ${timeframe} from Dukascopy:`, params);

  try {
    const response = await axios.get(baseUrl, {
      params,
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      }
    });

    // Dukascopy returns array of: [timestamp, open, high, low, close, volume]
    if (!response.data || !Array.isArray(response.data)) {
      console.log(`No data returned for ${symbol} ${timeframe}`);
      return [];
    }

    const candles: DukascopyCandle[] = response.data.map((item: any[]) => ({
      timestamp: item[0],
      open: item[1],
      high: item[2],
      low: item[3],
      close: item[4],
      volume: item[5] || 0
    }));

    console.log(`Fetched ${candles.length} candles from Dukascopy`);
    return candles;

  } catch (error: any) {
    console.error(`Dukascopy fetch error:`, error.message);

    // If Dukascopy API fails, try alternative method: bi5 binary files
    // (This would require additional implementation)
    console.log(`Note: For comprehensive backfill, consider using Dukascopy's bi5 tick data`);

    throw error;
  }
}

/**
 * Transform Dukascopy candles to our database format
 */
function transformCandles(
  dukascopyCandles: DukascopyCandle[],
  symbol: string,
  timeframe: string
): ForexCandle[] {
  const intervalSeconds = TIMEFRAME_SECONDS[timeframe];

  return dukascopyCandles
    .filter(candle => {
      // Validate OHLC relationships
      if (candle.high < candle.low) return false;
      if (candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0) return false;
      if (candle.high < candle.open || candle.high < candle.close) return false;
      if (candle.low > candle.open || candle.low > candle.close) return false;
      return true;
    })
    .map(candle => {
      const openTime = new Date(candle.timestamp);
      const closeTime = new Date(candle.timestamp + (intervalSeconds * 1000));

      return {
        symbol,
        timeframe,
        open_time: openTime.toISOString(),
        close_time: closeTime.toISOString(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        data_source: 'dukascopy_historical'  // Highest priority in quality system
      };
    });
}

export const handler: Handler = async (event) => {
  const startTime = Date.now();

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
    const request: BackfillRequest = JSON.parse(event.body || '{}');
    const { symbol, timeframe, startDate, endDate, overwrite = false, adminKey } = request;

    // Verify admin key
    if (adminKey !== process.env.ADMIN_REFRESH_KEY) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Unauthorized: Invalid admin key' })
      };
    }

    if (!symbol || !timeframe || !startDate || !endDate) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Missing required parameters',
          required: ['symbol', 'timeframe', 'startDate', 'endDate']
        })
      };
    }

    console.log(`Starting Dukascopy backfill for ${symbol} ${timeframe}`, {
      startDate,
      endDate,
      overwrite
    });

    const startTimestamp = Math.floor(new Date(startDate).getTime());
    const endTimestamp = Math.floor(new Date(endDate).getTime());

    if (startTimestamp >= endTimestamp) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'startDate must be before endDate' })
      };
    }

    let candlesDeleted = 0;
    let executionId: string | null = null;

    try {
      // Log execution
      const { data: execution, error: execError } = await supabase
        .from('backfill_executions')
        .insert({
          symbol,
          timeframe,
          start_time: new Date(startTimestamp).toISOString(),
          end_time: new Date(endTimestamp).toISOString(),
          status: 'in_progress',
          candles_requested: 0,
          candles_filled: 0
        })
        .select('id')
        .single();

      if (!execError && execution) {
        executionId = execution.id;
      }

      // Delete existing data if overwrite is enabled
      if (overwrite) {
        console.log(`Deleting existing candles for ${symbol} ${timeframe} in date range`);

        const { error: deleteError, count } = await supabase
          .from('forex_candles')
          .delete({ count: 'exact' })
          .eq('symbol', symbol)
          .eq('timeframe', timeframe)
          .gte('open_time', new Date(startTimestamp).toISOString())
          .lte('open_time', new Date(endTimestamp).toISOString());

        if (!deleteError && count !== null) {
          candlesDeleted = count;
          console.log(`Deleted ${candlesDeleted} existing candles`);
        }
      }

      // Fetch candles from Dukascopy
      console.log(`Fetching candles from Dukascopy...`);
      const dukascopyCandles = await fetchDukascopyCandles(
        symbol,
        timeframe,
        startTimestamp,
        endTimestamp
      );

      console.log(`Received ${dukascopyCandles.length} candles from Dukascopy`);

      if (dukascopyCandles.length === 0) {
        const result: BackfillResult = {
          success: true,
          symbol,
          timeframe,
          candlesFetched: 0,
          candlesInserted: 0,
          candlesSkipped: 0,
          candlesDeleted,
          duration: Date.now() - startTime
        };

        if (executionId) {
          await supabase
            .from('backfill_executions')
            .update({
              status: 'completed',
              candles_requested: 0,
              candles_filled: 0,
              completed_at: new Date().toISOString()
            })
            .eq('id', executionId);
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(result)
        };
      }

      // Transform to our format
      const candles = transformCandles(dukascopyCandles, symbol, timeframe);
      console.log(`Transformed ${candles.length} valid candles`);

      // Insert into database
      console.log(`Inserting ${candles.length} candles into database...`);

      const BATCH_SIZE = 500;
      let candlesInserted = 0;
      let candlesSkipped = 0;

      for (let i = 0; i < candles.length; i += BATCH_SIZE) {
        const batch = candles.slice(i, i + BATCH_SIZE);

        const { data: insertedData, error: insertError } = await supabase
          .from('forex_candles')
          .upsert(batch, {
            onConflict: 'symbol,timeframe,open_time',
            ignoreDuplicates: false
          })
          .select('id');

        if (insertError) {
          console.error(`Error inserting batch ${i / BATCH_SIZE + 1}:`, insertError);
          candlesSkipped += batch.length;
        } else {
          const inserted = insertedData?.length || 0;
          candlesInserted += inserted;
          console.log(`Batch ${i / BATCH_SIZE + 1}: Inserted ${inserted} candles`);
        }
      }

      if (executionId) {
        await supabase
          .from('backfill_executions')
          .update({
            status: 'completed',
            candles_requested: candles.length,
            candles_filled: candlesInserted,
            completed_at: new Date().toISOString()
          })
          .eq('id', executionId);
      }

      const result: BackfillResult = {
        success: true,
        symbol,
        timeframe,
        candlesFetched: dukascopyCandles.length,
        candlesInserted,
        candlesSkipped,
        candlesDeleted,
        duration: Date.now() - startTime
      };

      console.log('Dukascopy backfill completed:', result);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(result)
      };

    } catch (error: any) {
      console.error('Backfill error:', error);

      if (executionId) {
        await supabase
          .from('backfill_executions')
          .update({
            status: 'failed',
            error_message: error.message,
            completed_at: new Date().toISOString()
          })
          .eq('id', executionId);
      }

      const result: BackfillResult = {
        success: false,
        symbol,
        timeframe,
        candlesFetched: 0,
        candlesInserted: 0,
        candlesSkipped: 0,
        candlesDeleted,
        error: error.message,
        duration: Date.now() - startTime
      };

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify(result)
      };
    }

  } catch (error: any) {
    console.error('Request error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};
