import { metaApiService, CandleData, Timeframe, TickData } from './metaapi';
import { marketDataCache } from './market-data-cache';
import { Time } from 'lightweight-charts';
import { getCandleOpenTime, isNewCandlePeriod, calculateStartTime as utilCalculateStartTime } from './candle-utils';
import { dataValidator } from './data-validator';
import { mergeHistoricalAndLiveCandles, detectGaps } from './candle-merge';
import { dbHealthMonitor } from './db-health-monitor';
import { dataQualityMonitor } from './data-quality-monitor';
import { multiTimeframeAggregator } from './multi-timeframe-aggregator';
import { timeframeBackfillService } from './timeframe-backfill';

export interface MarketDataListener {
  onCandleUpdate?: (candle: CandleData) => void;
  onTick?: (tick: TickData) => void;
  onError?: (error: Error) => void;
}

export type { TickData } from './metaapi';

export interface ChartCandleData {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
}

class MarketDataService {
  private activeSubscriptions: Map<string, Set<MarketDataListener>> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private maxReconnectAttempts = 5;
  private isInitialized = false;
  private initializationAttempted = false;
  private isDemoMode = false;
  private symbolsInitialized: Set<string> = new Set();

  async getHistoricalData(
    symbol: string,
    timeframe: Timeframe,
    limit: number = 500,
    useCache: boolean = true
  ): Promise<CandleData[]> {
    const endTime = new Date();
    const startTime = utilCalculateStartTime(timeframe, limit, endTime);
    const oneDayAgo = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);

    let apiCandles: CandleData[] = [];
    let shouldFetchApi = !this.isDemoMode;

    if (useCache) {
      const cachedCandles = await marketDataCache.getCachedCandles(
        symbol,
        timeframe,
        startTime,
        endTime
      );

      const recentCandles = cachedCandles.filter(c => c.time >= oneDayAgo);
      const hasRecentData = recentCandles.length > 0;

      const validationResult = dataValidator.validateCandleSequence(cachedCandles, timeframe);
      const hasGaps = detectGaps(cachedCandles, timeframe).length > 0;

      if (cachedCandles.length >= limit * 0.98 && hasRecentData && !this.isDemoMode && validationResult.isValid && !hasGaps) {
        shouldFetchApi = false;
        apiCandles = cachedCandles;
        console.log(`✅ Using ${cachedCandles.length} cached candles (validated, no gaps) for ${symbol} ${timeframe}`);
      } else if (this.isDemoMode && cachedCandles.length > 0) {
        apiCandles = cachedCandles;
        shouldFetchApi = false;
        console.log(`💾 Demo mode: Using ${cachedCandles.length} cached candles for ${symbol} ${timeframe}`);
      }
    }

    if (shouldFetchApi && !this.isDemoMode) {
      try {
        const liveCandles = await metaApiService.getHistoricalCandles(
          symbol,
          timeframe,
          startTime,
          limit
        );

        const validationResult = dataValidator.validateCandleSequence(liveCandles, timeframe);
        dataValidator.logValidationResults(validationResult, `${symbol} ${timeframe} API data`);

        apiCandles = validationResult.isValid
          ? liveCandles
          : liveCandles.map(c => dataValidator.repairCandle(c));

        if (apiCandles.length > 0 && useCache) {
          await marketDataCache.saveCandles(apiCandles, true);
        }

        console.log(`📡 Fetched ${apiCandles.length} candles from MetaAPI for ${symbol} ${timeframe}`);
      } catch (error) {
        console.error('Error fetching from MetaAPI:', error);
        const cachedCandles = await marketDataCache.getCachedCandles(
          symbol,
          timeframe,
          startTime,
          endTime
        );
        if (cachedCandles.length > 0) {
          apiCandles = cachedCandles;
          console.log(`⚠️ MetaApi error, using ${cachedCandles.length} cached candles`);
        } else {
          throw error;
        }
      }
    }

    const recentLiveCandles = await marketDataCache.getRecentLiveCandles(
      symbol,
      timeframe,
      24
    );

    const mergeResult = mergeHistoricalAndLiveCandles(
      apiCandles,
      recentLiveCandles,
      timeframe
    );

    console.log(`🔀 Merge results for ${symbol} ${timeframe}:`, {
      apiCandles: mergeResult.stats.apiCandles,
      liveCandles: mergeResult.stats.dbCandles,
      duplicatesRemoved: mergeResult.stats.duplicatesRemoved,
      gapsFilled: mergeResult.stats.gapsFilled,
      total: mergeResult.stats.totalCandles
    });

    const gaps = detectGaps(mergeResult.candles, timeframe);
    if (gaps.length > 0) {
      console.warn(`⚠️ Detected ${gaps.length} gap(s) in candle data for ${symbol} ${timeframe}:`, gaps.map(g => ({
        start: g.start.toISOString(),
        end: g.end.toISOString(),
        tradingDays: g.missingTradingDays.length
      })));

      const tradingDayGaps = gaps.filter(g => g.isTradingDayGap);
      if (tradingDayGaps.length > 0 && !this.isDemoMode) {
        console.log(`🔍 Attempting to fill ${tradingDayGaps.length} trading day gap(s) for ${symbol} ${timeframe}...`);
        const gapFilledCandles = await this.fetchMissingGapData(
          symbol,
          timeframe,
          tradingDayGaps,
          mergeResult.candles
        );
        if (gapFilledCandles.length > mergeResult.candles.length) {
          console.log(`✅ Filled gaps: ${gapFilledCandles.length - mergeResult.candles.length} new candles added for ${symbol} ${timeframe}`);

          await marketDataCache.updateDataCompletenessStats(symbol, timeframe, {
            totalCandles: gapFilledCandles.length,
            dateRangeStart: gapFilledCandles[0]?.time,
            dateRangeEnd: gapFilledCandles[gapFilledCandles.length - 1]?.time,
            gapsDetected: 0,
            lastValidated: new Date()
          });

          return gapFilledCandles;
        }
      }
    } else {
      await marketDataCache.updateDataCompletenessStats(symbol, timeframe, {
        totalCandles: mergeResult.candles.length,
        dateRangeStart: mergeResult.candles[0]?.time,
        dateRangeEnd: mergeResult.candles[mergeResult.candles.length - 1]?.time,
        gapsDetected: 0,
        lastValidated: new Date()
      });
    }

    if (mergeResult.candles.length === 0) {
      console.warn(`⚠️ No data available for ${symbol} ${timeframe}`);
      return [];
    }

    return mergeResult.candles;
  }

  async subscribeToSymbol(
    symbol: string,
    timeframe: Timeframe,
    listener: MarketDataListener
  ): Promise<void> {
    const key = `${symbol}_${timeframe}`;

    if (!this.activeSubscriptions.has(key)) {
      this.activeSubscriptions.set(key, new Set());
    }

    this.activeSubscriptions.get(key)!.add(listener);

    dataQualityMonitor.initializeSymbol(symbol, timeframe);

    if (!this.symbolsInitialized.has(symbol)) {
      await multiTimeframeAggregator.initialize(symbol);
      this.symbolsInitialized.add(symbol);
      console.log(`✅ Initialized multi-timeframe aggregation for ${symbol}`);

      if (!this.isDemoMode) {
        timeframeBackfillService.checkAndBackfillAllTimeframes(symbol, timeframe).catch(err => {
          console.warn('Background backfill check failed:', err);
        });
      }
    } else if (!this.isDemoMode) {
      timeframeBackfillService.checkAndBackfillTimeframe(symbol, timeframe).catch(err => {
        console.warn('Timeframe backfill check failed:', err);
      });
    }

    if (this.activeSubscriptions.get(key)!.size === 1) {
      try {
        await metaApiService.subscribeToMarketData(symbol, {
          onCandleUpdate: (candle) => {
            if (candle.timeframe === timeframe) {
              this.handleCandleUpdate(key, candle);
            }
          },
          onTick: (tick) => {
            this.handleTickUpdate(key, tick);
            multiTimeframeAggregator.processTick(tick);
          }
        });

        await marketDataCache.updateSubscription(symbol, timeframe, 'active');
        this.reconnectAttempts.set(key, 0);

        console.log(`Subscribed to ${symbol} ${timeframe}`);
      } catch (error) {
        console.error(`Failed to subscribe to ${symbol} ${timeframe}:`, error);

        if (listener.onError) {
          listener.onError(error as Error);
        }

        this.handleReconnect(key, symbol, timeframe);
      }
    }
  }

  async unsubscribeFromSymbol(
    symbol: string,
    timeframe: Timeframe,
    listener: MarketDataListener
  ): Promise<void> {
    const key = `${symbol}_${timeframe}`;
    const listeners = this.activeSubscriptions.get(key);

    if (listeners) {
      listeners.delete(listener);

      if (listeners.size === 0) {
        this.activeSubscriptions.delete(key);
        await metaApiService.unsubscribeFromMarketData(symbol);
        await marketDataCache.updateSubscription(symbol, timeframe, 'inactive');

        console.log(`Unsubscribed from ${symbol} ${timeframe}`);
      }
    }
  }

  async getCurrentPrice(symbol: string): Promise<{ bid: number; ask: number }> {
    try {
      return await metaApiService.getSymbolPrice(symbol);
    } catch (error) {
      console.error(`Error getting current price for ${symbol}:`, error);
      throw error;
    }
  }

  convertToCandlestickData(candles: CandleData[]): ChartCandleData[] {
    return candles.map(candle => ({
      time: Math.floor(candle.time.getTime() / 1000) as Time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close
    }));
  }

  convertToVolumeData(candles: CandleData[]): { time: Time; value: number; color: string }[] {
    return candles.map(candle => ({
      time: Math.floor(candle.time.getTime() / 1000) as Time,
      value: candle.volume,
      color: candle.close >= candle.open ? '#10b98180' : '#ef444480'
    }));
  }

  async getCacheStats(symbol: string, timeframe: Timeframe) {
    return await marketDataCache.getCacheStats(symbol, timeframe);
  }

  async getDataHealthStatus(symbol: string, timeframe: Timeframe) {
    return await marketDataCache.getDataCompletenessStats(symbol, timeframe);
  }

  async validateDataCompleteness(
    symbol: string,
    timeframe: Timeframe,
    candles: CandleData[]
  ): Promise<{ isComplete: boolean; gaps: number; completeness: number }> {
    const gaps = detectGaps(candles, timeframe);
    const tradingDayGaps = gaps.filter(g => g.isTradingDayGap);

    if (candles.length === 0) {
      return { isComplete: false, gaps: 0, completeness: 0 };
    }

    const startTime = candles[0].time;
    const endTime = candles[candles.length - 1].time;
    const totalMinutes = (endTime.getTime() - startTime.getTime()) / (60 * 1000);

    const timeframeMinutes = this.getTimeframeMinutes(timeframe);
    const tradingDaysRatio = 5 / 7;
    const expectedCandles = Math.floor((totalMinutes / timeframeMinutes) * tradingDaysRatio);

    const completeness = expectedCandles > 0 ? (candles.length / expectedCandles) * 100 : 0;

    return {
      isComplete: tradingDayGaps.length === 0 && completeness >= 98,
      gaps: tradingDayGaps.length,
      completeness
    };
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

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (this.initializationAttempted) {
      return;
    }

    this.initializationAttempted = true;

    try {
      await metaApiService.initialize();
      this.isInitialized = true;
      this.isDemoMode = false;

      dbHealthMonitor.startMonitoring();
      console.log('✅ Market data service initialized successfully');
      console.log('🔍 Database health monitoring active');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes('not configured') || errorMessage.includes('demo mode')) {
        this.isDemoMode = true;
        console.warn('⚠️ Running in demo mode with cached data only');
      } else {
        console.error('❌ Failed to initialize MetaApi:', errorMessage);
        this.isDemoMode = true;
      }

      dbHealthMonitor.startMonitoring();
      throw error;
    }
  }

  isConnected(): boolean {
    return metaApiService.isConnected();
  }

  async disconnect(): Promise<void> {
    this.activeSubscriptions.clear();
    this.reconnectAttempts.clear();
    this.symbolsInitialized.clear();
    dbHealthMonitor.stopMonitoring();
    timeframeBackfillService.stop();
    await multiTimeframeAggregator.stop();
    await metaApiService.disconnect();
  }

  private handleCandleUpdate(key: string, candle: CandleData): void {
    const listeners = this.activeSubscriptions.get(key);

    if (listeners) {
      listeners.forEach(listener => {
        if (listener.onCandleUpdate) {
          listener.onCandleUpdate(candle);
        }
      });

      marketDataCache.saveCandles([candle]).catch(err => {
        console.error('Error saving candle to cache:', err);
      });
    }
  }

  private handleTickUpdate(key: string, tick: TickData): void {
    const listeners = this.activeSubscriptions.get(key);

    dataQualityMonitor.recordTick(tick);

    if (listeners) {
      listeners.forEach(listener => {
        if (listener.onTick) {
          listener.onTick(tick);
        }
      });
    }
  }

  private async fetchMissingGapData(
    symbol: string,
    timeframe: Timeframe,
    gaps: Array<{ start: Date; end: Date; missingTradingDays: Date[] }>,
    existingCandles: CandleData[]
  ): Promise<CandleData[]> {
    const candleMap = new Map<number, CandleData>();

    for (const candle of existingCandles) {
      candleMap.set(candle.time.getTime(), candle);
    }

    for (const gap of gaps) {
      if (gap.missingTradingDays.length === 0) continue;

      try {
        console.log(`Fetching gap data for ${symbol} from ${gap.start.toISOString()} to ${gap.end.toISOString()}`);

        const gapStartTime = new Date(gap.start);
        gapStartTime.setHours(0, 0, 0, 0);

        const gapEndTime = new Date(gap.end);
        gapEndTime.setHours(23, 59, 59, 999);

        const gapCandles = await metaApiService.getHistoricalCandles(
          symbol,
          timeframe,
          gapStartTime,
          1000
        );

        const relevantGapCandles = gapCandles.filter(
          c => c.time >= gap.start && c.time <= gap.end
        );

        for (const candle of relevantGapCandles) {
          const normalizedTime = candle.time.getTime();
          if (!candleMap.has(normalizedTime)) {
            candleMap.set(normalizedTime, candle);
          }
        }

        if (relevantGapCandles.length > 0) {
          await marketDataCache.saveCandles(relevantGapCandles, true);
          console.log(`✅ Filled gap with ${relevantGapCandles.length} candles`);
        } else {
          console.warn(`⚠️ No data available for gap period`);
        }
      } catch (error) {
        console.error(`Failed to fetch gap data:`, error);
      }
    }

    return Array.from(candleMap.values()).sort((a, b) => a.time.getTime() - b.time.getTime());
  }

  private async handleReconnect(
    key: string,
    symbol: string,
    timeframe: Timeframe
  ): Promise<void> {
    const attempts = this.reconnectAttempts.get(key) || 0;

    if (attempts < this.maxReconnectAttempts) {
      const delay = Math.min(1000 * Math.pow(2, attempts), 30000);
      this.reconnectAttempts.set(key, attempts + 1);

      console.log(`Attempting to reconnect ${symbol} ${timeframe} in ${delay}ms (attempt ${attempts + 1}/${this.maxReconnectAttempts})`);

      setTimeout(async () => {
        try {
          const listeners = this.activeSubscriptions.get(key);
          if (listeners && listeners.size > 0) {
            await metaApiService.subscribeToMarketData(symbol, {
              onCandleUpdate: (candle) => {
                if (candle.timeframe === timeframe) {
                  this.handleCandleUpdate(key, candle);
                }
              },
              onTick: (tick) => {
                this.handleTickUpdate(key, tick);
              }
            });

            this.reconnectAttempts.set(key, 0);
            console.log(`Successfully reconnected to ${symbol} ${timeframe}`);
          }
        } catch (error) {
          console.error(`Reconnect attempt failed for ${symbol} ${timeframe}:`, error);
          this.handleReconnect(key, symbol, timeframe);
        }
      }, delay);
    } else {
      console.error(`Max reconnection attempts reached for ${symbol} ${timeframe}`);
      const listeners = this.activeSubscriptions.get(key);
      if (listeners) {
        listeners.forEach(listener => {
          if (listener.onError) {
            listener.onError(new Error('Max reconnection attempts reached'));
          }
        });
      }
    }
  }

}

export const marketDataService = new MarketDataService();
