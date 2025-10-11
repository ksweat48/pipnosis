import { supabase } from '../lib/supabase';
import { metaApiService, CandleData, Timeframe } from './metaapi';

/**
 * Supported timeframes for historical data fetching
 */
export type HistoricalTimeframe = '5m' | '15m' | '1h';

/**
 * Options for fetching historical candles
 */
export interface FetchHistoricalOptions {
  symbol: string;
  timeframe: HistoricalTimeframe;
  daysBack?: number;
  overwrite?: boolean;
  onProgress?: (progress: FetchProgress) => void;
}

/**
 * Progress callback data
 */
export interface FetchProgress {
  symbol: string;
  timeframe: string;
  totalDays: number;
  daysProcessed: number;
  candlesFetched: number;
  candlesSaved: number;
  currentChunk: number;
  totalChunks: number;
  percentComplete: number;
  status: 'fetching' | 'saving' | 'completed' | 'error';
  message: string;
}

/**
 * Result of historical candle fetch operation
 */
export interface FetchResult {
  success: boolean;
  symbol: string;
  timeframe: string;
  candlesFetched: number;
  candlesSaved: number;
  dateRangeStart: Date;
  dateRangeEnd: Date;
  duration: number;
  error?: string;
}

/**
 * Maps user-friendly timeframes to MetaApi internal format
 */
function mapTimeframe(timeframe: HistoricalTimeframe): Timeframe {
  const map: Record<HistoricalTimeframe, Timeframe> = {
    '5m': 'M5',
    '15m': 'M15',
    '1h': 'H1'
  };
  return map[timeframe];
}

/**
 * Calculates timeframe duration in minutes
 */
function getTimeframeMinutes(timeframe: HistoricalTimeframe): number {
  const map: Record<HistoricalTimeframe, number> = {
    '5m': 5,
    '15m': 15,
    '1h': 60
  };
  return map[timeframe];
}

/**
 * Calculates optimal chunk size (in days) for fetching based on timeframe
 * This ensures we stay under MetaApi's ~1000 candle limit per request
 */
function getOptimalChunkDays(timeframe: HistoricalTimeframe): number {
  const candlesPerDay = (24 * 60) / getTimeframeMinutes(timeframe);
  const maxCandlesPerRequest = 900; // Stay under 1000 limit with buffer
  const chunkDays = Math.floor(maxCandlesPerRequest / candlesPerDay);
  return Math.max(1, Math.min(chunkDays, 7)); // Between 1-7 days per chunk
}

/**
 * Checks if candles already exist in the database for the given range
 */
async function checkExistingCandles(
  symbol: string,
  timeframe: HistoricalTimeframe,
  startTime: Date,
  endTime: Date
): Promise<{ exists: boolean; count: number }> {
  try {
    const { data, error } = await supabase.rpc('check_historical_candles_exist', {
      p_symbol: symbol,
      p_timeframe: timeframe,
      p_start_time: startTime.toISOString(),
      p_end_time: endTime.toISOString()
    });

    if (error) {
      console.error('Error checking existing candles:', error);
      return { exists: false, count: 0 };
    }

    if (data && data.length > 0) {
      return {
        exists: data[0].data_exists || false,
        count: parseInt(data[0].candle_count) || 0
      };
    }

    return { exists: false, count: 0 };
  } catch (error) {
    console.error('Exception checking existing candles:', error);
    return { exists: false, count: 0 };
  }
}

/**
 * Saves candles to the historical_candles table in Supabase
 */
async function saveCandles(
  candles: CandleData[],
  overwrite: boolean = false
): Promise<number> {
  if (candles.length === 0) return 0;

  try {
    const rows = candles.map(candle => ({
      symbol: candle.symbol,
      timeframe: candle.timeframe,
      time: candle.time.toISOString(),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume || 0,
      tick_volume: candle.tickVolume || 0,
      spread: candle.spread || 0,
      broker_time: candle.brokerTime || candle.time.toISOString(),
      data_source: 'metaapi_historical'
    }));

    const { error, count } = await supabase
      .from('historical_candles')
      .upsert(rows, {
        onConflict: 'symbol,timeframe,time',
        ignoreDuplicates: !overwrite
      });

    if (error) {
      console.error('Error saving candles to database:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    return rows.length;
  } catch (error) {
    console.error('Exception saving candles:', error);
    throw error;
  }
}

/**
 * Fetches historical candles from MetaApi and stores them in Supabase
 * 
 * @param options - Fetch options including symbol, timeframe, and days back
 * @returns Promise<FetchResult> - Result of the fetch operation
 * 
 * @example
 * ```ts
 * const result = await fetchHistoricalCandles({
 *   symbol: 'EURUSD',
 *   timeframe: '5m',
 *   daysBack: 90,
 *   onProgress: (progress) => console.log(progress.percentComplete)
 * });
 * ```
 */
export async function fetchHistoricalCandles(
  options: FetchHistoricalOptions
): Promise<FetchResult> {
  const {
    symbol,
    timeframe,
    daysBack = 90,
    overwrite = false,
    onProgress
  } = options;

  const startTimestamp = Date.now();
  let totalCandlesFetched = 0;
  let totalCandlesSaved = 0;

  console.log(`🚀 Starting historical fetch for ${symbol} ${timeframe} - ${daysBack} days back`);

  try {
    // Initialize MetaApi connection
    await metaApiService.initialize();

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    startDate.setUTCHours(0, 0, 0, 0);
    endDate.setUTCHours(23, 59, 59, 999);

    console.log(`📅 Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

    // Check if data already exists
    if (!overwrite) {
      const existing = await checkExistingCandles(symbol, timeframe, startDate, endDate);
      if (existing.exists && existing.count > 0) {
        console.log(`✅ Found ${existing.count} existing candles. Skipping fetch.`);
        console.log(`💡 Use overwrite=true to refresh existing data.`);
        
        return {
          success: true,
          symbol,
          timeframe,
          candlesFetched: 0,
          candlesSaved: 0,
          dateRangeStart: startDate,
          dateRangeEnd: endDate,
          duration: Date.now() - startTimestamp,
          error: `Data already exists (${existing.count} candles). Use overwrite=true to refresh.`
        };
      }
    }

    // Calculate chunks for pagination
    const chunkDays = getOptimalChunkDays(timeframe);
    const totalChunks = Math.ceil(daysBack / chunkDays);
    
    console.log(`📦 Will fetch in ${totalChunks} chunks (${chunkDays} days per chunk)`);

    const internalTimeframe = mapTimeframe(timeframe);
    let chunkIndex = 0;

    // Fetch data in chunks
    for (let currentDate = new Date(startDate); currentDate < endDate; ) {
      chunkIndex++;
      
      const chunkEnd = new Date(currentDate);
      chunkEnd.setDate(chunkEnd.getDate() + chunkDays);
      
      if (chunkEnd > endDate) {
        chunkEnd.setTime(endDate.getTime());
      }

      console.log(`\n📡 Chunk ${chunkIndex}/${totalChunks}: ${currentDate.toISOString()} to ${chunkEnd.toISOString()}`);

      // Report progress
      if (onProgress) {
        onProgress({
          symbol,
          timeframe,
          totalDays: daysBack,
          daysProcessed: Math.min(chunkIndex * chunkDays, daysBack),
          candlesFetched: totalCandlesFetched,
          candlesSaved: totalCandlesSaved,
          currentChunk: chunkIndex,
          totalChunks,
          percentComplete: Math.round((chunkIndex / totalChunks) * 100),
          status: 'fetching',
          message: `Fetching chunk ${chunkIndex}/${totalChunks}`
        });
      }

      // Fetch candles from MetaApi
      let candles: CandleData[] = [];
      try {
        const limit = Math.ceil((chunkDays * 24 * 60) / getTimeframeMinutes(timeframe));
        candles = await metaApiService.getHistoricalCandles(
          symbol,
          internalTimeframe,
          currentDate,
          limit
        );

        // Filter candles to the exact chunk range
        candles = candles.filter(c => 
          c.time >= currentDate && c.time <= chunkEnd
        );

        console.log(`   ✓ Fetched ${candles.length} candles`);
        totalCandlesFetched += candles.length;
      } catch (error) {
        console.error(`   ✗ Error fetching chunk ${chunkIndex}:`, error);
        // Continue with next chunk instead of failing completely
        currentDate.setDate(currentDate.getDate() + chunkDays);
        continue;
      }

      // Save candles to database
      if (candles.length > 0) {
        if (onProgress) {
          onProgress({
            symbol,
            timeframe,
            totalDays: daysBack,
            daysProcessed: Math.min(chunkIndex * chunkDays, daysBack),
            candlesFetched: totalCandlesFetched,
            candlesSaved: totalCandlesSaved,
            currentChunk: chunkIndex,
            totalChunks,
            percentComplete: Math.round((chunkIndex / totalChunks) * 100),
            status: 'saving',
            message: `Saving ${candles.length} candles to database`
          });
        }

        try {
          const saved = await saveCandles(candles, overwrite);
          totalCandlesSaved += saved;
          console.log(`   ✓ Saved ${saved} candles to database`);
        } catch (error) {
          console.error(`   ✗ Error saving candles:`, error);
        }
      }

      // Move to next chunk
      currentDate.setDate(currentDate.getDate() + chunkDays);

      // Add small delay between chunks to avoid rate limiting
      if (chunkIndex < totalChunks) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    const duration = Date.now() - startTimestamp;
    
    // Report completion
    if (onProgress) {
      onProgress({
        symbol,
        timeframe,
        totalDays: daysBack,
        daysProcessed: daysBack,
        candlesFetched: totalCandlesFetched,
        candlesSaved: totalCandlesSaved,
        currentChunk: totalChunks,
        totalChunks,
        percentComplete: 100,
        status: 'completed',
        message: `Completed: ${totalCandlesSaved} candles saved`
      });
    }

    console.log(`\n✅ Historical fetch completed in ${(duration / 1000).toFixed(2)}s`);
    console.log(`   📊 Fetched: ${totalCandlesFetched} candles`);
    console.log(`   💾 Saved: ${totalCandlesSaved} candles`);

    return {
      success: true,
      symbol,
      timeframe,
      candlesFetched: totalCandlesFetched,
      candlesSaved: totalCandlesSaved,
      dateRangeStart: startDate,
      dateRangeEnd: endDate,
      duration
    };

  } catch (error) {
    const duration = Date.now() - startTimestamp;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    console.error(`❌ Historical fetch failed:`, errorMessage);

    if (onProgress) {
      onProgress({
        symbol,
        timeframe,
        totalDays: daysBack,
        daysProcessed: 0,
        candlesFetched: totalCandlesFetched,
        candlesSaved: totalCandlesSaved,
        currentChunk: 0,
        totalChunks: 0,
        percentComplete: 0,
        status: 'error',
        message: `Error: ${errorMessage}`
      });
    }

    return {
      success: false,
      symbol,
      timeframe,
      candlesFetched: totalCandlesFetched,
      candlesSaved: totalCandlesSaved,
      dateRangeStart: new Date(),
      dateRangeEnd: new Date(),
      duration,
      error: errorMessage
    };
  }
}

/**
 * Gets statistics about stored historical candles
 */
export async function getHistoricalCandleStats(
  symbol: string,
  timeframe: HistoricalTimeframe
): Promise<{
  totalCandles: number;
  oldestCandle: Date | null;
  newestCandle: Date | null;
  dateRangeDays: number;
} | null> {
  try {
    const { data, error } = await supabase.rpc('get_historical_candle_stats', {
      p_symbol: symbol,
      p_timeframe: timeframe
    });

    if (error || !data || data.length === 0) {
      return null;
    }

    const stats = data[0];
    return {
      totalCandles: parseInt(stats.total_candles) || 0,
      oldestCandle: stats.oldest_candle ? new Date(stats.oldest_candle) : null,
      newestCandle: stats.newest_candle ? new Date(stats.newest_candle) : null,
      dateRangeDays: parseFloat(stats.date_range_days) || 0
    };
  } catch (error) {
    console.error('Error getting historical candle stats:', error);
    return null;
  }
}

/**
 * Refreshes the most recent candles (useful for weekly updates)
 */
export async function refreshRecentCandles(
  symbol: string,
  timeframe: HistoricalTimeframe,
  daysToRefresh: number = 3
): Promise<FetchResult> {
  console.log(`🔄 Refreshing recent ${daysToRefresh} days for ${symbol} ${timeframe}`);
  
  return fetchHistoricalCandles({
    symbol,
    timeframe,
    daysBack: daysToRefresh,
    overwrite: true // Always overwrite when refreshing
  });
}
