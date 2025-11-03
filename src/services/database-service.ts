import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { CandleData } from './metaapi-service';

interface SaveCandlesResult {
  success: boolean;
  candlesSaved: number;
  forexCandlesTable: {
    saved: number;
    error?: string;
  };
  marketDataTable: {
    saved: number;
    error?: string;
  };
}

function createServiceRoleClient(): SupabaseClient {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables for service role client');
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export async function saveCandlesToDatabase(
  candles: CandleData[],
  overwrite: boolean = true
): Promise<SaveCandlesResult> {
  if (candles.length === 0) {
    return {
      success: true,
      candlesSaved: 0,
      forexCandlesTable: { saved: 0 },
      marketDataTable: { saved: 0 }
    };
  }

  const supabase = createServiceRoleClient();

  const result: SaveCandlesResult = {
    success: true,
    candlesSaved: 0,
    forexCandlesTable: { saved: 0 },
    marketDataTable: { saved: 0 }
  };

  console.log(`Saving ${candles.length} candles to database (overwrite: ${overwrite})`);

  try {
    const { error: forexError, count: forexCount } = await supabase
      .from('forex_candles')
      .upsert(candles, {
        onConflict: 'symbol,timeframe,open_time',
        ignoreDuplicates: !overwrite
      })
      .select('*', { count: 'exact', head: true });

    if (forexError) {
      console.error('Failed to save candles to forex_candles:', forexError.message);
      result.forexCandlesTable.error = forexError.message;
      result.success = false;
    } else {
      result.forexCandlesTable.saved = forexCount || candles.length;
      console.log(`Saved ${result.forexCandlesTable.saved} candles to forex_candles`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Exception saving to forex_candles:', errorMessage);
    result.forexCandlesTable.error = errorMessage;
    result.success = false;
  }

  try {
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

    const { error: marketDataError, count: marketDataCount } = await supabase
      .from('market_data')
      .upsert(marketDataCandles, {
        onConflict: 'symbol,timeframe,timestamp',
        ignoreDuplicates: !overwrite
      })
      .select('*', { count: 'exact', head: true });

    if (marketDataError) {
      console.error('Failed to save candles to market_data:', marketDataError.message);
      result.marketDataTable.error = marketDataError.message;
      result.success = false;
    } else {
      result.marketDataTable.saved = marketDataCount || marketDataCandles.length;
      console.log(`Saved ${result.marketDataTable.saved} candles to market_data`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Exception saving to market_data:', errorMessage);
    result.marketDataTable.error = errorMessage;
    result.success = false;
  }

  result.candlesSaved = Math.max(
    result.forexCandlesTable.saved,
    result.marketDataTable.saved
  );

  console.log(`Database save complete: ${result.candlesSaved} candles saved (success: ${result.success})`);

  return result;
}

export async function getCandleStats(
  symbol: string,
  timeframe: string
): Promise<{
  oldestCandle: string | null;
  newestCandle: string | null;
  totalCandles: number;
}> {
  const supabase = createServiceRoleClient();

  try {
    const { data, error, count } = await supabase
      .from('forex_candles')
      .select('open_time', { count: 'exact' })
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .order('open_time', { ascending: true });

    if (error) {
      console.error('Error fetching candle stats:', error);
      return {
        oldestCandle: null,
        newestCandle: null,
        totalCandles: 0
      };
    }

    return {
      oldestCandle: data && data.length > 0 ? data[0].open_time : null,
      newestCandle: data && data.length > 0 ? data[data.length - 1].open_time : null,
      totalCandles: count || 0
    };
  } catch (error) {
    console.error('Exception fetching candle stats:', error);
    return {
      oldestCandle: null,
      newestCandle: null,
      totalCandles: 0
    };
  }
}

export async function batchSaveCandles(
  candles: CandleData[],
  batchSize: number = 500,
  overwrite: boolean = true
): Promise<SaveCandlesResult> {
  if (candles.length === 0) {
    return {
      success: true,
      candlesSaved: 0,
      forexCandlesTable: { saved: 0 },
      marketDataTable: { saved: 0 }
    };
  }

  console.log(`Batch saving ${candles.length} candles in batches of ${batchSize}`);

  const batches: CandleData[][] = [];
  for (let i = 0; i < candles.length; i += batchSize) {
    batches.push(candles.slice(i, i + batchSize));
  }

  console.log(`Split into ${batches.length} batches`);

  const aggregatedResult: SaveCandlesResult = {
    success: true,
    candlesSaved: 0,
    forexCandlesTable: { saved: 0 },
    marketDataTable: { saved: 0 }
  };

  for (let i = 0; i < batches.length; i++) {
    console.log(`Processing batch ${i + 1}/${batches.length}...`);

    const batchResult = await saveCandlesToDatabase(batches[i], overwrite);

    aggregatedResult.candlesSaved += batchResult.candlesSaved;
    aggregatedResult.forexCandlesTable.saved += batchResult.forexCandlesTable.saved;
    aggregatedResult.marketDataTable.saved += batchResult.marketDataTable.saved;

    if (!batchResult.success) {
      aggregatedResult.success = false;
      if (batchResult.forexCandlesTable.error) {
        aggregatedResult.forexCandlesTable.error = batchResult.forexCandlesTable.error;
      }
      if (batchResult.marketDataTable.error) {
        aggregatedResult.marketDataTable.error = batchResult.marketDataTable.error;
      }
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`Batch save complete: ${aggregatedResult.candlesSaved} total candles saved`);

  return aggregatedResult;
}
