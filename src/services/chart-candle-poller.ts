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

    const marketOpen = isSymbolMarketOpen(symbol);

    try {
      const dbTimeframe = appTimeframeToDb(timeframe);

      // Fetch the most recent 3 candles to detect updates and new candles
      // Wrapped with database resilience for retry and caching
      const { data, error } = await databaseResilienceWrapper.query(
        () => supabase
          .from('forex_candles_best')
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

      // CRITICAL FIX: Check if candles array is empty (all candles rejected by validation)
      if (candles.length === 0) {
        logger.error(LogCategory.CHART_POLLER, `[ChartPoller] ❌ No valid candles for ${symbol} ${timeframe} after validation - all ${data.length} candles rejected`);
        return; // Don't update cache or notify listeners
      }

      const latestCandle = candles[candles.length - 1];
      const hasNewData = cache.lastCandleTime === null || latestCandle.time > cache.lastCandleTime;

      // CRITICAL FIX: Fetch forming candle from realtime_prices BEFORE stale detection
      // Only poll for forming candle when market is open — no live ticks when closed
      const formingCandle = marketOpen ? await this.pollFormingCandle(symbol, timeframe, cache, data) : null;
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

          // If we've seen the same candle 200+ times AND no forming candle, stop notifying listeners.
          // 200 polls × 3s = 600s = 10 minutes. This is long enough to survive between candles
          // on any timeframe (M1=60s, M5=300s, M15=900s) without false suppression.
          if (staleTracker.staleCount >= 200) {
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

      // CCIP-2026-04-02 (FORMING-CANDLE-CLOCK-SKEW):
      // ROOT CAUSE: Date.now() is client browser time, which can diverge from broker/server
      // time. This caused the candle boundary query to start at the wrong UTC offset, pulling
      // ticks from the wrong period and rendering a stale or misaligned forming candle.
      //
      // FIX: Derive the candle boundary from the latest broker_time in realtime_prices for this
      // symbol. broker_time is authoritative server-side time. We align the boundary to the
      // timeframe grid using that timestamp, ensuring the query window always matches the actual
      // market candle period regardless of the client's local clock.
      //
      // SSOT ALIGNMENT: candle-data-service.ts:aggregatePricesToCurrentCandle already uses
      // broker_time for all its internal calculations — this fix brings pollFormingCandle into
      // alignment with that contract.

      // Step 1: Get the most recent broker_time for this symbol to anchor the candle boundary
      const { data: latestTick, error: latestTickError } = await supabase
        .from('realtime_prices')
        .select('broker_time, created_at')
        .eq('symbol', symbol)
        .order('broker_time', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Step 2: Derive candle boundary from broker_time (authoritative) or fall back to Date.now()
      let anchorTimeMs: number;
      if (!latestTickError && latestTick) {
        anchorTimeMs = new Date(latestTick.broker_time || latestTick.created_at).getTime();
        console.log(`[ChartPoller] 🔍 Using broker_time anchor for ${symbol}: ${new Date(anchorTimeMs).toISOString()}`);
      } else {
        anchorTimeMs = Date.now();
        console.warn(`[ChartPoller] ⚠️ No broker_time available for ${symbol}, falling back to Date.now() — candle boundary may be approximate`);
      }

      const currentCandleStartMs = Math.floor(anchorTimeMs / intervalMs) * intervalMs;
      const currentCandleStart = new Date(currentCandleStartMs);

      console.log(`[ChartPoller] 🔍 Forming candle query: ${symbol} ${timeframe} since ${currentCandleStart.toISOString()}`);

      // Fetch all ticks since current candle start using broker_time for consistent alignment
      const { data: prices, error: pricesError } = await supabase
        .from('realtime_prices')
        .select('bid, ask, created_at, broker_time')
        .eq('symbol', symbol)
        .gte('broker_time', currentCandleStart.toISOString())
        .order('broker_time', { ascending: true });

      if (pricesError) {
        console.error(`[ChartPoller] ❌ Error fetching forming candle ticks:`, pricesError);
        return null;
      }

      if (!prices || prices.length === 0) {
        console.log(`[ChartPoller] ⚠️ No ticks in current period for ${symbol} since ${currentCandleStart.toISOString()} - trying recent fallback`);

        const lookbackMs = intervalMs * 3;
        const { data: recentTick, error: recentError } = await supabase
          .from('realtime_prices')
          .select('bid, ask, created_at, broker_time')
          .eq('symbol', symbol)
          .gte('broker_time', new Date(anchorTimeMs - lookbackMs).toISOString())
          .order('broker_time', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (recentError || !recentTick) {
          console.log(`[ChartPoller] ⚠️ No recent ticks found for ${symbol} - no forming candle`);
          return null;
        }

        const mid = (parseFloat(recentTick.bid) + parseFloat(recentTick.ask)) / 2;
        console.log(`[ChartPoller] 📍 Using most-recent tick as forming candle anchor for ${symbol}: ${mid.toFixed(5)}`);
        return sanitizeCandleData({
          time: Math.floor(currentCandleStartMs / 1000),
          open: mid,
          high: mid,
          low: mid,
          close: mid,
          symbol
        });
      }

      console.log(`[ChartPoller] ✅ Found ${prices.length} ticks for forming candle between ${prices[0].created_at} and ${prices[prices.length - 1].created_at}`);

      // CCIP-2026-03-13d (FORMING-CANDLE-VALIDATION-GAP):
      // ROOT CAUSE: pollFormingCandle() aggregated raw realtime_prices ticks directly using
      // Math.max/Math.min with no per-tick outlier filter and no candle-level range guard.
      // A single corrupted bid/ask row in realtime_prices (stale price, decimal shift, feed
      // glitch) inflated the forming candle's high or low by hundreds of pips, rendering as
      // visually massive wicks on ALL pairs and ALL timeframes simultaneously.
      //
      // SSOT ALIGNMENT: Three services share the same 5% extreme-range contract:
      //   1. candle-data-service.ts:438 (historical candle loading)
      //   2. current-candle-reconstructor.ts:224 (tick-based reconstruction)
      //   3. THIS FILE — now added to close the validation bypass (Layer 2+3)
      //
      // FIX LAYERS:
      //   Layer 1 — Per-tick outlier filter: reject individual ticks whose mid-price
      //             deviates > 2% from the median of all ticks in this poll batch.
      //             This prevents a single corrupted row from skewing high/low before
      //             the candle-level check even runs.
      //   Layer 2 — Candle-level 5% range guard: after aggregation, if the resulting
      //             high-low range exceeds 5% of the mid-price, reject the entire forming
      //             candle and return null. Same threshold as candle-data-service.ts:438.
      //
      // INVARIANTS (must never be violated):
      //   I1. Every candle reaching the chart via this path must pass the 5% range check.
      //   I2. Per-tick median filter threshold (2%) < candle range threshold (5%).
      //       This ensures a heavily-filtered batch still cannot produce a 5%-range candle
      //       from legitimate tick variance alone under normal market conditions.
      //   I3. If ALL ticks are filtered out, return null (no forming candle) rather than
      //       invent a value. Silence is preferable to a corrupt rendering.
      //
      // ROLLBACK: If this rejects valid high-volatility candles (news events >5% move),
      //   raise FORMING_CANDLE_MAX_RANGE_PCT in lockstep with the thresholds in
      //   candle-data-service.ts and current-candle-reconstructor.ts (all three must agree).

      const FORMING_CANDLE_MAX_RANGE_PCT = 5;
      const TICK_OUTLIER_MAX_DEVIATION_PCT = 2;

      // Layer 1: per-tick outlier filter — compute median and reject outlier ticks
      const rawMidPrices = prices.map(p => (parseFloat(p.bid) + parseFloat(p.ask)) / 2);
      const sorted = [...rawMidPrices].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const cleanMidPrices = rawMidPrices.filter(mid => {
        const deviationPct = Math.abs(mid - median) / median * 100;
        return deviationPct <= TICK_OUTLIER_MAX_DEVIATION_PCT;
      });

      const rejectedCount = rawMidPrices.length - cleanMidPrices.length;
      if (rejectedCount > 0) {
        console.warn(`[ChartPoller] CCIP-2026-03-13d: Filtered ${rejectedCount}/${rawMidPrices.length} outlier ticks for ${symbol} ${timeframe} (median=${median.toFixed(5)}, threshold=${TICK_OUTLIER_MAX_DEVIATION_PCT}%)`);
      }

      if (cleanMidPrices.length === 0) {
        console.warn(`[ChartPoller] CCIP-2026-03-13d: All ticks rejected as outliers for ${symbol} ${timeframe} — returning null (I3)`);
        return null;
      }

      // Aggregate clean ticks into forming candle
      const formingCandle = {
        time: Math.floor(currentCandleStartMs / 1000),
        open: cleanMidPrices[0],
        high: Math.max(...cleanMidPrices),
        low: Math.min(...cleanMidPrices),
        close: cleanMidPrices[cleanMidPrices.length - 1],
        volume: prices.length,
        symbol
      };

      // Layer 2: candle-level 5% extreme range guard — same contract as candle-data-service.ts:438
      const candleRange = formingCandle.high - formingCandle.low;
      const avgPrice = (formingCandle.open + formingCandle.close) / 2;
      const rangePercent = avgPrice > 0 ? (candleRange / avgPrice) * 100 : 0;

      if (rangePercent > FORMING_CANDLE_MAX_RANGE_PCT) {
        console.warn(
          `[ChartPoller] CCIP-2026-03-13d: REJECTED forming candle for ${symbol} ${timeframe}: ` +
          `extreme range ${rangePercent.toFixed(2)}% > ${FORMING_CANDLE_MAX_RANGE_PCT}% ` +
          `(O:${formingCandle.open.toFixed(5)} H:${formingCandle.high.toFixed(5)} L:${formingCandle.low.toFixed(5)} C:${formingCandle.close.toFixed(5)})`
        );
        return null;
      }

      console.log(`[ChartPoller] Forming candle for ${symbol} ${timeframe}:`, {
        ticks: cleanMidPrices.length,
        open: formingCandle.open.toFixed(5),
        high: formingCandle.high.toFixed(5),
        low: formingCandle.low.toFixed(5),
        close: formingCandle.close.toFixed(5),
        rangePct: rangePercent.toFixed(3)
      });

      // Return sanitized forming candle with null safety
      if (typeof formingCandle.time === 'undefined') {
        console.warn(`[ChartPoller] ⚠️ Forming candle missing time property, skipping`);
        return null;
      }
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
