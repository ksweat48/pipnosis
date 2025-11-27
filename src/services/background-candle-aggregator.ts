import { supabase } from '@/lib/supabase';
import { Timeframe, appTimeframeToDb } from '@/services/chart-preferences';
import { getTimeframeMinutes, CandleData } from '@/services/candle-data-service';
import { emergencyPricePoller } from '@/services/emergency-price-poller';
import { logger, LogCategory } from '@/lib/logger';

interface CandleState {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  startTime: number;
  tickCount: number;
}

interface SymbolTimeframeKey {
  symbol: string;
  timeframe: Timeframe;
}

type CandleStateMap = Map<string, CandleState>;

const ALL_TIMEFRAMES: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'];

const FOREX_PAIRS = [
  'XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'
];

class BackgroundCandleAggregator {
  private candleStates: CandleStateMap = new Map();
  private subscription: any = null;
  private isRunning = false;
  private saveQueue: Array<{ symbol: string; timeframe: Timeframe; candle: CandleData }> = [];
  private saveInProgress = false;
  private listeners: Set<(symbol: string, timeframe: Timeframe, candle: CandleData) => void> = new Set();
  private tickListeners: Set<(tick: { symbol: string; bid: number; ask: number; timestamp: string; midPrice: number }) => void> = new Set();
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 10;
  private readonly BASE_RECONNECT_DELAY = 1000;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private lastMessageTime: Date | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private readonly HEALTH_CHECK_INTERVAL_MS = 15000;
  private readonly STALE_CONNECTION_THRESHOLD_MS = 60000;
  private isConnecting = false;
  private connectionState: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';
  private lastReconnectAttemptTime: number = 0;
  private readonly MIN_RECONNECT_INTERVAL_MS = 2000;
  private circuitBreakerTripped = false;
  private isInitializing = false;

  private getCacheKey(symbol: string, timeframe: Timeframe): string {
    return `${symbol}_${timeframe}`;
  }

  private getCandleTime(timestamp: number, timeframe: Timeframe): number {
    const intervalMs = getTimeframeMinutes(timeframe) * 60 * 1000;
    return Math.floor(timestamp / intervalMs) * intervalMs;
  }

  private lastPriceCache: Map<string, number> = new Map();
  private candleFinalizerInterval: NodeJS.Timeout | null = null;
  private readonly CANDLE_FINALIZER_CHECK_INTERVAL_MS = 60000; // Check every minute

  private initializeCandleState(symbol: string, timeframe: Timeframe, price: number, timestamp: number): CandleState {
    const candleTime = this.getCandleTime(timestamp, timeframe);
    return {
      time: Math.floor(candleTime / 1000),
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 0,
      startTime: candleTime,
      tickCount: 1
    };
  }

  private updateCandleState(state: CandleState, price: number): void {
    state.high = Math.max(state.high, price);
    state.low = Math.min(state.low, price);
    state.close = price;
    state.tickCount++;
  }

  private async saveCompletedCandle(symbol: string, timeframe: Timeframe, candle: CandleState): Promise<void> {
    const openTime = new Date(candle.startTime);
    const timeframeMinutes = getTimeframeMinutes(timeframe);
    const closeTime = new Date(candle.startTime + timeframeMinutes * 60 * 1000);

    const candleRecord = {
      symbol,
      timeframe,
      open_time: openTime.toISOString(),
      close_time: closeTime.toISOString(),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume
    };

    try {
      const dbTimeframe = appTimeframeToDb(timeframe);
      const dbCandleRecord = { ...candleRecord, timeframe: dbTimeframe };

      const { error: forexError } = await supabase
        .from('forex_candles')
        .upsert(dbCandleRecord, {
          onConflict: 'symbol,timeframe,open_time',
          ignoreDuplicates: false
        });

      if (forexError) {
        console.error(`[BackgroundAggregator] Failed to save ${symbol} ${timeframe} (db: ${dbTimeframe}):`, forexError);
        return;
      }

      logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ` ✓ Saved ${symbol} ${timeframe} candle at ${openTime.toISOString()} (${candle.tickCount} ticks)`);
    } catch (error) {
      console.error(`[BackgroundAggregator] Error saving ${symbol} ${timeframe}:`, error);
    }
  }

  private async processSaveQueue(): Promise<void> {
    if (this.saveInProgress || this.saveQueue.length === 0) {
      return;
    }

    this.saveInProgress = true;

    const batch = this.saveQueue.splice(0, 10);

    await Promise.all(
      batch.map(({ symbol, timeframe, candle }) => {
        const candleState: CandleState = {
          ...candle,
          startTime: candle.time * 1000,
          tickCount: 1
        };
        return this.saveCompletedCandle(symbol, timeframe, candleState);
      })
    );

    this.saveInProgress = false;

    if (this.saveQueue.length > 0) {
      setTimeout(() => this.processSaveQueue(), 100);
    }
  }

  private queueCandleForSave(symbol: string, timeframe: Timeframe, candle: CandleState): void {
    const candleData: CandleData = {
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume
    };

    this.saveQueue.push({ symbol, timeframe, candle: candleData });
    this.processSaveQueue();
  }

  private notifyListeners(symbol: string, timeframe: Timeframe, candle: CandleData): void {
    this.listeners.forEach(listener => {
      try {
        listener(symbol, timeframe, candle);
      } catch (error) {
        console.error('[BackgroundAggregator] Error in listener:', error);
      }
    });
  }

  private notifyTickListeners(symbol: string, bid: number, ask: number, timestamp: string): void {
    // Don't send tick updates during initialization to prevent old data from updating charts
    if (this.isInitializing) {
      return;
    }

    const midPrice = (bid + ask) / 2;
    const tick = { symbol, bid, ask, timestamp, midPrice };

    if (this.tickListeners.size === 0) {
      // Chart not subscribed yet - this is normal during startup
      return;
    }

    console.log(`[BackgroundAggregator] 📊 Tick: ${symbol} @ ${midPrice.toFixed(5)} (${this.tickListeners.size} listeners)`);

    this.tickListeners.forEach(listener => {
      try {
        listener(tick);
      } catch (error) {
        console.error('[BackgroundAggregator] Error in tick listener:', error);
      }
    });
  }

  private processNewPrice(symbol: string, bid: number, ask: number, timestamp: string): void {
    const midPrice = (bid + ask) / 2;
    const timestampMs = new Date(timestamp).getTime();

    if (isNaN(midPrice) || midPrice <= 0) {
      console.warn(`[BackgroundAggregator] Invalid price for ${symbol}: bid=${bid}, ask=${ask}`);
      return;
    }

    if (isNaN(timestampMs) || timestampMs <= 0) {
      console.warn(`[BackgroundAggregator] Invalid timestamp for ${symbol}: ${timestamp}`);
      return;
    }

    // Update last price cache for gap filling
    this.lastPriceCache.set(symbol, midPrice);

    // Notify tick listeners immediately for live display
    this.notifyTickListeners(symbol, bid, ask, timestamp);

    for (const timeframe of ALL_TIMEFRAMES) {
      const key = this.getCacheKey(symbol, timeframe);
      const candleTime = this.getCandleTime(timestampMs, timeframe);
      const existingState = this.candleStates.get(key);

      if (!existingState || existingState.startTime !== candleTime) {
        if (existingState && existingState.startTime < candleTime) {
          logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ` ${symbol} ${timeframe} - Candle period completed, saving and starting new`);
          this.queueCandleForSave(symbol, timeframe, existingState);
        } else if (existingState && existingState.startTime > candleTime) {
          logger.debug(LogCategory.BACKGROUND_AGGREGATOR, `${symbol} ${timeframe} - Received old price, ignoring`);
          continue;
        }

        const newState = this.initializeCandleState(symbol, timeframe, midPrice, timestampMs);
        this.candleStates.set(key, newState);

        const candleData: CandleData = {
          time: newState.time,
          open: newState.open,
          high: newState.high,
          low: newState.low,
          close: newState.close,
          volume: newState.volume
        };
        this.notifyListeners(symbol, timeframe, candleData);
      } else {
        this.updateCandleState(existingState, midPrice);

        const candleData: CandleData = {
          time: existingState.time,
          open: existingState.open,
          high: existingState.high,
          low: existingState.low,
          close: existingState.close,
          volume: existingState.volume
        };
        this.notifyListeners(symbol, timeframe, candleData);
      }
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[BackgroundAggregator] Already running');
      return;
    }

    logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' 🚀 Starting in hybrid mode: Live ticks + Database validation');

    // Check if server-side aggregation is active FIRST
    const serverSideActive = await this.checkServerSideAggregation();

    if (serverSideActive) {
      logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' ✅ Server-side candle aggregation detected and active');
      logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' 📊 Browser-based aggregation running in monitoring mode only');
      logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' 🎯 Candles will continue to be collected even when browser is closed');
    } else {
      logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' ⚠️ Server-side aggregation not detected');
      logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' 🔄 Running in legacy browser-based mode');
      logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' ⚠️ Candles will only be collected while browser is open');
    }

    // Check database status with improved logic
    const dataStatus = await this.checkDatabaseStatus();
    logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ` Database status: ${dataStatus.status}`);
    logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ` Records found: ${dataStatus.recordCount}, Age: ${dataStatus.ageSeconds}s`);

    // Only activate emergency poller if truly needed
    if (dataStatus.needsEmergencyMode) {
      console.error('[BackgroundAggregator] 🚨 CRITICAL: No recent data during market hours - Starting emergency price poller!');
      await emergencyPricePoller.start();

      // Subscribe to emergency poller updates
      emergencyPricePoller.onPriceUpdate((price) => {
        this.processNewPrice(price.symbol, price.bid, price.ask, price.timestamp);
      });
    } else if (dataStatus.status === 'stale') {
      logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' ⚠️ Data is stale, but within acceptable range - monitoring...');
    } else {
      logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' ✅ Database has recent data - relying on server-side polling');
    }

    // Clear any stale in-memory state
    this.candleStates.clear();
    this.saveQueue = [];
    this.lastMessageTime = null;
    this.reconnectAttempts = 0;
    logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' 🧹 Cleared all in-memory candle state');

    logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' 🚀 Starting background candle aggregation for all pairs and timeframes...');
    logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' 🔄 Auto-reconnection enabled for persistent operation');
    logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' ✨ Building fresh candles from live data only');

    await this.initializeCurrentCandles();
    await this.setupRealtimeSubscription();
    this.startHealthMonitoring();
    this.startCandleFinalizer();

    logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ` Monitoring ${FOREX_PAIRS.length} pairs across ${ALL_TIMEFRAMES.length} timeframes`);
  }

  private startCandleFinalizer(): void {
    if (this.candleFinalizerInterval) {
      clearInterval(this.candleFinalizerInterval);
    }

    logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' 🕐 Starting candle finalizer (checks every 60s for missing candles)');

    this.candleFinalizerInterval = setInterval(async () => {
      await this.checkAndFinalizeMissingCandles();
    }, this.CANDLE_FINALIZER_CHECK_INTERVAL_MS);

    // Run immediately on start
    setTimeout(() => this.checkAndFinalizeMissingCandles(), 5000);
  }

  private async checkAndFinalizeMissingCandles(): Promise<void> {
    const now = Date.now();

    for (const symbol of FOREX_PAIRS) {
      const lastPrice = this.lastPriceCache.get(symbol);
      if (!lastPrice) continue;

      for (const timeframe of ALL_TIMEFRAMES) {
        const key = this.getCacheKey(symbol, timeframe);
        const existingState = this.candleStates.get(key);
        const intervalMs = getTimeframeMinutes(timeframe) * 60 * 1000;
        const currentCandleTime = Math.floor(now / intervalMs) * intervalMs;

        // Check if we're in a new candle period without a forming candle
        if (!existingState || existingState.startTime < currentCandleTime - intervalMs) {
          // There's a gap - we should have a candle but don't
          const missingCandleTime = currentCandleTime - intervalMs;

          // Only fill if the missing candle time is within the last hour (to avoid excessive backfilling)
          if (now - missingCandleTime < 3600000) {
            logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ` 🔧 Detected missing candle for ${symbol} ${timeframe} at ${new Date(missingCandleTime).toISOString()}`);

            // Create a flat candle using the last known price
            const flatCandle: CandleState = {
              time: Math.floor(missingCandleTime / 1000),
              open: lastPrice,
              high: lastPrice,
              low: lastPrice,
              close: lastPrice,
              volume: 0,
              startTime: missingCandleTime,
              tickCount: 0
            };

            // Save this flat candle
            this.queueCandleForSave(symbol, timeframe, flatCandle);

            logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ` ✓ Created flat candle for ${symbol} ${timeframe} using price ${lastPrice}`);
          }
        }

        // Check if current forming candle should be finalized (1 minute grace period)
        if (existingState && existingState.startTime < currentCandleTime - 60000) {
          logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ` ⏰ Auto-finalizing ${symbol} ${timeframe} candle (grace period expired)`);
          this.queueCandleForSave(symbol, timeframe, existingState);
          this.candleStates.delete(key);
        }
      }
    }
  }

  private async checkDatabaseStatus(): Promise<{
    status: 'fresh' | 'stale' | 'empty' | 'market_closed';
    ageSeconds: number;
    recordCount: number;
    needsEmergencyMode: boolean;
  }> {
    try {
      // Check market hours first
      const now = new Date();
      const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const dayOfWeek = estTime.getDay();
      const hours = estTime.getHours();
      const minutes = estTime.getMinutes();
      const totalMinutes = hours * 60 + minutes;

      const fridayCloseTime = 17 * 60;
      const sundayOpenTime = 17 * 60;

      let isMarketOpen = true;
      if (dayOfWeek === 6) {
        isMarketOpen = false;
      } else if (dayOfWeek === 5 && totalMinutes >= fridayCloseTime) {
        isMarketOpen = false;
      } else if (dayOfWeek === 0 && totalMinutes < sundayOpenTime) {
        isMarketOpen = false;
      }

      // Count recent records
      const { count: recordCount, error: countError } = await supabase
        .from('realtime_prices')
        .select('*', { count: 'exact', head: true });

      if (countError) {
        console.error('[BackgroundAggregator] Error counting records:', countError);
      }

      // Get most recent record
      const { data, error } = await supabase
        .from('realtime_prices')
        .select('created_at, symbol')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[BackgroundAggregator] Error checking database:', error);
        return {
          status: 'empty',
          ageSeconds: Infinity,
          recordCount: 0,
          needsEmergencyMode: isMarketOpen
        };
      }

      if (!data) {
        console.warn('[BackgroundAggregator] No price data found in database');
        return {
          status: 'empty',
          ageSeconds: Infinity,
          recordCount: recordCount || 0,
          needsEmergencyMode: isMarketOpen
        };
      }

      const ageSeconds = (Date.now() - new Date(data.created_at).getTime()) / 1000;
      logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ` Most recent: ${data.symbol} at ${new Date(data.created_at).toISOString()} (${Math.round(ageSeconds)}s ago)`);

      // Market is closed - don't trigger emergency mode
      if (!isMarketOpen) {
        return {
          status: 'market_closed',
          ageSeconds,
          recordCount: recordCount || 0,
          needsEmergencyMode: false
        };
      }

      // During market hours, be more lenient with thresholds
      // Allow up to 2 minutes of staleness before emergency mode
      if (ageSeconds < 90) {
        return {
          status: 'fresh',
          ageSeconds,
          recordCount: recordCount || 0,
          needsEmergencyMode: false
        };
      } else if (ageSeconds < 300) {
        // 90s - 5 minutes: stale but not critical
        return {
          status: 'stale',
          ageSeconds,
          recordCount: recordCount || 0,
          needsEmergencyMode: false
        };
      } else {
        // > 5 minutes during market hours: critical
        return {
          status: 'empty',
          ageSeconds,
          recordCount: recordCount || 0,
          needsEmergencyMode: true
        };
      }
    } catch (error) {
      console.error('[BackgroundAggregator] Error in database status check:', error);
      return {
        status: 'empty',
        ageSeconds: Infinity,
        recordCount: 0,
        needsEmergencyMode: true
      };
    }
  }

  private async checkServerSideAggregation(): Promise<boolean> {
    try {
      // Check if candle_state table exists and has recent activity
      const { data, error } = await supabase
        .from('candle_state')
        .select('last_updated')
        .order('last_updated', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' Server-side aggregation check: table not found or error', error.message);
        return false;
      }

      if (!data) {
        logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' Server-side aggregation check: no candle state data found');
        return false;
      }

      const lastUpdate = new Date(data.last_updated).getTime();
      const ageSeconds = (Date.now() - lastUpdate) / 1000;

      if (ageSeconds < 60) {
        logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ` Server-side aggregation active (last update ${Math.round(ageSeconds)}s ago)`);
        return true;
      } else {
        logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ` Server-side aggregation stale (last update ${Math.round(ageSeconds)}s ago)`);
        return false;
      }
    } catch (error) {
      console.error('[BackgroundAggregator] Error checking server-side aggregation:', error);
      return false;
    }
  }

  private async setupRealtimeSubscription(): Promise<void> {
    // Prevent multiple simultaneous connection attempts
    if (this.isConnecting) {
      logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' Already connecting, skipping duplicate attempt');
      return;
    }

    // Circuit breaker check
    if (this.circuitBreakerTripped) {
      console.error('[BackgroundAggregator] Circuit breaker tripped - manual restart required');
      return;
    }

    // Rate limit reconnection attempts
    const timeSinceLastAttempt = Date.now() - this.lastReconnectAttemptTime;
    if (timeSinceLastAttempt < this.MIN_RECONNECT_INTERVAL_MS) {
      logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ` Rate limiting: ${timeSinceLastAttempt}ms since last attempt, waiting...`);
      return;
    }

    try {
      this.isConnecting = true;
      this.connectionState = 'connecting';
      this.lastReconnectAttemptTime = Date.now();

      logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' Setting up realtime subscription...');

      // Clean up existing subscription properly
      if (this.subscription) {
        logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' Cleaning up existing subscription');
        try {
          await this.subscription.unsubscribe();
        } catch (cleanupError) {
          console.warn('[BackgroundAggregator] Error during cleanup:', cleanupError);
        }
        this.subscription = null;
        // Wait for cleanup to complete
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      this.subscription = supabase
        .channel('background_price_aggregation')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'realtime_prices'
          },
          (payload) => {
            this.lastMessageTime = new Date();
            const { symbol, bid, ask, broker_time, created_at } = payload.new as any;
            const timestamp = broker_time || created_at;

            console.log(`[BackgroundAggregator] 📡 Realtime INSERT: ${symbol} @ ${parseFloat(bid).toFixed(5)}`);

            this.processNewPrice(
              symbol,
              parseFloat(bid),
              parseFloat(ask),
              timestamp
            );
          }
        )
        .subscribe((status, err) => {
          console.log(`[BackgroundAggregator] 🔌 Subscription status: ${status}`, err || '');
          logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' Subscription status:', status);

          if (status === 'SUBSCRIBED') {
            this.isRunning = true;
            this.isConnecting = false;
            this.connectionState = 'connected';
            this.reconnectAttempts = 0;
            this.lastMessageTime = new Date();
            logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' ✅ Successfully subscribed to realtime_prices');
          } else if (status === 'CHANNEL_ERROR') {
            console.error('[BackgroundAggregator] ❌ Channel error:', err);
            this.isConnecting = false;
            this.connectionState = 'error';
            this.handleConnectionError();
          } else if (status === 'TIMED_OUT') {
            console.error('[BackgroundAggregator] ⏱️ Connection timed out');
            this.isConnecting = false;
            this.connectionState = 'error';
            this.handleConnectionError();
          } else if (status === 'CLOSED') {
            logger.debug(LogCategory.BACKGROUND_AGGREGATOR, '🔌 Connection closed');
            this.isConnecting = false;
            this.connectionState = 'disconnected';
            if (this.isRunning) {
              this.handleConnectionError();
            }
          }
        });
    } catch (error) {
      console.error('[BackgroundAggregator] Failed to setup subscription:', error);
      this.isConnecting = false;
      this.connectionState = 'error';
      this.handleConnectionError();
    }
  }

  private handleConnectionError(): void {
    // Prevent recursive calls
    if (this.isConnecting) {
      logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' Already attempting to connect, ignoring error');
      return;
    }

    // Clear any existing reconnect timeout to prevent duplicates
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[BackgroundAggregator] ❌ Max reconnection attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached. ` +
        'Manual restart required.'
      );
      this.circuitBreakerTripped = true;
      this.connectionState = 'error';
      this.isRunning = false;
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts - 1),
      30000
    );

    logger.debug(
      LogCategory.BACKGROUND_AGGREGATOR,
      `🔄 Scheduling reconnection ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS} in ${Math.round(delay / 1000)}s...`
    );

    this.reconnectTimeout = setTimeout(async () => {
      logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ` 🔌 Reconnecting (attempt ${this.reconnectAttempts})...`);
      this.reconnectTimeout = null;
      await this.setupRealtimeSubscription();
    }, delay);
  }

  private startHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    logger.debug(
      LogCategory.BACKGROUND_AGGREGATOR,
      `💚 Starting health monitoring (every ${this.HEALTH_CHECK_INTERVAL_MS / 1000}s)...`
    );

    this.healthCheckInterval = setInterval(() => {
      this.checkConnectionHealth();
    }, this.HEALTH_CHECK_INTERVAL_MS);
  }

  private checkConnectionHealth(): void {
    if (!this.isRunning) {
      return;
    }

    const now = Date.now();
    const timeSinceLastMessage = this.lastMessageTime
      ? now - this.lastMessageTime.getTime()
      : Infinity;

    if (timeSinceLastMessage > this.STALE_CONNECTION_THRESHOLD_MS) {
      logger.debug(
        LogCategory.BACKGROUND_AGGREGATOR,
        `⚠️ No messages received for ${Math.round(timeSinceLastMessage / 1000)}s - connection may be stale`
      );

      logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' 🔄 Forcing reconnection due to stale connection...');
      this.handleConnectionError();
    } else {
      logger.debug(
        LogCategory.BACKGROUND_AGGREGATOR,
        `✅ Health check passed (last message ${Math.round(timeSinceLastMessage / 1000)}s ago, ${this.candleStates.size} active candles)`
      );
    }
  }

  private async initializeCurrentCandles(): Promise<void> {
    this.isInitializing = true;
    logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' Initializing current candle states from recent prices...');
    logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' This ensures live candles start from the current period only');
    logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' 🔇 Tick notifications paused during initialization');

    for (const symbol of FOREX_PAIRS) {
      try {
        const lookbackMinutes = 15;
        const startTime = new Date(Date.now() - lookbackMinutes * 60 * 1000);

        const { data: recentPrices, error } = await supabase
          .from('realtime_prices')
          .select('bid, ask, broker_time, created_at')
          .eq('symbol', symbol)
          .gte('created_at', startTime.toISOString())
          .order('created_at', { ascending: false })
          .limit(100);

        if (error) {
          console.error(`[BackgroundAggregator] Failed to fetch recent prices for ${symbol}:`, error);
          continue;
        }

        if (!recentPrices || recentPrices.length === 0) {
          continue;
        }

        const sortedPrices = recentPrices.reverse();

        const now = Date.now();
        for (const price of sortedPrices) {
          const priceTime = new Date(price.broker_time || price.created_at).getTime();
          const ageMinutes = (now - priceTime) / (60 * 1000);

          if (ageMinutes > lookbackMinutes) {
            continue;
          }

          this.processNewPrice(
            symbol,
            parseFloat(price.bid),
            parseFloat(price.ask),
            price.broker_time || price.created_at
          );
        }

        logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ` ✓ Initialized ${symbol} with ${recentPrices.length} recent prices (last ${lookbackMinutes} min)`);

        const currentStates = this.getAllCurrentCandles(symbol);
        if (currentStates.size > 0) {
          logger.debug(LogCategory.BACKGROUND_AGGREGATOR, `   Active candles for ${symbol}: ${Array.from(currentStates.keys()).join(', ')}`);
        }
      } catch (error) {
        console.error(`[BackgroundAggregator] Error initializing ${symbol}:`, error);
      }
    }

    logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' ✅ Current candle states initialized for all pairs');
    this.isInitializing = false;
    logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' 🔊 Tick notifications resumed');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' Stopping background aggregation...');

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.candleFinalizerInterval) {
      clearInterval(this.candleFinalizerInterval);
      this.candleFinalizerInterval = null;
    }

    if (this.subscription) {
      await this.subscription.unsubscribe();
      this.subscription = null;
    }

    for (const [key, state] of this.candleStates.entries()) {
      const [symbol, timeframe] = key.split('_');
      await this.saveCompletedCandle(symbol, timeframe as Timeframe, state);
    }

    while (this.saveQueue.length > 0) {
      await this.processSaveQueue();
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    this.candleStates.clear();
    this.isRunning = false;
    this.lastMessageTime = null;
    this.reconnectAttempts = 0;

    logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' ✅ Stopped');
  }

  getCurrentCandle(symbol: string, timeframe: Timeframe): CandleData | null {
    const key = this.getCacheKey(symbol, timeframe);
    const state = this.candleStates.get(key);

    if (!state) {
      return null;
    }

    return {
      time: state.time,
      open: state.open,
      high: state.high,
      low: state.low,
      close: state.close,
      volume: state.volume
    };
  }

  getAllCurrentCandles(symbol: string): Map<Timeframe, CandleData> {
    const result = new Map<Timeframe, CandleData>();

    for (const timeframe of ALL_TIMEFRAMES) {
      const candle = this.getCurrentCandle(symbol, timeframe);
      if (candle) {
        result.set(timeframe, candle);
      }
    }

    return result;
  }

  onCandleUpdate(callback: (symbol: string, timeframe: Timeframe, candle: CandleData) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  onTickUpdate(callback: (tick: { symbol: string; bid: number; ask: number; timestamp: string; midPrice: number }) => void): () => void {
    this.tickListeners.add(callback);
    logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ` Tick listener registered (${this.tickListeners.size} total)`);
    return () => {
      this.tickListeners.delete(callback);
      logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ` Tick listener removed (${this.tickListeners.size} remaining)`);
    };
  }

  getFormingCandle(symbol: string, timeframe: Timeframe): CandleData | null {
    return this.getCurrentCandle(symbol, timeframe);
  }

  getCandleProgress(symbol: string, timeframe: Timeframe): number {
    const key = this.getCacheKey(symbol, timeframe);
    const state = this.candleStates.get(key);

    if (!state) return 0;

    const now = Date.now();
    const intervalMs = getTimeframeMinutes(timeframe) * 60 * 1000;
    const elapsed = now - state.startTime;
    const progress = Math.min((elapsed / intervalMs) * 100, 100);

    return progress;
  }

  getStatus() {
    const timeSinceLastMessage = this.lastMessageTime
      ? Date.now() - this.lastMessageTime.getTime()
      : null;

    return {
      isRunning: this.isRunning,
      isConnecting: this.isConnecting,
      connectionState: this.connectionState,
      circuitBreakerTripped: this.circuitBreakerTripped,
      activeCandleStates: this.candleStates.size,
      saveQueueLength: this.saveQueue.length,
      listenerCount: this.listeners.size,
      tickListenerCount: this.tickListeners.size,
      symbols: FOREX_PAIRS.length,
      timeframes: ALL_TIMEFRAMES.length,
      totalCombinations: FOREX_PAIRS.length * ALL_TIMEFRAMES.length,
      reconnectAttempts: this.reconnectAttempts,
      lastMessageTime: this.lastMessageTime,
      timeSinceLastMessageMs: timeSinceLastMessage,
      connectionHealthy: timeSinceLastMessage !== null && timeSinceLastMessage < this.STALE_CONNECTION_THRESHOLD_MS
    };
  }

  resetCircuitBreaker(): void {
    logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' Resetting circuit breaker - manual restart enabled');
    this.circuitBreakerTripped = false;
    this.reconnectAttempts = 0;
    this.connectionState = 'disconnected';
  }

  async manualReconnect(): Promise<void> {
    logger.debug(LogCategory.BACKGROUND_AGGREGATOR, ' Manual reconnection requested');
    this.resetCircuitBreaker();
    this.isConnecting = false;
    await this.stop();
    await new Promise(resolve => setTimeout(resolve, 1000));
    await this.start();
  }
}

export const backgroundCandleAggregator = new BackgroundCandleAggregator();
