import { metaApiService, CandleData, Timeframe, TickData } from './metaapi';
import { marketDataCache } from './market-data-cache';
import { candleCompletionService } from './candle-completion';
import { Time } from 'lightweight-charts';
import { getCandleOpenTime, isNewCandlePeriod, calculateStartTime as utilCalculateStartTime } from './candle-utils';
import { dataValidator } from './data-validator';
import { mergeHistoricalAndLiveCandles, detectGaps } from './candle-merge';
import { dbHealthMonitor } from './db-health-monitor';
import { dataQualityMonitor } from './data-quality-monitor';
import { multiTimeframeAggregator } from './multi-timeframe-aggregator';
import { timeframeBackfillService } from './timeframe-backfill';
import { marketHoursService } from './market-hours';
import { LivePricePolling, Tick } from './livePricePolling';

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

export interface DataQualityMetrics {
  errorCount: number;
  warningCount: number;
  repairedCount: number;
  totalCandles: number;
  lastUpdate: Date;
}

class MarketDataService {
  private activeSubscriptions: Map<string, Set<MarketDataListener>> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private dataQualityMetrics: Map<string, DataQualityMetrics> = new Map();
  private maxReconnectAttempts = 5;
  private isInitialized = false;
  private initializationAttempted = false;
  private symbolsInitialized: Set<string> = new Set();
  private chartDataCache: Map<string, { data: ChartCandleData[], volumeData: any[], timestamp: number }> = new Map();
  private readonly CHART_CACHE_TTL = 30000;
  private livePollers: Map<string, LivePricePolling> = new Map();
  private tickDebounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly TICK_DEBOUNCE_MS = 150;

  async getHistoricalData(
    symbol: string,
    timeframe: Timeframe,
    limit: number = 500,
    useCache: boolean = true,
    quickLoad: boolean = false
  ): Promise<CandleData[]> {
    const effectiveLimit = quickLoad ? Math.min(100, limit) : limit;
    let apiCandles: CandleData[] = [];
    // Always fetch live data for charts
    let shouldFetchApi = true;

    if (useCache) {
      const cachedCandles = await marketDataCache.getCachedCandles(
        symbol,
        timeframe,
        effectiveLimit
      );

      if (cachedCandles.length > 0) {
        const cacheValidation = this.validateCacheQuality(
          cachedCandles,
          timeframe,
          limit
        );

        console.log(`📊 Cache validation for ${symbol} ${timeframe}:`, {
          candleCount: `${cachedCandles.length}/${limit}`,
          isFresh: cacheValidation.isFresh,
          coversExpectedRange: cacheValidation.coversExpectedRange,
          hasCriticalGaps: cacheValidation.hasCriticalGaps,
          newestCandleAge: cacheValidation.newestCandleAge,
          recommendation: cacheValidation.shouldUseCacheOnly ? 'USE CACHE' : 'FETCH FROM API'
        });

        // In production, always fetch live data for charts
        console.log(`🔄 Fetching fresh live data: ${cacheValidation.reason}`);
      }
    }

    if (shouldFetchApi) {
      console.log(`📦 Using cached data only for ${symbol} ${timeframe} (live API fetch via polling)`);
      apiCandles = [];
    }

    const recentLiveCandles = await marketDataCache.getCompleteCandles(
      symbol,
      timeframe,
      100
    );

    const mergeResult = mergeHistoricalAndLiveCandles(
      apiCandles,
      recentLiveCandles,
      timeframe
    );

    if (!quickLoad) {
      Promise.resolve().then(() => marketDataCache.updateCandleCountStats(symbol, timeframe));
    }

    if (mergeResult.candles.length === 0) {
      console.warn(`⚠️ No data available for ${symbol} ${timeframe}`);
      return [];
    }

    return mergeResult.candles.slice(-effectiveLimit);
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
      this.symbolsInitialized.add(symbol);
      Promise.resolve().then(async () => {
        await multiTimeframeAggregator.initialize(symbol);
        console.log(`✅ Initialized multi-timeframe aggregation for ${symbol}`);
        timeframeBackfillService.checkAndBackfillAllTimeframes(symbol, timeframe).catch(err => {
          console.warn('Background backfill check failed:', err);
        });
      });
    } else {
      Promise.resolve().then(() => {
        timeframeBackfillService.checkAndBackfillTimeframe(symbol, timeframe).catch(err => {
          console.warn('Timeframe backfill check failed:', err);
        });
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

  convertToCandlestickData(candles: CandleData[], cacheKey?: string): ChartCandleData[] {
    if (cacheKey) {
      const cached = this.chartDataCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CHART_CACHE_TTL) {
        return cached.data;
      }
    }

    const result = candles.map(candle => ({
      time: Math.floor(candle.time.getTime() / 1000) as Time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close
    }));

    if (cacheKey) {
      const existing = this.chartDataCache.get(cacheKey);
      this.chartDataCache.set(cacheKey, {
        data: result,
        volumeData: existing?.volumeData || [],
        timestamp: Date.now()
      });
    }

    return result;
  }

  convertToVolumeData(candles: CandleData[], cacheKey?: string): { time: Time; value: number; color: string }[] {
    if (cacheKey) {
      const cached = this.chartDataCache.get(cacheKey);
      if (cached && cached.volumeData.length > 0 && Date.now() - cached.timestamp < this.CHART_CACHE_TTL) {
        return cached.volumeData;
      }
    }

    const result = candles.map(candle => ({
      time: Math.floor(candle.time.getTime() / 1000) as Time,
      value: candle.volume,
      color: candle.close >= candle.open ? '#10b98180' : '#ef444480'
    }));

    if (cacheKey) {
      const existing = this.chartDataCache.get(cacheKey);
      this.chartDataCache.set(cacheKey, {
        data: existing?.data || [],
        volumeData: result,
        timestamp: Date.now()
      });
    }

    return result;
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

    const timeframeMinutes = this.getTimeframeMinutes(timeframe);

    const tradingDays = marketHoursService.getTradingDaysBetween(startTime, endTime);
    const totalTradingDays = tradingDays.length;

    const candlesPerDay = (24 * 60) / timeframeMinutes;
    const expectedCandles = Math.floor(totalTradingDays * candlesPerDay);

    const completeness = expectedCandles > 0 ? Math.min(100, (candles.length / expectedCandles) * 100) : 0;

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

  private getCacheFreshnessThreshold(timeframe: Timeframe): number {
    const thresholds: Record<Timeframe, number> = {
      M1: 1 * 60 * 60 * 1000,
      M5: 4 * 60 * 60 * 1000,
      M15: 8 * 60 * 60 * 1000,
      M30: 12 * 60 * 60 * 1000,
      H1: 24 * 60 * 60 * 1000,
      H4: 48 * 60 * 60 * 1000,
      D1: 7 * 24 * 60 * 60 * 1000,
      W1: 14 * 24 * 60 * 60 * 1000,
      MN1: 30 * 24 * 60 * 60 * 1000
    };
    return thresholds[timeframe] || 8 * 60 * 60 * 1000;
  }

  private calculateExpectedStartDate(
    timeframe: Timeframe,
    limit: number,
    endDate: Date = new Date()
  ): Date {
    const timeframeMinutes = this.getTimeframeMinutes(timeframe);
    const tradingDaysRatio = 5 / 7;
    const totalMinutes = timeframeMinutes * limit;
    const adjustedMinutes = totalMinutes / tradingDaysRatio;
    const bufferMultiplier = 1.2;

    return new Date(endDate.getTime() - adjustedMinutes * 60 * 1000 * bufferMultiplier);
  }

  private validateCacheQuality(
    cachedCandles: CandleData[],
    timeframe: Timeframe,
    limit: number
  ): {
    shouldUseCacheOnly: boolean;
    isFresh: boolean;
    coversExpectedRange: boolean;
    hasCriticalGaps: boolean;
    newestCandleAge: string;
    reason?: string;
  } {
    if (cachedCandles.length === 0) {
      return {
        shouldUseCacheOnly: false,
        isFresh: false,
        coversExpectedRange: false,
        hasCriticalGaps: false,
        newestCandleAge: 'N/A',
        reason: 'No cached candles available'
      };
    }

    const now = new Date();
    const newestCandle = cachedCandles[cachedCandles.length - 1];
    const oldestCandle = cachedCandles[0];
    const newestCandleAge = now.getTime() - newestCandle.time.getTime();
    const freshnessThreshold = this.getCacheFreshnessThreshold(timeframe);
    const isFresh = newestCandleAge <= freshnessThreshold;

    const expectedStartDate = this.calculateExpectedStartDate(timeframe, limit, now);
    const coversExpectedRange = oldestCandle.time <= expectedStartDate;

    const gaps = detectGaps(cachedCandles, timeframe);
    const tradingDayGaps = gaps.filter(g => g.isTradingDayGap);
    const hasCriticalGaps = tradingDayGaps.length > 0;

    const validationResult = dataValidator.validateCandleSequence(cachedCandles, timeframe);
    const isSequenceValid = validationResult.isValid;

    const candlesInExpectedRange = cachedCandles.filter(
      c => c.time >= expectedStartDate && c.time <= now
    ).length;
    const hasMinimumCount = candlesInExpectedRange >= limit * 0.95;

    const ageInHours = (newestCandleAge / (60 * 60 * 1000)).toFixed(1);

    let reason: string | undefined;
    let shouldUseCacheOnly = true;

    if (!isFresh) {
      reason = `Cache is stale (newest candle is ${ageInHours}h old, threshold: ${(freshnessThreshold / (60 * 60 * 1000)).toFixed(1)}h)`;
      shouldUseCacheOnly = false;
    } else if (!coversExpectedRange) {
      reason = `Cache doesn't cover expected date range (oldest: ${oldestCandle.time.toISOString()}, expected: ${expectedStartDate.toISOString()})`;
      shouldUseCacheOnly = false;
    } else if (hasCriticalGaps) {
      reason = `Cache has ${tradingDayGaps.length} gap(s) during trading days`;
      shouldUseCacheOnly = false;
    } else if (!isSequenceValid) {
      reason = 'Cache has invalid candle sequence';
      shouldUseCacheOnly = false;
    } else if (!hasMinimumCount) {
      reason = `Insufficient candles in expected range (${candlesInExpectedRange}/${limit})`;
      shouldUseCacheOnly = false;
    }

    return {
      shouldUseCacheOnly,
      isFresh,
      coversExpectedRange,
      hasCriticalGaps,
      newestCandleAge: `${ageInHours}h`,
      reason
    };
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

      dbHealthMonitor.startMonitoring();
      candleCompletionService.start();
      console.log('✅ Market data service initialized successfully with LIVE MetaAPI connection');
      console.log('📡 Real-time streaming active for all subscribed symbols');
      console.log('🔍 Database health monitoring active');
      console.log('🔄 Candle completion service active');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Failed to initialize MetaApi:', errorMessage);
      dbHealthMonitor.startMonitoring();
      throw error;
    }
  }

  isConnected(): boolean {
    return metaApiService.isConnected();
  }

  async disconnect(): Promise<void> {
    this.stopAllLiveFeeds();
    this.activeSubscriptions.clear();
    this.reconnectAttempts.clear();
    this.symbolsInitialized.clear();
    dbHealthMonitor.stopMonitoring();
    candleCompletionService.stop();
    timeframeBackfillService.stop();
    await multiTimeframeAggregator.stop();
    await metaApiService.disconnect();
  }

  async getHistoricalDataWithCurrent(
    symbol: string,
    timeframe: Timeframe,
    limit: number = 500
  ): Promise<CandleData[]> {
    const candles = await marketDataCache.getCachedCandlesWithCurrent(
      symbol,
      timeframe,
      limit
    );

    if (candles.length === 0) {
      const fetchedCandles = await this.getHistoricalData(symbol, timeframe, limit, true, false);
      return fetchedCandles;
    }

    return candles;
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

  getDataQualityMetrics(symbol: string, timeframe: Timeframe): DataQualityMetrics | null {
    const cacheKey = `${symbol}_${timeframe}`;
    return this.dataQualityMetrics.get(cacheKey) || null;
  }

  clearDataQualityMetrics(symbol?: string, timeframe?: Timeframe): void {
    if (symbol && timeframe) {
      const cacheKey = `${symbol}_${timeframe}`;
      this.dataQualityMetrics.delete(cacheKey);
    } else {
      this.dataQualityMetrics.clear();
    }
  }

  startLiveFeed(symbol: string, timeframe: Timeframe = 'M5'): void {
    const key = `${symbol}_${timeframe}`;

    if (this.livePollers.has(key)) {
      console.log(`Live feed already active for ${symbol} ${timeframe}`);
      return;
    }

    const poller = new LivePricePolling(symbol, 2000);

    poller.onTick((tick: Tick) => {
      this.handlePollingTick(symbol, timeframe, tick);
    });

    poller.start();
    this.livePollers.set(key, poller);

    console.log(`✅ Started live feed polling for ${symbol} ${timeframe} (2s interval)`);
  }

  stopLiveFeed(symbol: string, timeframe: Timeframe = 'M5'): void {
    const key = `${symbol}_${timeframe}`;
    const poller = this.livePollers.get(key);

    if (poller) {
      poller.stop();
      this.livePollers.delete(key);
      console.log(`⏹️ Stopped live feed polling for ${symbol} ${timeframe}`);
    }

    const debounceTimer = this.tickDebounceTimers.get(key);
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      this.tickDebounceTimers.delete(key);
    }
  }

  stopAllLiveFeeds(): void {
    this.livePollers.forEach((poller, key) => {
      poller.stop();
      console.log(`⏹️ Stopped live feed polling for ${key}`);
    });
    this.livePollers.clear();

    this.tickDebounceTimers.forEach((timer) => clearTimeout(timer));
    this.tickDebounceTimers.clear();
  }

  private handlePollingTick(symbol: string, timeframe: Timeframe, tick: Tick): void {
    const key = `${symbol}_${timeframe}`;

    const existingTimer = this.tickDebounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      try {
        const price = tick.mid !== undefined
          ? tick.mid
          : (tick.bid !== undefined && tick.ask !== undefined
              ? (tick.bid + tick.ask) / 2
              : undefined);

        if (price === undefined) {
          console.warn('[handlePollingTick] No valid price data in tick:', tick);
          return;
        }

        const tickTime = new Date(tick.time);

        const updatedCandle = await marketDataCache.updateLiveCandle(
          symbol,
          timeframe,
          price,
          tickTime
        );

        if (updatedCandle) {
          const listeners = this.activeSubscriptions.get(key);
          if (listeners) {
            listeners.forEach(listener => {
              if (listener.onCandleUpdate) {
                listener.onCandleUpdate(updatedCandle);
              }
            });
          }

          const tickData: TickData = {
            symbol: tick.symbol,
            bid: tick.bid,
            ask: tick.ask,
            time: tickTime,
            brokerTime: tick.time
          };

          if (listeners) {
            listeners.forEach(listener => {
              if (listener.onTick) {
                listener.onTick(tickData);
              }
            });
          }
        }
      } catch (error) {
        console.error(`Error handling polling tick for ${symbol} ${timeframe}:`, error);
      }
    }, this.TICK_DEBOUNCE_MS);

    this.tickDebounceTimers.set(key, timer);
  }

  isLiveFeedActive(symbol: string, timeframe: Timeframe = 'M5'): boolean {
    const key = `${symbol}_${timeframe}`;
    const poller = this.livePollers.get(key);
    return poller ? poller.isActive() : false;
  }

  async fetchAndFillMissingCandles(
    symbol: string,
    timeframe: Timeframe,
    limit: number = 1000,
    onProgress?: (progress: { status: string; percent: number }) => void
  ): Promise<{
    success: boolean;
    candlesFetched: number;
    gapsFilled: number;
    completenessImprovement: { before: number; after: number };
    message: string;
  }> {
    try {
      console.log(`🔧 Starting comprehensive data fix for ${symbol} ${timeframe}...`);

      onProgress?.({ status: 'Analyzing current data...', percent: 10 });

      const currentCandles = await this.getHistoricalData(symbol, timeframe, limit, true, false);
      const currentValidation = await this.validateDataCompleteness(symbol, timeframe, currentCandles);
      const beforeCompleteness = currentValidation.completeness;

      console.log(`📊 Current state: ${currentCandles.length} candles, ${beforeCompleteness.toFixed(1)}% complete, ${currentValidation.gaps} gaps`);

      if (!this.isInitialized) {
        console.log('⚠️ MetaAPI not initialized, can only validate existing data');
        const validationResult = dataValidator.validateCandleSequence(currentCandles, timeframe);

        if (!validationResult.isValid) {
          const repairedCandles = dataValidator.validateAndRepairCandleSequence(currentCandles, timeframe, false);
          await marketDataCache.saveCandles(repairedCandles, true);

          return {
            success: true,
            candlesFetched: 0,
            gapsFilled: 0,
            completenessImprovement: { before: beforeCompleteness, after: beforeCompleteness },
            message: `Repaired ${validationResult.errors.length} invalid candles (MetaAPI not initialized)`
          };
        }

        return {
          success: false,
          candlesFetched: 0,
          gapsFilled: 0,
          completenessImprovement: { before: beforeCompleteness, after: beforeCompleteness },
          message: 'MetaAPI not initialized. Cannot fetch missing candles.'
        };
      }

      onProgress?.({ status: 'Clearing stale cache...', percent: 20 });
      await marketDataCache.clearSymbolTimeframe(symbol, timeframe);

      onProgress?.({ status: 'Fetching fresh data from MetaAPI...', percent: 30 });

      const endTime = new Date();
      const startTime = utilCalculateStartTime(timeframe, limit, endTime);

      console.log(`📡 Requesting ${limit} candles from MetaAPI for ${symbol} ${timeframe}...`);
      console.log(`   Date range: ${startTime.toISOString()} to ${endTime.toISOString()}`);

      let freshCandles: CandleData[] = [];
      try {
        freshCandles = await metaApiService.getHistoricalCandles(
          symbol,
          timeframe,
          startTime,
          limit
        );

        console.log(`✅ Received ${freshCandles.length} candles from MetaAPI`);
      } catch (apiError) {
        console.error('❌ Failed to fetch from MetaAPI:', apiError);
        return {
          success: false,
          candlesFetched: 0,
          gapsFilled: 0,
          completenessImprovement: { before: beforeCompleteness, after: beforeCompleteness },
          message: 'Failed to fetch data from MetaAPI. Please check connection and try again.'
        };
      }

      if (freshCandles.length === 0) {
        return {
          success: false,
          candlesFetched: 0,
          gapsFilled: 0,
          completenessImprovement: { before: beforeCompleteness, after: beforeCompleteness },
          message: 'MetaAPI returned no data for this symbol/timeframe'
        };
      }

      onProgress?.({ status: 'Validating and repairing data...', percent: 60 });

      const validationResult = dataValidator.validateCandleSequence(freshCandles, timeframe);
      console.log(`📊 Fresh data validation: ${validationResult.isValid ? 'valid' : `${validationResult.errors.length} errors`}`);

      let finalCandles = freshCandles;
      if (!validationResult.isValid) {
        console.log('🔧 Auto-repairing fetched candles...');
        finalCandles = dataValidator.validateAndRepairCandleSequence(freshCandles, timeframe, false);
      }

      onProgress?.({ status: 'Detecting gaps...', percent: 70 });
      const gaps = detectGaps(finalCandles, timeframe);
      const tradingGaps = gaps.filter(g => g.isTradingDayGap);
      console.log(`🔍 Gap analysis: ${gaps.length} total gaps, ${tradingGaps.length} during trading hours`);

      onProgress?.({ status: 'Saving to cache...', percent: 80 });
      await marketDataCache.saveCandles(finalCandles, true);

      onProgress?.({ status: 'Verifying saved data...', percent: 85 });
      await new Promise(resolve => setTimeout(resolve, 500));

      const verifyCandles = await marketDataCache.getCachedCandles(symbol, timeframe, limit);
      console.log(`🔍 Verification: ${verifyCandles.length} candles in cache after save`);

      onProgress?.({ status: 'Calculating improvements...', percent: 90 });
      const afterValidation = await this.validateDataCompleteness(symbol, timeframe, verifyCandles);
      const afterCompleteness = afterValidation.completeness;

      const improvement = afterCompleteness - beforeCompleteness;
      const candlesFetched = finalCandles.length - currentCandles.length;

      const cacheKey = `${symbol}_${timeframe}`;
      const metrics: DataQualityMetrics = {
        errorCount: 0,
        warningCount: afterValidation.gaps,
        repairedCount: validationResult.errors.length,
        totalCandles: finalCandles.length,
        lastUpdate: new Date()
      };
      this.dataQualityMetrics.set(cacheKey, metrics);

      onProgress?.({ status: 'Complete!', percent: 100 });

      const message = `Successfully fetched ${finalCandles.length} candles. Data quality improved from ${beforeCompleteness.toFixed(0)}% to ${afterCompleteness.toFixed(0)}%.`;

      console.log(`✅ ${message}`);
      console.log(`   New candles: ${candlesFetched}`);
      console.log(`   Remaining gaps: ${afterValidation.gaps}`);

      return {
        success: true,
        candlesFetched: finalCandles.length,
        gapsFilled: Math.max(0, currentValidation.gaps - afterValidation.gaps),
        completenessImprovement: {
          before: beforeCompleteness,
          after: afterCompleteness
        },
        message
      };

    } catch (error) {
      console.error('❌ Comprehensive data fix failed:', error);
      return {
        success: false,
        candlesFetched: 0,
        gapsFilled: 0,
        completenessImprovement: { before: 0, after: 0 },
        message: error instanceof Error ? error.message : 'Failed to fix data'
      };
    }
  }

  async manuallyFixDataGaps(
    symbol: string,
    timeframe: Timeframe,
    limit: number = 500
  ): Promise<{ success: boolean; repairedCount: number; message: string }> {
    try {
      console.log(`🔧 Starting manual data repair for ${symbol} ${timeframe}...`);

      const result = await this.fetchAndFillMissingCandles(symbol, timeframe, limit);

      return {
        success: result.success,
        repairedCount: result.candlesFetched,
        message: result.message
      };
    } catch (error) {
      console.error('❌ Manual data repair failed:', error);
      return {
        success: false,
        repairedCount: 0,
        message: error instanceof Error ? error.message : 'Failed to repair data'
      };
    }
  }

}

export const marketDataService = new MarketDataService();
