import { supabase } from '../lib/supabase';
import { CandleData, Timeframe } from './metaapi';
import { getCandleOpenTime, validateOHLC } from './candle-utils';

interface CandleState {
  symbol: string;
  timeframe: Timeframe;
  open: number;
  high: number;
  low: number;
  close: number;
  timestamp: Date;
  isComplete: boolean;
  tickCount: number;
  lastUpdate: Date;
}

class CandleStateManager {
  private currentCandles: Map<string, CandleState> = new Map();
  private persistenceQueue: Map<string, NodeJS.Timeout> = new Map();
  private readonly PERSIST_INTERVAL_MS = 1000;

  private getCandleKey(symbol: string, timeframe: Timeframe): string {
    return `${symbol}_${timeframe}`;
  }

  async initializeCandleState(
    symbol: string,
    timeframe: Timeframe
  ): Promise<CandleState | null> {
    const key = this.getCandleKey(symbol, timeframe);

    try {
      const { data, error } = await supabase
        .from('market_data')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Error loading candle state:', error);
        return null;
      }

      if (data) {
        const candleState: CandleState = {
          symbol: data.symbol,
          timeframe: data.timeframe as Timeframe,
          open: parseFloat(data.open),
          high: parseFloat(data.high),
          low: parseFloat(data.low),
          close: parseFloat(data.close),
          timestamp: new Date(data.timestamp),
          isComplete: true,
          tickCount: data.tick_volume || 0,
          lastUpdate: new Date(data.updated_at || data.created_at)
        };

        this.currentCandles.set(key, candleState);
        console.log(`Initialized candle state for ${symbol} ${timeframe}:`, candleState.timestamp.toISOString());
        return candleState;
      }

      return null;
    } catch (error) {
      console.error('Error in initializeCandleState:', error);
      return null;
    }
  }

  updateCandleWithTick(
    symbol: string,
    timeframe: Timeframe,
    tickPrice: number,
    tickTime: Date
  ): CandleState {
    const key = this.getCandleKey(symbol, timeframe);
    const candleOpenTime = getCandleOpenTime(tickTime, timeframe);

    let currentCandle = this.currentCandles.get(key);

    if (!currentCandle || currentCandle.timestamp.getTime() !== candleOpenTime.getTime()) {
      if (currentCandle && !currentCandle.isComplete) {
        currentCandle.isComplete = true;
        console.log(`✅ Candle completed: ${symbol} ${timeframe} @ ${currentCandle.timestamp.toISOString()}`);
        this.persistCandleAsComplete(currentCandle);
      }

      currentCandle = {
        symbol,
        timeframe,
        open: tickPrice,
        high: tickPrice,
        low: tickPrice,
        close: tickPrice,
        timestamp: candleOpenTime,
        isComplete: false,
        tickCount: 1,
        lastUpdate: tickTime
      };

      this.currentCandles.set(key, currentCandle);
      console.log(`🆕 New candle started: ${symbol} ${timeframe} @ ${candleOpenTime.toISOString()}`);
    } else {
      currentCandle.high = Math.max(currentCandle.high, tickPrice);
      currentCandle.low = Math.min(currentCandle.low, tickPrice);
      currentCandle.close = tickPrice;
      currentCandle.tickCount++;
      currentCandle.lastUpdate = tickTime;
    }

    this.schedulePersistence(key, currentCandle);

    return currentCandle;
  }

  updateCandleWithCandleData(candle: CandleData): CandleState {
    const key = this.getCandleKey(candle.symbol, candle.timeframe as Timeframe);
    const candleOpenTime = getCandleOpenTime(candle.time, candle.timeframe as Timeframe);

    const candleState: CandleState = {
      symbol: candle.symbol,
      timeframe: candle.timeframe as Timeframe,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      timestamp: candleOpenTime,
      isComplete: true,
      tickCount: candle.tickVolume || 0,
      lastUpdate: candle.time
    };

    this.currentCandles.set(key, candleState);
    this.persistCandleAsComplete(candleState);

    return candleState;
  }

  private schedulePersistence(key: string, candle: CandleState): void {
    if (this.persistenceQueue.has(key)) {
      return;
    }

    const timeout = setTimeout(() => {
      this.persistCandleImmediate(candle);
      this.persistenceQueue.delete(key);
    }, this.PERSIST_INTERVAL_MS);

    this.persistenceQueue.set(key, timeout);
  }

  private async persistCandleImmediate(candle: CandleState): Promise<void> {
    if (!validateOHLC(candle.open, candle.high, candle.low, candle.close)) {
      console.error('Invalid OHLC values, skipping persistence:', candle);
      return;
    }

    try {
      const row = {
        symbol: candle.symbol,
        timeframe: candle.timeframe,
        timestamp: candle.timestamp.toISOString(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        tick_volume: candle.tickCount,
        volume: 0,
        spread: 0,
        broker_time: candle.timestamp.toISOString(),
        data_source: candle.isComplete ? 'live_tick_complete' : 'live_tick',
        is_complete: candle.isComplete,
        completed_at: candle.isComplete ? new Date().toISOString() : null
      };

      const { error } = await supabase
        .from('market_data')
        .upsert(row, {
          onConflict: 'symbol,timeframe,timestamp',
          ignoreDuplicates: false
        });

      if (error) {
        console.error('Error persisting candle:', error);
      }
    } catch (error) {
      console.error('Error in persistCandleImmediate:', error);
    }
  }

  private async persistCandleAsComplete(candle: CandleState): Promise<void> {
    if (!validateOHLC(candle.open, candle.high, candle.low, candle.close)) {
      console.error('Invalid OHLC values, skipping complete persistence:', candle);
      return;
    }

    try {
      const row = {
        symbol: candle.symbol,
        timeframe: candle.timeframe,
        timestamp: candle.timestamp.toISOString(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        tick_volume: candle.tickCount,
        volume: 0,
        spread: 0,
        broker_time: candle.timestamp.toISOString(),
        data_source: 'live_tick_complete',
        is_complete: true,
        completed_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('market_data')
        .upsert(row, {
          onConflict: 'symbol,timeframe,timestamp',
          ignoreDuplicates: false
        });

      if (error) {
        console.error('Error persisting complete candle:', error);
      } else {
        console.log(`💾 Persisted complete candle: ${candle.symbol} ${candle.timeframe} @ ${candle.timestamp.toISOString()}`);
      }
    } catch (error) {
      console.error('Error in persistCandleAsComplete:', error);
    }
  }

  getCurrentCandle(symbol: string, timeframe: Timeframe): CandleState | null {
    const key = this.getCandleKey(symbol, timeframe);
    return this.currentCandles.get(key) || null;
  }

  async flushAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    this.persistenceQueue.forEach((timeout) => {
      clearTimeout(timeout);
    });
    this.persistenceQueue.clear();

    this.currentCandles.forEach((candle) => {
      promises.push(this.persistCandleImmediate(candle));
    });

    await Promise.all(promises);
  }

  clearCandle(symbol: string, timeframe: Timeframe): void {
    const key = this.getCandleKey(symbol, timeframe);

    const timeout = this.persistenceQueue.get(key);
    if (timeout) {
      clearTimeout(timeout);
      this.persistenceQueue.delete(key);
    }

    this.currentCandles.delete(key);
  }
}

export const candleStateManager = new CandleStateManager();
