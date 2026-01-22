import { candleCacheManager } from './candle-cache-manager';
import { ensureUnixTimestamp, unixTimestampToPostgresTimestamp } from './candle-data-service';
import { marketDataService } from './market-data-service';
import { candleBackfillService } from './candle-backfill-service';

const NETLIFY_FUNCTION_URL = import.meta.env.VITE_NETLIFY_FUNCTIONS_URL || '/.netlify/functions';
const CONCURRENT_BATCH_SIZE = 3;
const BATCH_DELAY_MS = 500;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 5000, 10000];

interface CandleFetchTask {
  symbol: string;
  timeframe: string;
  candleCount: number;
  priority: number;
}

interface FetchProgress {
  total: number;
  completed: number;
  failed: number;
  currentBatch: string[];
}

type ProgressCallback = (progress: FetchProgress) => void;

const PRIORITY_BATCHES: CandleFetchTask[][] = [
  [
    { symbol: 'XAUUSD', timeframe: 'M1', candleCount: 400, priority: 1 },
    { symbol: 'XAUUSD', timeframe: 'M5', candleCount: 600, priority: 1 },
    { symbol: 'XAUUSD', timeframe: 'H1', candleCount: 300, priority: 1 },
    { symbol: 'XAUUSD', timeframe: 'H4', candleCount: 300, priority: 1 },
    { symbol: 'XAUUSD', timeframe: 'D1', candleCount: 300, priority: 1 }
  ],
  [
    { symbol: 'US30', timeframe: 'M1', candleCount: 400, priority: 2 },
    { symbol: 'US30', timeframe: 'M5', candleCount: 600, priority: 2 },
    { symbol: 'US30', timeframe: 'H1', candleCount: 300, priority: 2 },
    { symbol: 'US30', timeframe: 'H4', candleCount: 300, priority: 2 },
    { symbol: 'US30', timeframe: 'D1', candleCount: 300, priority: 2 }
  ],
  [
    { symbol: 'EURUSD', timeframe: 'M1', candleCount: 400, priority: 3 },
    { symbol: 'EURUSD', timeframe: 'M5', candleCount: 600, priority: 3 },
    { symbol: 'EURUSD', timeframe: 'H1', candleCount: 300, priority: 3 },
    { symbol: 'EURUSD', timeframe: 'H4', candleCount: 300, priority: 3 },
    { symbol: 'EURUSD', timeframe: 'D1', candleCount: 300, priority: 3 }
  ],
  [
    { symbol: 'GBPUSD', timeframe: 'M1', candleCount: 400, priority: 4 },
    { symbol: 'GBPUSD', timeframe: 'M5', candleCount: 600, priority: 4 },
    { symbol: 'GBPUSD', timeframe: 'H1', candleCount: 300, priority: 4 },
    { symbol: 'GBPUSD', timeframe: 'H4', candleCount: 300, priority: 4 },
    { symbol: 'GBPUSD', timeframe: 'D1', candleCount: 300, priority: 4 }
  ],
  [
    { symbol: 'USDJPY', timeframe: 'M1', candleCount: 400, priority: 5 },
    { symbol: 'USDJPY', timeframe: 'M5', candleCount: 600, priority: 5 },
    { symbol: 'USDJPY', timeframe: 'H1', candleCount: 300, priority: 5 },
    { symbol: 'USDJPY', timeframe: 'H4', candleCount: 300, priority: 5 },
    { symbol: 'USDJPY', timeframe: 'D1', candleCount: 300, priority: 5 }
  ]
];

class ConcurrentBulkLoader {
  private isLoading = false;
  private shouldInterrupt = false;
  private interruptTask: CandleFetchTask | null = null;

  async loadSinglePair(
    symbol: string,
    timeframe: string,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<boolean> {
    const candleCount = this.getCandleCountForTimeframe(timeframe);

    try {
      const cached = await candleCacheManager.getCachedCandles(symbol, timeframe);

      if (cached.metadata && cached.candles.length > 0) {
        const cacheAge = Date.now() - cached.metadata.fetchTimestamp;

        if (cacheAge < 5 * 60 * 1000) {
          // CRITICAL FIX: Don't upsert cached candles - they may have 'time' instead of 'open_time'
          // Just fetch from database which has correct format
          console.log(`[BulkLoader] Skipping cached data upsert for ${symbol} ${timeframe}, will fetch from database`);
          // Don't return - continue to fetch from database
        }
      }

      const candles = await this.fetchCandlesWithRetry(symbol, timeframe, candleCount, onProgress);

      if (candles && candles.length > 0) {
        // CRITICAL FIX: Don't upsert candles that were just loaded from database
        // They're already persisted! Only upsert when we have NEW data from external sources
        // Upserting database-loaded candles causes unnecessary operations and field mismatch errors
        console.log(`[BulkLoader] ✅ Loaded ${candles.length} candles from database (already persisted, skipping upsert)`);

        try {
          await candleCacheManager.saveCandles(symbol, timeframe, candles);
        } catch (cacheError) {
          console.warn(`[BulkLoader] Cache save failed for ${symbol} ${timeframe}, continuing without cache:`, cacheError);
        }

        return true;
      }

      return false;
    } catch (error) {
      console.error(`Failed to load ${symbol} ${timeframe}:`, error);
      return false;
    }
  }

  async loadAllPairsInBackground(
    currentSymbol: string,
    currentTimeframe: string,
    onProgress?: ProgressCallback
  ): Promise<void> {
    if (this.isLoading) {
      console.log('Background loading already in progress');
      return;
    }

    this.isLoading = true;
    this.shouldInterrupt = false;

    const allTasks = PRIORITY_BATCHES.flat();
    const tasksToLoad = allTasks.filter(
      task => !(task.symbol === currentSymbol && task.timeframe === currentTimeframe)
    );

    const progress: FetchProgress = {
      total: tasksToLoad.length,
      completed: 0,
      failed: 0,
      currentBatch: []
    };

    try {
      for (let i = 0; i < PRIORITY_BATCHES.length; i++) {
        if (this.shouldInterrupt && this.interruptTask) {
          await this.handleInterruption(this.interruptTask, progress, onProgress);
          continue;
        }

        const batch = PRIORITY_BATCHES[i].filter(
          task => !(task.symbol === currentSymbol && task.timeframe === currentTimeframe)
        );

        if (batch.length === 0) continue;

        progress.currentBatch = batch.map(t => `${t.symbol} ${t.timeframe}`);
        onProgress?.(progress);

        const results = await Promise.allSettled(
          batch.map(task => this.loadSinglePair(task.symbol, task.timeframe))
        );

        results.forEach((result, idx) => {
          if (result.status === 'fulfilled' && result.value) {
            progress.completed++;
          } else {
            progress.failed++;
            progress.completed++; // CRITICAL: Count failures as completed so progress bar doesn't get stuck
            console.warn(`[BulkLoader] Failed to load ${batch[idx].symbol} ${batch[idx].timeframe}, continuing...`);
          }
        });

        progress.currentBatch = [];
        onProgress?.(progress);

        // Don't break on failures - just log and continue
        if (progress.failed >= 5) {
          console.warn(`[BulkLoader] ${progress.failed} failures detected, but continuing background loading`);
        }

        if (i < PRIORITY_BATCHES.length - 1) {
          await this.delay(BATCH_DELAY_MS);
        }
      }
    } finally {
      this.isLoading = false;
      this.shouldInterrupt = false;
      this.interruptTask = null;
    }

    await candleCacheManager.clearStaleCache();
  }

  interruptForSymbol(symbol: string, timeframe: string): void {
    if (!this.isLoading) return;

    const task = PRIORITY_BATCHES.flat().find(
      t => t.symbol === symbol && t.timeframe === timeframe
    );

    if (task) {
      this.shouldInterrupt = true;
      this.interruptTask = task;
    }
  }

  private async handleInterruption(
    task: CandleFetchTask,
    progress: FetchProgress,
    onProgress?: ProgressCallback
  ): Promise<void> {
    progress.currentBatch = [`${task.symbol} ${task.timeframe} (priority)`];
    onProgress?.(progress);

    const success = await this.loadSinglePair(task.symbol, task.timeframe);

    if (success) {
      progress.completed++;
    } else {
      progress.failed++;
    }

    this.shouldInterrupt = false;
    this.interruptTask = null;
  }

  /**
   * ✅ SSOT: Uses MarketDataService for candle queries
   */
  private async fetchCandlesWithRetry(
    symbol: string,
    timeframe: string,
    count: number,
    onProgress?: (loaded: number, total: number) => void,
    retryCount = 0
  ): Promise<any[]> {
    try {
      console.log(`[BulkLoader] Loading ${symbol} ${timeframe} directly from database...`);

      const dbTimeframe = timeframe.toUpperCase();
      console.log(`[BulkLoader] Querying with: symbol=${symbol}, timeframe=${dbTimeframe}, limit=${count}`);

      const candles = await marketDataService.getCandles(symbol, dbTimeframe, count);

      if (!candles || candles.length === 0) {
        console.warn(`[BulkLoader] No candles found for ${symbol} ${dbTimeframe}`);
        console.log(`[BulkLoader] Query returned 0 results - check if data exists in database for this symbol/timeframe`);
        return [];
      }

      console.log(`[BulkLoader] ✅ Loaded ${candles.length} candles for ${symbol} ${dbTimeframe} from database`);
      onProgress?.(candles.length, count);

      // Reverse to get chronological order (oldest first)
      // Note: MarketDataService returns newest first
      const chronologicalCandles = candles.reverse();

      // IMPORTANT: Keep timestamps in original database format (ISO strings)
      // Only convert to Unix seconds when displaying on chart, not for storage
      return chronologicalCandles.map((c: any) => ({
        symbol,
        timeframe: dbTimeframe,
        // Keep original timestamp format from database
        open_time: c.open_time,
        close_time: c.open_time, // Use open_time if close_time not available
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume || 0,
        tick_volume: 0, // Not available in standard candle data
        spread: 0 // Not available in standard candle data
      }));
    } catch (error) {
      if (retryCount < MAX_RETRIES) {
        console.warn(`[BulkLoader] Retry ${retryCount + 1}/${MAX_RETRIES} for ${symbol} ${timeframe}`);
        await this.delay(RETRY_DELAYS[retryCount]);
        return this.fetchCandlesWithRetry(symbol, timeframe, count, onProgress, retryCount + 1);
      }

      console.error(`[BulkLoader] Failed to load ${symbol} ${timeframe} after ${MAX_RETRIES} retries:`, error);
      throw error;
    }
  }

  /**
   * ✅ SSOT: Uses CandleBackfillService for candle writes
   */
  private async upsertCandles(candles: any[]): Promise<void> {
    if (candles.length === 0) return;

    // Transform candles to BackfillService format
    const validCandles = candles.map(candle => {
      const { id, timestamp, cacheId, ...validFields } = candle;

      // CRITICAL FIX: Convert 'time' field to 'open_time' if needed
      // Forming candles from aggregator have 'time' but database needs 'open_time'
      let openTime = validFields.open_time;
      if (validFields.time && !openTime) {
        openTime = validFields.time;
        delete validFields.time;
      }

      // CRITICAL FIX: If timestamps are Unix seconds (numbers), convert to PostgreSQL timestamptz format
      // This handles candles from aggregator or other sources that use Unix timestamps
      if (openTime !== undefined && typeof openTime === 'number') {
        openTime = unixTimestampToPostgresTimestamp(
          openTime,
          `BulkLoader-upsert-${validFields.symbol || 'unknown'}`
        );
      }

      return {
        symbol: validFields.symbol,
        timeframe: validFields.timeframe,
        open: validFields.open,
        high: validFields.high,
        low: validFields.low,
        close: validFields.close,
        volume: validFields.volume || 0,
        open_time: openTime,
        data_source: 'bulk_loader'
      };
    });

    // DEBUG: Log what we're about to send
    console.log('[BulkLoader] About to upsert candles:', {
      count: validCandles.length,
      firstCandle: validCandles[0],
      firstCandleKeys: Object.keys(validCandles[0])
    });

    const result = await candleBackfillService.insertCandles(validCandles, {
      deduplicate: true,
      validate: true
    });

    if (result.errors > 0) {
      console.error(`[BulkLoader] Failed to insert ${result.errors} candles`);
      throw new Error(`Failed to upsert ${result.errors} candles`);
    }

    console.log(`[BulkLoader] ✅ Upserted ${result.inserted} candles, skipped ${result.skipped} duplicates`);
  }

  private async updateCacheInBackground(
    symbol: string,
    timeframe: string,
    candleCount: number
  ): Promise<void> {
    setTimeout(async () => {
      try {
        const candles = await this.fetchCandlesWithRetry(symbol, timeframe, candleCount);
        if (candles && candles.length > 0) {
          await this.upsertCandles(candles);

          try {
            await candleCacheManager.saveCandles(symbol, timeframe, candles);
          } catch (cacheError) {
            console.warn(`[BulkLoader] Background cache save failed for ${symbol} ${timeframe}:`, cacheError);
          }
        }
      } catch (error) {
        console.error(`Background cache update failed for ${symbol} ${timeframe}:`, error);
      }
    }, 100);
  }

  private getCandleCountForTimeframe(timeframe: string): number {
    switch (timeframe) {
      case 'M1': return 400;
      case 'M5': return 600;
      case 'H1': return 300;
      case 'H4': return 300;
      case 'D1': return 300;
      default: return 300;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const concurrentBulkLoader = new ConcurrentBulkLoader();
