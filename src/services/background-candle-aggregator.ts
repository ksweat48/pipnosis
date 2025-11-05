import { supabase } from '@/lib/supabase';
import { Timeframe } from '@/services/chart-preferences';
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
      const { error: forexError } = await supabase
        .from('forex_candles')
        .upsert(candleRecord, {
          onConflict: 'symbol,timeframe,open_time',
          ignoreDuplicates: false
        });

      if (forexError) {
        console.error(`[BackgroundAggregator] Failed to save ${symbol} ${timeframe}:`, forexError);
        return;
      }

      const marketDataRecord = {
        symbol,
        timeframe,
        timestamp: openTime.toISOString(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume
      };

      const { error: marketError } = await supabase
        .from('market_data')
        .upsert(marketDataRecord, {
          onConflict: 'symbol,timeframe,timestamp',
          ignoreDuplicates: false
        });

      if (marketError) {
        console.warn(`[BackgroundAggregator] Failed to save to market_data ${symbol} ${timeframe}:`, marketError);
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

    for (const timeframe of ALL_TIMEFRAMES) {
      const key = this.getCacheKey(symbol, timeframe);
      const candleTime = this.getCandleTime(timestampMs, timeframe);
      const existingState = this.candleStates.get(key);

      if (!existingState || existingState.startTime !== candleTime) {
        if (existingState) {
          this.queueCandleForSave(symbol, timeframe, existingState);
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

    console.log('[BackgroundAggregator] 🚀 Starting background candle aggregation for all pairs and timeframes...');

    await this.initializeCurrentCandles();

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
      .subscribe((status) => {
        console.log('[BackgroundAggregator] Subscription status:', status);
        if (status === 'SUBSCRIBED') {
          this.isRunning = true;
          console.log('[BackgroundAggregator] ✅ Successfully subscribed to realtime_prices');
        }
      });

    console.log(`[BackgroundAggregator] Monitoring ${FOREX_PAIRS.length} pairs across ${ALL_TIMEFRAMES.length} timeframes`);
  }

  private async initializeCurrentCandles(): Promise<void> {
    console.log('[BackgroundAggregator] Initializing current candle states from recent prices...');

    for (const symbol of FOREX_PAIRS) {
      try {
        const { data: recentPrices, error } = await supabase
          .from('realtime_prices')
          .select('bid, ask, broker_time, created_at')
          .eq('symbol', symbol)
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

        for (const price of sortedPrices) {
          this.processNewPrice(
            symbol,
            parseFloat(price.bid),
            parseFloat(price.ask),
            price.broker_time || price.created_at
          );
        }

        console.log(`[BackgroundAggregator] ✓ Initialized ${symbol} with ${recentPrices.length} recent prices`);
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
    return {
      isRunning: this.isRunning,
      activeCandleStates: this.candleStates.size,
      saveQueueLength: this.saveQueue.length,
      listenerCount: this.listeners.size,
      symbols: FOREX_PAIRS.length,
      timeframes: ALL_TIMEFRAMES.length,
      totalCombinations: FOREX_PAIRS.length * ALL_TIMEFRAMES.length
    };
  }
}

export const backgroundCandleAggregator = new BackgroundCandleAggregator();
