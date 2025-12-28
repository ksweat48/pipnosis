import { supabase } from '@/lib/supabase';
import { Timeframe, appTimeframeToDb } from '@/services/chart-preferences';
import { CandleData, sanitizeCandleData, sanitizeCandleArray, ensureUnixTimestamp, getTimeframeMinutes } from '@/services/candle-data-service';
import { logger, LogCategory } from '@/lib/logger';
import { priceValidationService } from './price-validation-service';
import { validateSymbol, ValidatedSymbol } from '@/types/symbol';
import { chartCircuitBreaker } from './chart-circuit-breaker';
import { databaseResilienceWrapper } from './database-resilience-wrapper';
import { chartMemoryManager } from './chart-memory-manager';
import { getForexMarketStatus, isSymbolMarketOpen } from '@/utils/marketHours';

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
  private readonly POLL_INTERVAL_MS = 3000; // 3 seconds - unified with DirectPoller
  private readonly CACHE_STALE_MS = 5000; // Consider cache stale after 5 seconds
  private isPollingActive = true;
  private memoryManagerRegistered = false;
  private marketHoursCheckInterval: NodeJS.Timeout | null = null;
  private lastMarketStatus: boolean = true;
  private staleDataTracker: Map<string, { lastCandleTime: number; staleCount: number }> = new Map();

  constructor() {
    // Register cache with memory manager for automatic cleanup
    this.registerWithMemoryManager();
    // Start monitoring market hours
    this.startMarketHoursMonitoring();
  }

  private registerWithMemoryManager(): void {
    if (this.memoryManagerRegistered) return;

    chartMemoryManager.registerCache({
      id: 'chart-candle-poller',
      getSize: () => {
        let total = 0;
        for (const cache of this.cache.values()) {
          total += cache.candles.length + cache.fullHistoricalCandles.length;
        }
        return total;
      },
      clear: () => {
        this.cache.clear();
      },
      prune: (limit: number) => {
        let pruned = 0;
        for (const cache of this.cache.values()) {
          const before = cache.fullHistoricalCandles.length;
          if (before > limit) {
            cache.fullHistoricalCandles = cache.fullHistoricalCandles.slice(-limit);
            pruned += before - limit;
          }
        }
        return pruned;
      },
    });

    this.memoryManagerRegistered = true;
  }

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

    // CRYPTO FIX: Check if this specific symbol's market is open (crypto trades 24/7)
    if (!isSymbolMarketOpen(symbol)) {
      logger.debug(LogCategory.CHART_POLLER, `[ChartPoller] Market closed for ${symbol} - skipping poll`);
      return;
    }

    try {
      const dbTimeframe = appTimeframeToDb(timeframe);

      // Fetch the most recent 3 candles to detect updates and new candles
      // Wrapped with database resilience for retry and caching
      const { data, error } = await databaseResilienceWrapper.query(
        () => supabase
          .from('forex_candles')
          .select('open_time, close_time, open, high, low, close, volume')
          .eq('symbol', symbol)
          .eq('timeframe', dbTimeframe)
          .order('open_time', { ascending: false })
          .limit(3),
        {
          cacheKey: `chart-poller:${symbol}:${timeframe}`,
          cacheDuration: 2000, // 2 seconds
        }
      );

      if (error) {
        console.error(`[ChartPoller] Error fetching candles for ${symbol} ${timeframe}:`, error);
        return;
      }

      if (!data || data.length === 0) {
        logger.debug(LogCategory.CHART_POLLER, `No candles found for ${symbol} ${timeframe}`);
        return;
      }

      // Convert database format to chart format with deduplication
      // CRITICAL: Sanitize IMMEDIATELY after database query to prevent Date objects
      const candleMap = new Map<number, CandleData>();

      data.forEach(candle => {
        // CRITICAL: Validate symbol before processing any data
        const symbolValidation = validateSymbol(symbol);
        if (!symbolValidation.isValid || !symbolValidation.symbol) {
          logger.error(LogCategory.CHART_POLLER, `[ChartPoller] ❌ INVALID SYMBOL: ${symbol}`);
          return;
        }
        const validatedSymbol = symbolValidation.symbol;

        // CRITICAL FIX: Use robust timestamp converter to handle ALL data types from Supabase
        // open_time could be: Date object, ISO string, or already a number
        const timestamp = ensureUnixTimestamp(candle.open_time, 'ChartPoller');

        // CRITICAL: Create raw candle object then sanitize it
        const rawCandle = {
          time: timestamp,
          open: parseFloat(candle.open),
          high: parseFloat(candle.high),
          low: parseFloat(candle.low),
          close: parseFloat(candle.close),
          volume: parseFloat(candle.volume || '0')
        };

        // Sanitize to ensure all values are primitive numbers
        const sanitizedCandle = sanitizeCandleData(rawCandle);

        // CRITICAL: Validate candle prices before accepting
        // Skip velocity validation for database-sourced historical candles
        const validation = priceValidationService.validateCandle(symbol, {
          open: sanitizedCandle.open,
          high: sanitizedCandle.high,
          low: sanitizedCandle.low,
          close: sanitizedCandle.close
        }, true); // skipVelocity = true for database candles

        if (!validation.isValid) {
          logger.error(LogCategory.CHART_POLLER, `[ChartPoller] ❌ REJECTED invalid candle for ${symbol}: ${validation.reason}`);

          // Check for possible cross-contamination
          const mismatchSymbol = priceValidationService.detectPossibleSymbolMismatch(symbol, sanitizedCandle.close);
          if (mismatchSymbol) {
            chartCircuitBreaker.recordContamination(
              mismatchSymbol as ValidatedSymbol,
              validatedSymbol,
              'ChartCandlePoller.pollCandles',
              { candle: sanitizedCandle, dbRecord: candle }
            );
          }

          return; // Skip this candle
        }

        // FINAL CHECK: Circuit breaker - reject if updates not allowed
        if (!chartCircuitBreaker.isUpdateAllowed(validatedSymbol)) {
          logger.error(
            LogCategory.CHART_POLLER,
            `[ChartPoller] 🔴 CIRCUIT BREAKER OPEN - Updates blocked for ${symbol}`
          );
          return;
        }

        // Keep only the most recent entry for each timestamp (first in descending order)
        if (!candleMap.has(sanitizedCandle.time)) {
          candleMap.set(sanitizedCandle.time, sanitizedCandle);
        }
      });

      // Convert to array and sort ascending
      let candles: CandleData[] = Array.from(candleMap.values())
        .sort((a, b) => a.time - b.time);

      // CRITICAL: Sanitize the entire array as a final safeguard
      candles = sanitizeCandleArray(candles);

      // Log the first candle to verify types
      if (candles.length > 0) {
        console.log(`[ChartPoller] First candle type check for ${symbol}:`, {
          time: candles[0].time,
          timeType: typeof candles[0].time,
          isObject: typeof candles[0].time === 'object',
          value: candles[0].time
        });
      }

      if (data.length !== candles.length) {
        logger.debug(LogCategory.CHART_POLLER, `Deduplicated ${data.length - candles.length} overlapping candles for ${symbol} ${timeframe}`);
      }

      const latestCandle = candles[candles.length - 1];
      const hasNewData = cache.lastCandleTime === null || latestCandle.time > cache.lastCandleTime;

      // CRITICAL FIX: Fetch forming candle from realtime_prices BEFORE stale detection
      // This ensures we detect live activity and merge it with historical data
      const formingCandle = await this.pollFormingCandle(symbol, timeframe, cache, data);
      const hasFormingCandle = formingCandle !== null;

      // Track stale data to prevent wasteful notifications during market closure
      const staleKey = `${symbol}_${timeframe}`;
      const staleTracker = this.staleDataTracker.get(staleKey) || { lastCandleTime: 0, staleCount: 0 };

      // CRITICAL FIX: Check for forming candle activity BEFORE incrementing stale counter
      // This prevents suppression during active trading when historical candles haven't updated yet
      if (latestCandle.time === staleTracker.lastCandleTime) {
        // Only increment stale counter if there's NO forming candle activity
        if (!hasFormingCandle) {
          staleTracker.staleCount++;
          this.staleDataTracker.set(staleKey, staleTracker);

          // If we've seen the same candle 10+ times AND no forming candle, stop notifying listeners
          if (staleTracker.staleCount >= 10) {
            logger.debug(LogCategory.CHART_POLLER, `[ChartPoller] Stale data detected for ${symbol} ${timeframe} - suppressing notifications`);
            return; // Don't update cache or notify listeners
          }
        } else {
          // Market is active with forming candle - reset stale counter
          staleTracker.staleCount = 0;
          this.staleDataTracker.set(staleKey, staleTracker);
          logger.debug(LogCategory.CHART_POLLER, `[ChartPoller] Live forming candle detected for ${symbol} - resetting stale counter`);
        }
      } else {
        // New historical candle detected - reset stale counter
        this.staleDataTracker.set(staleKey, { lastCandleTime: latestCandle.time, staleCount: 0 });
      }

      // CRITICAL FIX: Merge forming candle with historical candles
      if (hasFormingCandle) {
        // Check if forming candle time matches any existing historical candle
        const existingIndex = candles.findIndex(c => c.time === formingCandle.time);

        if (existingIndex !== -1) {
          // Replace historical candle with forming candle (live update)
          candles[existingIndex] = formingCandle;
          console.log(`[ChartPoller] 🔄 Replaced historical candle at index ${existingIndex} with forming candle for ${symbol}`);
        } else {
          // Append forming candle to array
          candles.push(formingCandle);
          console.log(`[ChartPoller] ➕ Appended forming candle to ${symbol} candles (now ${candles.length} total)`);
        }

        // Ensure proper sorting after merge
        candles.sort((a, b) => a.time - b.time);
      }

      if (hasNewData) {
        console.log(
          `[ChartPoller] ${symbol} ${timeframe} - New candle detected at ${new Date(latestCandle.time * 1000).toLocaleTimeString()}`
        );
      }

      // CRITICAL FIX: Update hasNewData if we have a forming candle
      // This ensures chart updates even when historical candles haven't changed
      const hasNewOrFormingData = hasNewData || hasFormingCandle;

      // Update cache with final merged candles
      const finalLatestCandle = candles[candles.length - 1];
      cache.lastCandleTime = finalLatestCandle.time;
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

      // Notify listeners with merged dataset
      // CRITICAL: Sanitize candles one more time before notifying to ensure no objects slip through
      const sanitizedForNotification = sanitizeCandleArray(candles);

      const result: PollResult = {
        candles: sanitizedForNotification,
        hasNewData: hasNewOrFormingData,
        latestCandleTime: finalLatestCandle.time
      };

      console.log(`[ChartPoller] 📡 Notifying listeners for ${symbol} with ${sanitizedForNotification.length} candles (${hasFormingCandle ? 'including forming candle' : 'historical only'}):`, {
        firstTime: sanitizedForNotification[0]?.time,
        firstTimeType: typeof sanitizedForNotification[0]?.time,
        lastTime: sanitizedForNotification[sanitizedForNotification.length - 1]?.time,
        lastTimeType: typeof sanitizedForNotification[sanitizedForNotification.length - 1]?.time,
        hasFormingCandle
      });

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
    let candles: CandleData[] = [];

    if (cache?.fullHistoricalCandles && cache.fullHistoricalCandles.length > 0) {
      candles = cache.fullHistoricalCandles;
    } else if (cache?.candles) {
      candles = cache.candles;
    }

    // CRITICAL: Sanitize before returning to prevent any cached Date objects
    if (candles.length > 0) {
      console.log(`[ChartPoller] getCachedCandles for ${symbol}: returning ${candles.length} candles`);
      console.log(`[ChartPoller] First cached candle type:`, {
        time: candles[0].time,
        timeType: typeof candles[0].time,
        isObject: typeof candles[0].time === 'object'
      });

      const sanitized = sanitizeCandleArray(candles);

      console.log(`[ChartPoller] After sanitization:`, {
        time: sanitized[0].time,
        timeType: typeof sanitized[0].time,
        isObject: typeof sanitized[0].time === 'object'
      });

      return sanitized;
    }

    return [];
  }

  setFullHistoricalCandles(symbol: string, timeframe: Timeframe, candles: CandleData[]): void {
    const key = this.getCacheKey(symbol, timeframe);
    const cache = this.cache.get(key);

    // CRITICAL: SANITIZE all incoming candles to convert any Date objects to numbers
    console.log(`[ChartPoller] setFullHistoricalCandles called with ${candles.length} candles`);
    console.log(`[ChartPoller] First candle before sanitization:`, {
      time: candles[0]?.time,
      timeType: typeof candles[0]?.time,
      isObject: typeof candles[0]?.time === 'object'
    });

    const sanitizedCandles = sanitizeCandleArray(candles);

    console.log(`[ChartPoller] After sanitization: ${sanitizedCandles.length} candles, first:`, {
      time: sanitizedCandles[0]?.time,
      timeType: typeof sanitizedCandles[0]?.time,
      isObject: typeof sanitizedCandles[0]?.time === 'object'
    });

    // Additional validation after sanitization
    const validatedCandles = sanitizedCandles.filter(candle => {
      if (typeof candle.time !== 'number' || isNaN(candle.time)) {
        console.error(`[ChartPoller] Filtering out invalid candle after sanitization:`, {
          time: candle.time,
          type: typeof candle.time
        });
        return false;
      }
      return true;
    });

    if (validatedCandles.length !== sanitizedCandles.length) {
      console.warn(`[ChartPoller] Filtered out ${sanitizedCandles.length - validatedCandles.length} candles with invalid time format after sanitization`);
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

  private startMarketHoursMonitoring(): void {
    // Check market hours every 5 minutes
    const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

    // Initial check
    const initialStatus = getForexMarketStatus();
    this.lastMarketStatus = initialStatus.isOpen;
    logger.info(LogCategory.CHART_POLLER, `[MarketHoursMonitor] Initial forex market status: ${initialStatus.status}`);
    logger.info(LogCategory.CHART_POLLER, `[MarketHoursMonitor] Crypto markets: Always Open (24/7)`);

    this.marketHoursCheckInterval = setInterval(() => {
      const currentStatus = getForexMarketStatus();
      const isMarketOpen = currentStatus.isOpen;

      // CRYPTO FIX: Detect market open/close transitions but DON'T pause/resume
      // Per-symbol checks in pollCandles() will skip closed symbols
      // This allows crypto to continue polling 24/7 even when forex is closed
      if (isMarketOpen !== this.lastMarketStatus) {
        if (!isMarketOpen) {
          // Forex market just closed - crypto continues
          logger.info(LogCategory.CHART_POLLER, '[MarketHoursMonitor] 🔴 Forex market closed (crypto continues 24/7)');
          // Clear stale data trackers for forex symbols only
          this.staleDataTracker.clear();
        } else {
          // Forex market just opened
          logger.info(LogCategory.CHART_POLLER, '[MarketHoursMonitor] 🟢 Forex market opened (crypto already active)');
          // Clear database cache to force fresh data fetch
          databaseResilienceWrapper.clearCache();
          this.staleDataTracker.clear();
        }

        this.lastMarketStatus = isMarketOpen;
      }
    }, CHECK_INTERVAL_MS);

    logger.debug(LogCategory.CHART_POLLER, `[MarketHoursMonitor] Started monitoring (checking every ${CHECK_INTERVAL_MS / 1000}s)`);
  }

  private stopMarketHoursMonitoring(): void {
    if (this.marketHoursCheckInterval) {
      clearInterval(this.marketHoursCheckInterval);
      this.marketHoursCheckInterval = null;
      logger.debug(LogCategory.CHART_POLLER, '[MarketHoursMonitor] Stopped monitoring');
    }
  }

  /**
   * BREAKTHROUGH: Poll forming candle from realtime_prices
   * This allows the chart to show live updates BEFORE the 5-minute aggregation completes
   * Returns the forming candle to be merged with historical candles
   */
  private async pollFormingCandle(symbol: string, timeframe: Timeframe, cache: CandleCache, historicalCandles: any[]): Promise<CandleData | null> {
    try {
      // Get the timeframe interval in minutes
      const timeframeMap: Record<string, number> = {
        'M1': 1, 'M5': 5, 'M15': 15, 'M30': 30, 'H1': 60, 'H4': 240, 'D1': 1440
      };
      const intervalMinutes = timeframeMap[timeframe] || 5;
      const intervalMs = intervalMinutes * 60 * 1000;

      // Calculate current candle start time
      const now = Date.now();
      const currentCandleStartMs = Math.floor(now / intervalMs) * intervalMs;
      const currentCandleStart = new Date(currentCandleStartMs);

      console.log(`[ChartPoller] 🔍 Forming candle query: ${symbol} ${timeframe} since ${currentCandleStart.toISOString()}`);

      // Fetch all ticks since current candle start
      const { data: prices, error: pricesError } = await supabase
        .from('realtime_prices')
        .select('bid, ask, created_at')
        .eq('symbol', symbol)
        .gte('created_at', currentCandleStart.toISOString())
        .order('created_at', { ascending: true });

      if (pricesError) {
        console.error(`[ChartPoller] ❌ Error fetching forming candle ticks:`, pricesError);
        return null;
      }

      if (!prices || prices.length === 0) {
        console.log(`[ChartPoller] ⚠️ No ticks found for forming candle since ${currentCandleStart.toISOString()}`);
        return null; // No forming candle data
      }

      console.log(`[ChartPoller] ✅ Found ${prices.length} ticks for forming candle between ${prices[0].created_at} and ${prices[prices.length - 1].created_at}`);

      // Aggregate ticks into forming candle
      // CRITICAL: Convert strings to numbers to prevent calculation errors
      const midPrices = prices.map(p => (parseFloat(p.bid) + parseFloat(p.ask)) / 2);
      const formingCandle = {
        time: Math.floor(currentCandleStartMs / 1000),
        open: parseFloat(midPrices[0].toString()),
        high: parseFloat(Math.max(...midPrices).toString()),
        low: parseFloat(Math.min(...midPrices).toString()),
        close: parseFloat(midPrices[midPrices.length - 1].toString()),
        volume: prices.length,
        symbol
      };

      console.log(`[ChartPoller] 🔥 Forming candle for ${symbol} ${timeframe}:`, {
        ticks: prices.length,
        open: formingCandle.open.toFixed(2),
        high: formingCandle.high.toFixed(2),
        low: formingCandle.low.toFixed(2),
        close: formingCandle.close.toFixed(2),
        range: (formingCandle.high - formingCandle.low).toFixed(2)
      });

      // Return sanitized forming candle
      const sanitizedForming = sanitizeCandleData(formingCandle);
      return sanitizedForming;
    } catch (error) {
      console.error(`[ChartPoller] Error polling forming candle:`, error);
      return null;
    }
  }

  shutdown(): void {
    logger.info(LogCategory.CHART_POLLER, 'Shutting down all polling');

    this.stopMarketHoursMonitoring();

    this.pollIntervals.forEach((interval, key) => {
      clearInterval(interval);
    });

    this.pollIntervals.clear();
    this.cache.clear();
    this.listeners.clear();
    this.isPollingActive = false;
    this.staleDataTracker.clear();
  }
}

export const chartCandlePoller = new ChartCandlePoller();
