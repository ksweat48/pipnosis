import { supabase } from '../lib/supabase';
import { CandleData, Timeframe } from '../types/market-data';
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
        const candleTimestamp = new Date(data.timestamp);
        const now = Date.now();
        const candleAge = now - candleTimestamp.getTime();

        // Reject candles older than 1 hour - they're stale
        if (candleAge > 3600000) {
          console.warn(`⚠️ Rejecting stale candle state for ${symbol} ${timeframe}: ${candleTimestamp.toISOString()} (age: ${(candleAge/1000/60).toFixed(1)} minutes)`);
          console.log(`   Will start fresh candle on next tick`);
          return null;
        }

        // Reject candles with timestamps in the future (clock sync issues)
        if (candleTimestamp.getTime() > now + 60000) {
          console.warn(`⚠️ Rejecting future-dated candle state for ${symbol} ${timeframe}: ${candleTimestamp.toISOString()}`);
          console.log(`   Current time: ${new Date().toISOString()}`);
          return null;
        }

        const candleState: CandleState = {
          symbol: data.symbol,
          timeframe: data.timeframe as Timeframe,
          open: parseFloat(data.open),
          high: parseFloat(data.high),
          low: parseFloat(data.low),
          close: parseFloat(data.close),
          timestamp: candleTimestamp,
          isComplete: true,
          tickCount: data.tick_volume || 0,
          lastUpdate: new Date(data.updated_at || data.created_at)
        };

        this.currentCandles.set(key, candleState);
        console.log(`Initialized candle state for ${symbol} ${timeframe}:`, candleState.timestamp.toISOString());
        console.log(`   Candle age: ${(candleAge/1000).toFixed(1)}s, Price: ${candleState.close.toFixed(5)}`);
        return candleState;
      }

      console.log(`No existing candle state found for ${symbol} ${timeframe}, will create new on first tick`);
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
  ): CandleState | null {
    // Validate tick timestamp
    const now = Date.now();
    const tickTimestamp = tickTime.getTime();

    // Reject ticks with timestamps in the future (allow 1 minute grace for clock skew)
    if (tickTimestamp > now + 60000) {
      console.warn(`[CandleStateManager] Rejecting tick with future timestamp: ${tickTime.toISOString()} (current: ${new Date().toISOString()})`);
      return null;
    }

    // Reject ticks older than 1 hour
    const tickAge = now - tickTimestamp;
    if (tickAge > 3600000) {
      console.warn(`[CandleStateManager] Rejecting old tick: ${tickTime.toISOString()} (age: ${(tickAge/1000).toFixed(0)}s)`);
      return null;
    }

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
      console.log(`🆕 New incomplete candle started: ${symbol} ${timeframe} @ ${candleOpenTime.toISOString()}`);
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

  shouldCandleBeComplete(candle: CandleState): boolean {
    const now = new Date();
    const timeframeMinutes = this.getTimeframeMinutes(candle.timeframe);
    const candleEndTime = new Date(candle.timestamp.getTime() + timeframeMinutes * 60 * 1000);

    return now >= candleEndTime;
  }

  private getTimeframeMinutes(timeframe: Timeframe): number {
    const map: Record<Timeframe, number> = {
      M1: 1,
      M5: 5,
      M15: 15,
      M30: 30,
      H1: 60,
      H4: 240,
      D1: 1440,
      W1: 10080,
      MN1: 43200
    };
    return map[timeframe] || 15;
  }

  updateCandleWithCandleData(candle: CandleData, symbol?: string, timeframe?: Timeframe): CandleState {
    const candleSymbol = candle.symbol || symbol || 'UNKNOWN';
    const candleTimeframe = candle.timeframe || timeframe || 'M15';
    const key = this.getCandleKey(candleSymbol, candleTimeframe);
    const candleOpenTime = getCandleOpenTime(candle.time, candleTimeframe);

    const candleState: CandleState = {
      symbol: candleSymbol,
      timeframe: candleTimeframe,
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

  private async persistCandleImmediate(candle: CandleState, retryCount: number = 0): Promise<void> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1000;

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

      const { error, status, statusText } = await supabase
        .from('market_data')
        .upsert(row, {
          onConflict: 'symbol,timeframe,timestamp',
          ignoreDuplicates: false
        });

      if (error) {
        const errorMessage = error?.message || error?.toString() || 'Unknown database error';

        if (retryCount === 0) {
          console.error(`❌ Error persisting candle (attempt ${retryCount + 1}/${MAX_RETRIES + 1}):`, {
            error: errorMessage,
            code: error.code,
            details: error.details,
            status,
            statusText,
            symbol: candle.symbol,
            timeframe: candle.timeframe,
            timestamp: candle.timestamp.toISOString()
          });
        }

        if (status === 404 && errorMessage.includes('does not exist')) {
          console.error('🚨 CRITICAL: market_data table does not exist. See PRODUCTION_DATABASE_SETUP.md');
          return;
        }

        if (retryCount < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.persistCandleImmediate(candle, retryCount + 1);
        } else {
          if (typeof window !== 'undefined' && window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('pipnosis:data-persistence-error', {
              detail: {
                type: 'candle_persist_failed',
                error: errorMessage,
                symbol: candle.symbol,
                timeframe: candle.timeframe,
                attempts: MAX_RETRIES + 1
              }
            }));
          }
        }
      }
    } catch (error) {
      if (retryCount === 0) {
        console.error(`❌ Exception in persistCandleImmediate (attempt ${retryCount + 1}/${MAX_RETRIES + 1}):`, error);
      }

      if (retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.persistCandleImmediate(candle, retryCount + 1);
      } else {
        if (typeof window !== 'undefined' && window.dispatchEvent) {
          window.dispatchEvent(new CustomEvent('pipnosis:data-persistence-error', {
            detail: {
              type: 'candle_persist_exception',
              error: error instanceof Error ? error.message : 'Unknown error',
              symbol: candle.symbol,
              timeframe: candle.timeframe,
              attempts: MAX_RETRIES + 1
            }
          }));
        }
      }
    }
  }

  private async persistCandleAsComplete(candle: CandleState, retryCount: number = 0): Promise<void> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1000;

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

      const { error, status, statusText } = await supabase
        .from('market_data')
        .upsert(row, {
          onConflict: 'symbol,timeframe,timestamp',
          ignoreDuplicates: false
        });

      if (error) {
        if (retryCount === 0) {
          console.error(`❌ Error persisting complete candle (attempt ${retryCount + 1}/${MAX_RETRIES + 1}):`, {
            error: error.message,
            code: error.code,
            details: error.details,
            status,
            statusText,
            symbol: candle.symbol,
            timeframe: candle.timeframe,
            timestamp: candle.timestamp.toISOString()
          });
        }

        if (status === 404 && error.message?.includes('does not exist')) {
          console.error('🚨 CRITICAL: market_data table does not exist. See PRODUCTION_DATABASE_SETUP.md');
          return;
        }

        if (retryCount < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.persistCandleAsComplete(candle, retryCount + 1);
        } else {
          if (typeof window !== 'undefined' && window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('pipnosis:data-persistence-error', {
              detail: {
                type: 'complete_candle_persist_failed',
                error: error.message,
                symbol: candle.symbol,
                timeframe: candle.timeframe,
                attempts: MAX_RETRIES + 1
              }
            }));
          }
        }
      } else {
        if (retryCount > 0) {
          console.log(`✅ Persisted complete candle after ${retryCount + 1} attempts: ${candle.symbol} ${candle.timeframe} @ ${candle.timestamp.toISOString()}`);
        }
      }
    } catch (error) {
      if (retryCount === 0) {
        console.error(`❌ Exception in persistCandleAsComplete (attempt ${retryCount + 1}/${MAX_RETRIES + 1}):`, error);
      }

      if (retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.persistCandleAsComplete(candle, retryCount + 1);
      } else {
        if (typeof window !== 'undefined' && window.dispatchEvent) {
          window.dispatchEvent(new CustomEvent('pipnosis:data-persistence-error', {
            detail: {
              type: 'complete_candle_persist_exception',
              error: error instanceof Error ? error.message : 'Unknown error',
              symbol: candle.symbol,
              timeframe: candle.timeframe,
              attempts: MAX_RETRIES + 1
            }
          }));
        }
      }
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
