import { supabase } from '@/lib/supabase';
import { Timeframe, appTimeframeToDb } from '@/services/chart-preferences';
import { CandleData } from '@/services/candle-data-service';
import { logger, LogCategory } from '@/lib/logger';

interface PollResult {
  candles: CandleData[];
  hasNewData: boolean;
  latestCandleTime: number | null;
}

interface CandleCache {
  symbol: string;
  timeframe: Timeframe;
  lastCandleTime: number | null;
  lastPollTime: number;
  candles: CandleData[];
  fullHistoricalCandles: CandleData[]; // Store full chart data for instant restoration
}

class ChartCandlePoller {
  private cache: Map<string, CandleCache> = new Map();
  private pollIntervals: Map<string, NodeJS.Timeout> = new Map();
  private listeners: Map<string, Set<(result: PollResult) => void>> = new Map();
  private readonly POLL_INTERVAL_MS = 2000; // 2 seconds
  private readonly CACHE_STALE_MS = 5000; // Consider cache stale after 5 seconds
  private isPollingActive = true;

  private getCacheKey(symbol: string, timeframe: Timeframe): string {
    return `${symbol}_${timeframe}`;
  }

  async startPolling(symbol: string, timeframe: Timeframe): Promise<void> {
    const key = this.getCacheKey(symbol, timeframe);

    if (this.pollIntervals.has(key)) {
      logger.debug(LogCategory.CHART_POLLER, `Already polling ${symbol} ${timeframe}`);
      return;
    }

    logger.debug(LogCategory.CHART_POLLER, `Starting polling for ${symbol} ${timeframe} (every ${this.POLL_INTERVAL_MS}ms)`);

    // Initialize cache
    this.cache.set(key, {
      symbol,
      timeframe,
      lastCandleTime: null,
      lastPollTime: 0,
      candles: [],
      fullHistoricalCandles: []
    });

    // Initial poll
    await this.pollCandles(symbol, timeframe);

    // Set up interval
    const interval = setInterval(async () => {
      if (this.isPollingActive) {
        await this.pollCandles(symbol, timeframe);
      }
    }, this.POLL_INTERVAL_MS);

    this.pollIntervals.set(key, interval);
  }

  stopPolling(symbol: string, timeframe: Timeframe): void {
    const key = this.getCacheKey(symbol, timeframe);
    const interval = this.pollIntervals.get(key);

    if (interval) {
      clearInterval(interval);
      this.pollIntervals.delete(key);
      logger.debug(LogCategory.CHART_POLLER, `Stopped polling ${symbol} ${timeframe}`);
    }

    this.cache.delete(key);
    this.listeners.delete(key);
  }

  private async pollCandles(symbol: string, timeframe: Timeframe): Promise<void> {
    const key = this.getCacheKey(symbol, timeframe);
    const cache = this.cache.get(key);

    if (!cache) {
      console.warn(`[ChartPoller] No cache found for ${key}`);
      return;
    }

    try {
      const dbTimeframe = appTimeframeToDb(timeframe);

      // Fetch the most recent 3 candles to detect updates and new candles
      const { data, error } = await supabase
        .from('forex_candles')
        .select('open_time, close_time, open, high, low, close, volume')
        .eq('symbol', symbol)
        .eq('timeframe', dbTimeframe)
        .order('open_time', { ascending: false })
        .limit(3);

      if (error) {
        console.error(`[ChartPoller] Error fetching candles for ${symbol} ${timeframe}:`, error);
        return;
      }

      if (!data || data.length === 0) {
        logger.debug(LogCategory.CHART_POLLER, `No candles found for ${symbol} ${timeframe}`);
        return;
      }

      // Convert database format to chart format with deduplication
      const candleMap = new Map<number, CandleData>();

      data.forEach(candle => {
        const timestamp = Math.floor(new Date(candle.open_time).getTime() / 1000);
        // Keep only the most recent entry for each timestamp (first in descending order)
        if (!candleMap.has(timestamp)) {
          candleMap.set(timestamp, {
            time: timestamp,
            open: parseFloat(candle.open),
            high: parseFloat(candle.high),
            low: parseFloat(candle.low),
            close: parseFloat(candle.close),
            volume: parseFloat(candle.volume || '0')
          });
        }
      });

      // Convert to array and sort ascending
      const candles: CandleData[] = Array.from(candleMap.values())
        .sort((a, b) => a.time - b.time);

      if (data.length !== candles.length) {
        logger.debug(LogCategory.CHART_POLLER, `Deduplicated ${data.length - candles.length} overlapping candles for ${symbol} ${timeframe}`);
      }

      const latestCandle = candles[candles.length - 1];
      const hasNewData = cache.lastCandleTime === null || latestCandle.time > cache.lastCandleTime;

      if (hasNewData) {
        console.log(
          `[ChartPoller] ${symbol} ${timeframe} - New candle detected at ${new Date(latestCandle.time * 1000).toLocaleTimeString()}`
        );
      }

      // Update cache
      cache.lastCandleTime = latestCandle.time;
      cache.lastPollTime = Date.now();
      cache.candles = candles;

      // If we have a new completed candle and we're tracking full historical candles, append it
      if (hasNewData && cache.fullHistoricalCandles.length > 0) {
        // Check if this is truly a new candle (not already in our historical cache)
        const lastHistoricalTime = cache.fullHistoricalCandles[cache.fullHistoricalCandles.length - 1].time;
        if (latestCandle.time > lastHistoricalTime) {
          cache.fullHistoricalCandles.push(latestCandle);
          // Keep the cache manageable - limit to 500 candles
          if (cache.fullHistoricalCandles.length > 500) {
            cache.fullHistoricalCandles = cache.fullHistoricalCandles.slice(-300);
          }
          logger.debug(LogCategory.CHART_POLLER, `Updated historical cache with new candle, now ${cache.fullHistoricalCandles.length} candles`);
        }
      }

      // Notify listeners
      const result: PollResult = {
        candles,
        hasNewData,
        latestCandleTime: latestCandle.time
      };

      this.notifyListeners(key, result);
    } catch (error) {
      console.error(`[ChartPoller] Error in poll for ${symbol} ${timeframe}:`, error);
    }
  }

  private notifyListeners(key: string, result: PollResult): void {
    const listeners = this.listeners.get(key);
    if (!listeners) return;

    listeners.forEach(listener => {
      try {
        listener(result);
      } catch (error) {
        console.error('[ChartPoller] Error in listener callback:', error);
      }
    });
  }

  onUpdate(
    symbol: string,
    timeframe: Timeframe,
    callback: (result: PollResult) => void
  ): () => void {
    const key = this.getCacheKey(symbol, timeframe);

    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }

    this.listeners.get(key)!.add(callback);

    return () => {
      const listeners = this.listeners.get(key);
      if (listeners) {
        listeners.delete(callback);
      }
    };
  }

  getLatestCandle(symbol: string, timeframe: Timeframe): CandleData | null {
    const key = this.getCacheKey(symbol, timeframe);
    const cache = this.cache.get(key);

    if (!cache || cache.candles.length === 0) {
      return null;
    }

    return cache.candles[cache.candles.length - 1];
  }

  getCachedCandles(symbol: string, timeframe: Timeframe): CandleData[] {
    const key = this.getCacheKey(symbol, timeframe);
    const cache = this.cache.get(key);

    // Return full historical candles if available, otherwise return recent candles
    if (cache?.fullHistoricalCandles && cache.fullHistoricalCandles.length > 0) {
      return cache.fullHistoricalCandles;
    }

    return cache?.candles || [];
  }

  setFullHistoricalCandles(symbol: string, timeframe: Timeframe, candles: CandleData[]): void {
    const key = this.getCacheKey(symbol, timeframe);
    const cache = this.cache.get(key);

    // Validate that all candles have proper time format (numbers, not objects)
    const validatedCandles = candles.filter(candle => {
      if (typeof candle.time !== 'number' || isNaN(candle.time)) {
        console.error(`[ChartPoller] Filtering out invalid candle with time:`, {
          time: candle.time,
          type: typeof candle.time
        });
        return false;
      }
      return true;
    });

    if (validatedCandles.length !== candles.length) {
      console.warn(`[ChartPoller] Filtered out ${candles.length - validatedCandles.length} candles with invalid time format`);
    }

    if (cache) {
      cache.fullHistoricalCandles = validatedCandles;
      logger.debug(LogCategory.CHART_POLLER, `Cached ${validatedCandles.length} historical candles for ${symbol} ${timeframe}`);
    } else {
      // If cache doesn't exist yet, create it with the historical data
      this.cache.set(key, {
        symbol,
        timeframe,
        lastCandleTime: validatedCandles.length > 0 ? validatedCandles[validatedCandles.length - 1].time : null,
        lastPollTime: Date.now(),
        candles: validatedCandles.slice(-3), // Keep last 3 for quick updates
        fullHistoricalCandles: validatedCandles
      });
      logger.debug(LogCategory.CHART_POLLER, `Created cache with ${validatedCandles.length} historical candles for ${symbol} ${timeframe}`);
    }
  }

  isCacheStale(symbol: string, timeframe: Timeframe): boolean {
    const key = this.getCacheKey(symbol, timeframe);
    const cache = this.cache.get(key);

    if (!cache) return true;

    const timeSinceLastPoll = Date.now() - cache.lastPollTime;
    return timeSinceLastPoll > this.CACHE_STALE_MS;
  }

  pause(): void {
    logger.debug(LogCategory.CHART_POLLER, 'Pausing all polling');
    this.isPollingActive = false;
  }

  resume(): void {
    logger.debug(LogCategory.CHART_POLLER, 'Resuming all polling');
    this.isPollingActive = true;

    // Immediately poll all active subscriptions
    this.cache.forEach((cache, key) => {
      this.pollCandles(cache.symbol, cache.timeframe);
    });
  }

  getStatus() {
    return {
      activePolls: this.pollIntervals.size,
      isActive: this.isPollingActive,
      cacheEntries: this.cache.size,
      pollInterval: this.POLL_INTERVAL_MS
    };
  }

  async forceRefresh(symbol: string, timeframe: Timeframe): Promise<void> {
    logger.debug(LogCategory.CHART_POLLER, `Force refreshing ${symbol} ${timeframe}`);
    await this.pollCandles(symbol, timeframe);
  }

  shutdown(): void {
    logger.info(LogCategory.CHART_POLLER, 'Shutting down all polling');

    this.pollIntervals.forEach((interval, key) => {
      clearInterval(interval);
    });

    this.pollIntervals.clear();
    this.cache.clear();
    this.listeners.clear();
    this.isPollingActive = false;
  }
}

export const chartCandlePoller = new ChartCandlePoller();
