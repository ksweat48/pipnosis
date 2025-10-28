import { Timeframe, CandleData, TickData } from '../types/market-data';
import { candleStateManager } from './candle-state-manager';
import { marketDataCache } from './market-data-cache';
import { getCandleOpenTime } from './candle-utils';

interface TimeframeState {
  currentCandle: {
    open: number;
    high: number;
    low: number;
    close: number;
    timestamp: Date;
    tickCount: number;
  } | null;
  lastUpdate: Date | null;
  isInitialized: boolean;
}

const ALL_TIMEFRAMES: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

class MultiTimeframeAggregator {
  private timeframeStates: Map<string, Map<Timeframe, TimeframeState>> = new Map();
  private isRunning = false;
  private flushInterval: NodeJS.Timeout | null = null;

  async initialize(symbol: string): Promise<void> {
    if (!this.timeframeStates.has(symbol)) {
      this.timeframeStates.set(symbol, new Map());
    }

    const symbolStates = this.timeframeStates.get(symbol)!;

    for (const timeframe of ALL_TIMEFRAMES) {
      const state = await candleStateManager.initializeCandleState(symbol, timeframe);

      symbolStates.set(timeframe, {
        currentCandle: state ? {
          open: state.open,
          high: state.high,
          low: state.low,
          close: state.close,
          timestamp: state.timestamp,
          tickCount: state.tickCount
        } : null,
        lastUpdate: state ? state.lastUpdate : null,
        isInitialized: true
      });

      console.log(`Initialized ${symbol} ${timeframe} aggregator`);
    }

    if (!this.isRunning) {
      this.startPeriodicFlush();
    }
  }

  processTick(tick: TickData): void {
    const symbol = tick.symbol;

    if (!this.timeframeStates.has(symbol)) {
      console.warn(`Symbol ${symbol} not initialized in aggregator`);
      return;
    }

    const midPrice = (tick.bid + tick.ask) / 2;
    const symbolStates = this.timeframeStates.get(symbol)!;

    for (const timeframe of ALL_TIMEFRAMES) {
      const state = symbolStates.get(timeframe);
      if (!state || !state.isInitialized) continue;

      const candleOpenTime = getCandleOpenTime(tick.time, timeframe);
      const isNewCandle = !state.currentCandle ||
        state.currentCandle.timestamp.getTime() !== candleOpenTime.getTime();

      if (isNewCandle) {
        if (state.currentCandle) {
          this.completeCandle(symbol, timeframe, state.currentCandle);
        }

        state.currentCandle = {
          open: midPrice,
          high: midPrice,
          low: midPrice,
          close: midPrice,
          timestamp: candleOpenTime,
          tickCount: 1
        };
      } else {
        state.currentCandle!.high = Math.max(state.currentCandle!.high, midPrice);
        state.currentCandle!.low = Math.min(state.currentCandle!.low, midPrice);
        state.currentCandle!.close = midPrice;
        state.currentCandle!.tickCount++;
      }

      state.lastUpdate = tick.time;

      this.updateCandleStateManager(symbol, timeframe, state.currentCandle, tick.time);
    }
  }

  private updateCandleStateManager(
    symbol: string,
    timeframe: Timeframe,
    candle: NonNullable<TimeframeState['currentCandle']>,
    tickTime: Date
  ): void {
    candleStateManager.updateCandleWithTick(
      symbol,
      timeframe,
      candle.close,
      tickTime
    );
  }

  private completeCandle(
    symbol: string,
    timeframe: Timeframe,
    candle: NonNullable<TimeframeState['currentCandle']>
  ): void {
    const completedCandle: CandleData = {
      symbol,
      timeframe,
      time: candle.timestamp,
      brokerTime: candle.timestamp.toISOString(),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      tickVolume: candle.tickCount,
      spread: 0,
      volume: 0
    };

    candleStateManager.updateCandleWithCandleData(completedCandle);

    console.log(`✅ Completed ${symbol} ${timeframe} candle @ ${candle.timestamp.toISOString()}`);
  }

  getCurrentCandle(symbol: string, timeframe: Timeframe): TimeframeState['currentCandle'] | null {
    const symbolStates = this.timeframeStates.get(symbol);
    if (!symbolStates) return null;

    const state = symbolStates.get(timeframe);
    return state?.currentCandle || null;
  }

  getLastUpdate(symbol: string, timeframe: Timeframe): Date | null {
    const symbolStates = this.timeframeStates.get(symbol);
    if (!symbolStates) return null;

    const state = symbolStates.get(timeframe);
    return state?.lastUpdate || null;
  }

  private startPeriodicFlush(): void {
    this.isRunning = true;

    this.flushInterval = setInterval(() => {
      this.flushAllCandles();
    }, 5000);

    console.log('🔄 Multi-timeframe aggregator periodic flush started');
  }

  private async flushAllCandles(): Promise<void> {
    await candleStateManager.flushAll();
  }

  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    await this.flushAllCandles();
    console.log('Multi-timeframe aggregator stopped');
  }

  async backfillTimeframe(
    symbol: string,
    timeframe: Timeframe,
    targetCandleCount: number = 500
  ): Promise<void> {
    console.log(`🔍 Checking backfill for ${symbol} ${timeframe} (target: ${targetCandleCount} candles)`);

    try {
      const existingCandles = await marketDataCache.getCachedCandles(
        symbol,
        timeframe,
        targetCandleCount
      );

      const actualCount = existingCandles.length;
      const completeness = (actualCount / targetCandleCount) * 100;

      if (actualCount >= targetCandleCount) {
        console.log(`✅ ${symbol} ${timeframe} has ${actualCount}/${targetCandleCount} candles (${completeness.toFixed(1)}% complete)`);
      } else {
        console.log(`⚠️ ${symbol} ${timeframe} has ${actualCount}/${targetCandleCount} candles (${completeness.toFixed(1)}% complete) - needs backfill`);
      }
    } catch (error) {
      console.error(`Error checking backfill for ${symbol} ${timeframe}:`, error);
    }
  }

}

export const multiTimeframeAggregator = new MultiTimeframeAggregator();
