import { Timeframe, CandleData, TickData } from './metaapi';
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
    startDate: Date,
    endDate: Date
  ): Promise<void> {
    console.log(`🔍 Backfilling ${symbol} ${timeframe} from ${startDate.toISOString()} to ${endDate.toISOString()}`);

    try {
      const existingCandles = await marketDataCache.getCachedCandles(
        symbol,
        timeframe,
        startDate,
        endDate
      );

      if (existingCandles.length > 0) {
        console.log(`Found ${existingCandles.length} existing candles for ${symbol} ${timeframe}`);
        const sortedCandles = existingCandles.sort((a, b) => a.time.getTime() - b.time.getTime());
        const gaps = this.detectTimeframeGaps(sortedCandles, timeframe, startDate, endDate);

        if (gaps.length > 0) {
          console.log(`Detected ${gaps.length} gaps in ${symbol} ${timeframe} data`);
        } else {
          console.log(`✅ No gaps detected in ${symbol} ${timeframe} data`);
        }
      } else {
        console.log(`⚠️ No existing data found for ${symbol} ${timeframe}, needs full backfill`);
      }
    } catch (error) {
      console.error(`Error backfilling ${symbol} ${timeframe}:`, error);
    }
  }

  private detectTimeframeGaps(
    candles: CandleData[],
    timeframe: Timeframe,
    startDate: Date,
    endDate: Date
  ): Array<{ start: Date; end: Date }> {
    if (candles.length < 2) return [];

    const gaps: Array<{ start: Date; end: Date }> = [];
    const timeframeMinutes = this.getTimeframeMinutes(timeframe);
    const expectedIntervalMs = timeframeMinutes * 60 * 1000;

    for (let i = 1; i < candles.length; i++) {
      const prevTime = candles[i - 1].time.getTime();
      const currTime = candles[i].time.getTime();
      const actualInterval = currTime - prevTime;

      if (actualInterval > expectedIntervalMs * 1.5) {
        gaps.push({
          start: new Date(prevTime + expectedIntervalMs),
          end: new Date(currTime)
        });
      }
    }

    return gaps;
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
}

export const multiTimeframeAggregator = new MultiTimeframeAggregator();
