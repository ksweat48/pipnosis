import { supabase } from '@/lib/supabase';
import { Timeframe, appTimeframeToDb } from '@/services/chart-preferences';
import { getTimeframeMinutes, CandleData } from '@/services/candle-data-service';

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
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 10;
  private readonly BASE_RECONNECT_DELAY = 1000;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private lastMessageTime: Date | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private readonly HEALTH_CHECK_INTERVAL_MS = 15000;
  private readonly STALE_CONNECTION_THRESHOLD_MS = 60000;

  private getCacheKey(symbol: string, timeframe: Timeframe): string {
    return `${symbol}_${timeframe}`;
  }

  private getCandleTime(timestamp: number, timeframe: Timeframe): number {
    const intervalMs = getTimeframeMinutes(timeframe) * 60 * 1000;
    return Math.floor(timestamp / intervalMs) * intervalMs;
  }

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

      console.log(`[BackgroundAggregator] ✓ Saved ${symbol} ${timeframe} candle at ${openTime.toISOString()} (${candle.tickCount} ticks)`);
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

    for (const timeframe of ALL_TIMEFRAMES) {
      const key = this.getCacheKey(symbol, timeframe);
      const candleTime = this.getCandleTime(timestampMs, timeframe);
      const existingState = this.candleStates.get(key);

      if (!existingState || existingState.startTime !== candleTime) {
        if (existingState && existingState.startTime < candleTime) {
          console.log(`[BackgroundAggregator] ${symbol} ${timeframe} - Candle period completed, saving and starting new`);
          this.queueCandleForSave(symbol, timeframe, existingState);
        } else if (existingState && existingState.startTime > candleTime) {
          console.warn(`[BackgroundAggregator] ${symbol} ${timeframe} - Received old price, ignoring`);
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

    // Check if server-side aggregation is active
    const serverSideActive = await this.checkServerSideAggregation();

    if (serverSideActive) {
      console.log('[BackgroundAggregator] ✅ Server-side candle aggregation detected and active');
      console.log('[BackgroundAggregator] 📊 Browser-based aggregation running in monitoring mode only');
      console.log('[BackgroundAggregator] 🎯 Candles will continue to be collected even when browser is closed');
    } else {
      console.warn('[BackgroundAggregator] ⚠️ Server-side aggregation not detected');
      console.log('[BackgroundAggregator] 🔄 Running in legacy browser-based mode');
      console.log('[BackgroundAggregator] ⚠️ Candles will only be collected while browser is open');
    }

    // Clear any stale in-memory state
    this.candleStates.clear();
    this.saveQueue = [];
    this.lastMessageTime = null;
    this.reconnectAttempts = 0;
    console.log('[BackgroundAggregator] 🧹 Cleared all in-memory candle state');

    console.log('[BackgroundAggregator] 🚀 Starting background candle aggregation for all pairs and timeframes...');
    console.log('[BackgroundAggregator] 🔄 Auto-reconnection enabled for persistent operation');
    console.log('[BackgroundAggregator] ✨ Building fresh candles from live data only');

    await this.initializeCurrentCandles();
    await this.setupRealtimeSubscription();
    this.startHealthMonitoring();

    console.log(`[BackgroundAggregator] Monitoring ${FOREX_PAIRS.length} pairs across ${ALL_TIMEFRAMES.length} timeframes`);
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
        console.log('[BackgroundAggregator] Server-side aggregation check: table not found or error', error.message);
        return false;
      }

      if (!data) {
        console.log('[BackgroundAggregator] Server-side aggregation check: no candle state data found');
        return false;
      }

      const lastUpdate = new Date(data.last_updated).getTime();
      const ageSeconds = (Date.now() - lastUpdate) / 1000;

      if (ageSeconds < 60) {
        console.log(`[BackgroundAggregator] Server-side aggregation active (last update ${Math.round(ageSeconds)}s ago)`);
        return true;
      } else {
        console.log(`[BackgroundAggregator] Server-side aggregation stale (last update ${Math.round(ageSeconds)}s ago)`);
        return false;
      }
    } catch (error) {
      console.error('[BackgroundAggregator] Error checking server-side aggregation:', error);
      return false;
    }
  }

  private async setupRealtimeSubscription(): Promise<void> {
    try {
      if (this.subscription) {
        await this.subscription.unsubscribe();
        this.subscription = null;
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

            this.processNewPrice(
              symbol,
              parseFloat(bid),
              parseFloat(ask),
              timestamp
            );
          }
        )
        .subscribe((status, err) => {
          console.log('[BackgroundAggregator] Subscription status:', status);

          if (status === 'SUBSCRIBED') {
            this.isRunning = true;
            this.reconnectAttempts = 0;
            this.lastMessageTime = new Date();
            console.log('[BackgroundAggregator] ✅ Successfully subscribed to realtime_prices');
          } else if (status === 'CHANNEL_ERROR') {
            console.error('[BackgroundAggregator] ❌ Channel error:', err);
            this.handleConnectionError();
          } else if (status === 'TIMED_OUT') {
            console.error('[BackgroundAggregator] ⏱️ Connection timed out');
            this.handleConnectionError();
          } else if (status === 'CLOSED') {
            console.warn('[BackgroundAggregator] 🔌 Connection closed');
            if (this.isRunning) {
              this.handleConnectionError();
            }
          }
        });
    } catch (error) {
      console.error('[BackgroundAggregator] Failed to setup subscription:', error);
      this.handleConnectionError();
    }
  }

  private handleConnectionError(): void {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[BackgroundAggregator] ❌ Max reconnection attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached. ` +
        'Manual restart required.'
      );
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts - 1),
      30000
    );

    console.log(
      `[BackgroundAggregator] 🔄 Attempting reconnection ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS} ` +
      `in ${Math.round(delay / 1000)}s...`
    );

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectTimeout = setTimeout(async () => {
      console.log(`[BackgroundAggregator] 🔌 Reconnecting (attempt ${this.reconnectAttempts})...`);
      await this.setupRealtimeSubscription();
    }, delay);
  }

  private startHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    console.log(
      `[BackgroundAggregator] 💚 Starting health monitoring (every ${this.HEALTH_CHECK_INTERVAL_MS / 1000}s)...`
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
      console.warn(
        `[BackgroundAggregator] ⚠️ No messages received for ${Math.round(timeSinceLastMessage / 1000)}s - ` +
        'connection may be stale'
      );

      console.log('[BackgroundAggregator] 🔄 Forcing reconnection due to stale connection...');
      this.handleConnectionError();
    } else {
      console.log(
        `[BackgroundAggregator] ✅ Health check passed ` +
        `(last message ${Math.round(timeSinceLastMessage / 1000)}s ago, ` +
        `${this.candleStates.size} active candles)`
      );
    }
  }

  private async initializeCurrentCandles(): Promise<void> {
    console.log('[BackgroundAggregator] Initializing current candle states from recent prices...');
    console.log('[BackgroundAggregator] This ensures live candles start from the current period only');

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

        console.log(`[BackgroundAggregator] ✓ Initialized ${symbol} with ${recentPrices.length} recent prices (last ${lookbackMinutes} min)`);

        const currentStates = this.getAllCurrentCandles(symbol);
        if (currentStates.size > 0) {
          console.log(`[BackgroundAggregator]   Active candles for ${symbol}: ${Array.from(currentStates.keys()).join(', ')}`);
        }
      } catch (error) {
        console.error(`[BackgroundAggregator] Error initializing ${symbol}:`, error);
      }
    }

    console.log('[BackgroundAggregator] ✅ Current candle states initialized for all pairs');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('[BackgroundAggregator] Stopping background aggregation...');

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
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

    console.log('[BackgroundAggregator] ✅ Stopped');
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

  getStatus() {
    const timeSinceLastMessage = this.lastMessageTime
      ? Date.now() - this.lastMessageTime.getTime()
      : null;

    return {
      isRunning: this.isRunning,
      activeCandleStates: this.candleStates.size,
      saveQueueLength: this.saveQueue.length,
      listenerCount: this.listeners.size,
      symbols: FOREX_PAIRS.length,
      timeframes: ALL_TIMEFRAMES.length,
      totalCombinations: FOREX_PAIRS.length * ALL_TIMEFRAMES.length,
      reconnectAttempts: this.reconnectAttempts,
      lastMessageTime: this.lastMessageTime,
      timeSinceLastMessageMs: timeSinceLastMessage,
      connectionHealthy: timeSinceLastMessage !== null && timeSinceLastMessage < this.STALE_CONNECTION_THRESHOLD_MS
    };
  }
}

export const backgroundCandleAggregator = new BackgroundCandleAggregator();
