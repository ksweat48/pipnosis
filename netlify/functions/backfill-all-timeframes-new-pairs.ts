import type { Handler } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase-admin';
import axios from 'axios';

const supabase = getSupabaseAdmin();

interface DukascopyCandle {
  timestamp: number;
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

interface BackfillConfig {
  symbol: string;
  timeframe: string;
  daysBack: number;
}

interface BackfillResult {
  symbol: string;
  timeframe: string;
  success: boolean;
  candlesFetched: number;
  candlesInserted: number;
  error?: string;
  duration: number;
}

const NEW_PAIRS = ['GBPJPY', 'EURJPY', 'AUDUSD', 'NZDUSD'];
const ALL_TIMEFRAMES = ['M1', 'M5', 'M15', 'H1', 'H4', 'D1', 'W1'];

const SYMBOL_MAP: Record<string, string> = {
  'GBPJPY': 'gbpjpy',
  'EURJPY': 'eurjpy',
  'AUDUSD': 'audusd',
  'NZDUSD': 'nzdusd',
};

const TIMEFRAME_SECONDS: Record<string, number> = {
  'M1': 60,
  'M5': 300,
  'M15': 900,
  'H1': 3600,
  'H4': 14400,
  'D1': 86400,
  'W1': 604800
};

const TIMEFRAME_TO_PERIOD: Record<string, string> = {
  'M1': '1',
  'M5': '5',
  'M15': '15',
  'H1': '60',
  'H4': '240',
  'D1': 'D',
  'W1': 'W'
};

const TIMEFRAME_DAYS_BACK: Record<string, number> = {
  'M1': 7,
  'M5': 14,
  'M15': 30,
  'H1': 90,
  'H4': 180,
  'D1': 730,
  'W1': 1825
};

async function fetchDukascopyCandles(
  symbol: string,
  timeframe: string,
  startTimestamp: number,
  endTimestamp: number
): Promise<DukascopyCandle[]> {
  const dukascopySymbol = SYMBOL_MAP[symbol];
  if (!dukascopySymbol) {
    throw new Error(`Symbol ${symbol} not supported`);
  }

  const periodCode = TIMEFRAME_TO_PERIOD[timeframe];
  if (!periodCode) {
    throw new Error(`Timeframe ${timeframe} not supported`);
  }

  const baseUrl = 'https://freeserv.dukascopy.com/2.0/';

  const params = {
    symbol: dukascopySymbol,
    timeframe: periodCode,
    start: startTimestamp,
    end: endTimestamp,
    format: 'json'
  };

  console.log(`Fetching ${symbol} ${timeframe} from Dukascopy`);

  try {
    const response = await axios.get(baseUrl, {
      params,
      timeout: 60000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      }
    });

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
    console.error(`Dukascopy fetch error for ${symbol} ${timeframe}:`, error.message);
    throw error;
  }
}

function transformCandles(
  dukascopyCandles: DukascopyCandle[],
  symbol: string,
  timeframe: string
): ForexCandle[] {
  const intervalSeconds = TIMEFRAME_SECONDS[timeframe];

  return dukascopyCandles
    .filter(candle => {
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
        data_source: 'dukascopy_historical'
      };
    });
}

async function backfillSingleTimeframe(config: BackfillConfig): Promise<BackfillResult> {
  const startTime = Date.now();
  const { symbol, timeframe, daysBack } = config;

  try {
    console.log(`\n=== Starting backfill: ${symbol} ${timeframe} (${daysBack} days) ===`);

    const endTimestamp = Date.now();
    const startTimestamp = endTimestamp - (daysBack * 24 * 60 * 60 * 1000);

    const dukascopyCandles = await fetchDukascopyCandles(
      symbol,
      timeframe,
      startTimestamp,
      endTimestamp
    );

    if (dukascopyCandles.length === 0) {
      return {
        symbol,
        timeframe,
        success: true,
        candlesFetched: 0,
        candlesInserted: 0,
        duration: Date.now() - startTime
      };
    }

    const candles = transformCandles(dukascopyCandles, symbol, timeframe);
    console.log(`Transformed ${candles.length} valid candles`);

    console.log(`Inserting ${candles.length} candles into database...`);

    const BATCH_SIZE = 500;
    let candlesInserted = 0;

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
      } else {
        const inserted = insertedData?.length || 0;
        candlesInserted += inserted;
        console.log(`Batch ${i / BATCH_SIZE + 1}: Inserted ${inserted} candles`);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`Completed ${symbol} ${timeframe}: ${candlesInserted}/${candles.length} candles in ${(duration / 1000).toFixed(2)}s`);

    return {
      symbol,
      timeframe,
      success: true,
      candlesFetched: dukascopyCandles.length,
      candlesInserted,
      duration
    };

  } catch (error: any) {
    console.error(`Backfill failed for ${symbol} ${timeframe}:`, error.message);
    return {
      symbol,
      timeframe,
      success: false,
      candlesFetched: 0,
      candlesInserted: 0,
      error: error.message,
      duration: Date.now() - startTime
    };
  }
}

export const handler: Handler = async (event) => {
  const overallStartTime = Date.now();

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
    const body = JSON.parse(event.body || '{}');
    const { adminKey, symbols, timeframes } = body;

    if (adminKey !== process.env.ADMIN_REFRESH_KEY) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Unauthorized: Invalid admin key' })
      };
    }

    const targetSymbols = symbols && symbols.length > 0 ? symbols : NEW_PAIRS;
    const targetTimeframes = timeframes && timeframes.length > 0 ? timeframes : ALL_TIMEFRAMES;

    console.log('\n========================================');
    console.log('COMPREHENSIVE BACKFILL STARTED');
    console.log('========================================');
    console.log(`Symbols: ${targetSymbols.join(', ')}`);
    console.log(`Timeframes: ${targetTimeframes.join(', ')}`);
    console.log('========================================\n');

    const configs: BackfillConfig[] = [];
    for (const symbol of targetSymbols) {
      for (const timeframe of targetTimeframes) {
        configs.push({
          symbol,
          timeframe,
          daysBack: TIMEFRAME_DAYS_BACK[timeframe]
        });
      }
    }

    console.log(`Total operations: ${configs.length}`);

    const results: BackfillResult[] = [];

    for (const config of configs) {
      const result = await backfillSingleTimeframe(config);
      results.push(result);

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const overallDuration = Date.now() - overallStartTime;
    const successCount = results.filter(r => r.success).length;
    const totalCandlesFetched = results.reduce((sum, r) => sum + r.candlesFetched, 0);
    const totalCandlesInserted = results.reduce((sum, r) => sum + r.candlesInserted, 0);

    console.log('\n========================================');
    console.log('BACKFILL COMPLETED');
    console.log('========================================');
    console.log(`Total Duration: ${(overallDuration / 1000).toFixed(2)}s`);
    console.log(`Success Rate: ${successCount}/${results.length}`);
    console.log(`Total Candles Fetched: ${totalCandlesFetched}`);
    console.log(`Total Candles Inserted: ${totalCandlesInserted}`);
    console.log('========================================\n');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        summary: {
          totalOperations: results.length,
          successfulOperations: successCount,
          failedOperations: results.length - successCount,
          totalCandlesFetched,
          totalCandlesInserted,
          duration: `${(overallDuration / 1000).toFixed(2)}s`
        },
        results
      })
    };

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
