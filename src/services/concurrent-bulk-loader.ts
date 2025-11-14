import { supabase } from '../lib/supabase';
import { candleCacheManager } from './candle-cache-manager';

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
    { symbol: 'XAUUSD', timeframe: 'M1', candleCount: 300, priority: 1 },
    { symbol: 'XAUUSD', timeframe: 'M5', candleCount: 500, priority: 1 },
    { symbol: 'XAUUSD', timeframe: 'H1', candleCount: 200, priority: 1 }
  ],
  [
    { symbol: 'US30', timeframe: 'M1', candleCount: 300, priority: 2 },
    { symbol: 'US30', timeframe: 'M5', candleCount: 500, priority: 2 },
    { symbol: 'US30', timeframe: 'H1', candleCount: 200, priority: 2 }
  ],
  [
    { symbol: 'EURUSD', timeframe: 'M1', candleCount: 300, priority: 3 },
    { symbol: 'EURUSD', timeframe: 'M5', candleCount: 500, priority: 3 },
    { symbol: 'EURUSD', timeframe: 'H1', candleCount: 200, priority: 3 }
  ],
  [
    { symbol: 'GBPUSD', timeframe: 'M1', candleCount: 300, priority: 4 },
    { symbol: 'GBPUSD', timeframe: 'M5', candleCount: 500, priority: 4 },
    { symbol: 'GBPUSD', timeframe: 'H1', candleCount: 200, priority: 4 }
  ],
  [
    { symbol: 'USDJPY', timeframe: 'M1', candleCount: 300, priority: 5 },
    { symbol: 'USDJPY', timeframe: 'M5', candleCount: 500, priority: 5 },
    { symbol: 'USDJPY', timeframe: 'H1', candleCount: 200, priority: 5 }
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
          await this.upsertCandles(cached.candles);
          this.updateCacheInBackground(symbol, timeframe, candleCount);
          return true;
        }
      }

      const candles = await this.fetchCandlesWithRetry(symbol, timeframe, candleCount, onProgress);

      if (candles && candles.length > 0) {
        await this.upsertCandles(candles);

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
            console.error(`Failed to load ${batch[idx].symbol} ${batch[idx].timeframe}`);
          }
        });

        progress.currentBatch = [];
        onProgress?.(progress);

        if (progress.failed >= 3) {
          console.error('Too many failures, pausing background loading');
          break;
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

  private async fetchCandlesWithRetry(
    symbol: string,
    timeframe: string,
    count: number,
    onProgress?: (loaded: number, total: number) => void,
    retryCount = 0
  ): Promise<any[]> {
    try {
      console.log(`[BulkLoader] Loading ${symbol} ${timeframe} directly from database...`);

      // Convert app timeframe to database format (M5 -> 5m, H1 -> 1h)
      const dbTimeframe = timeframe.replace(/^M/, '').replace(/^H/, '').toLowerCase() +
                          (timeframe.startsWith('M') ? 'm' : timeframe.startsWith('H') ? 'h' : '');

      const { data: candles, error } = await supabase
        .from('forex_candles')
        .select('open_time, close_time, open, high, low, close, volume, tick_volume, spread')
        .eq('symbol', symbol)
        .eq('timeframe', dbTimeframe)
        .order('open_time', { ascending: false })
        .limit(count);

      if (error) {
        console.error(`[BulkLoader] Database error for ${symbol} ${timeframe}:`, error);
        throw new Error(`Database query failed: ${error.message}`);
      }

      if (!candles || candles.length === 0) {
        console.warn(`[BulkLoader] No candles found for ${symbol} ${timeframe} (db: ${dbTimeframe})`);
        return [];
      }

      console.log(`[BulkLoader] Loaded ${candles.length} candles for ${symbol} ${timeframe} from database`);
      onProgress?.(candles.length, count);

      // Reverse to get chronological order (oldest first)
      const chronologicalCandles = candles.reverse();

      return chronologicalCandles.map((c: any) => ({
        symbol,
        timeframe: dbTimeframe,
        open_time: c.open_time,
        close_time: c.close_time || c.open_time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume || 0,
        tick_volume: c.tick_volume || 0,
        spread: c.spread || 0
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

  private async upsertCandles(candles: any[]): Promise<void> {
    if (candles.length === 0) return;

    const { error } = await supabase
      .from('forex_candles')
      .upsert(candles, {
        onConflict: 'symbol,timeframe,open_time',
        ignoreDuplicates: false
      });

    if (error) {
      throw new Error(`Failed to upsert candles: ${error.message}`);
    }
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
      case 'M1': return 300;
      case 'M5': return 500;
      case 'H1': return 200;
      case 'H4': return 168;
      case 'D1': return 90;
      default: return 300;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const concurrentBulkLoader = new ConcurrentBulkLoader();
