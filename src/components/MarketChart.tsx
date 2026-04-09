import React, { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, IChartApi, ISeriesApi, LineStyle, LineSeries } from 'lightweight-charts';
import { supabase } from '@/lib/supabase';
import { Activity, AlertCircle, Clock, RefreshCw } from 'lucide-react';
import { chartPreferencesService, Timeframe, type IndicatorVisibility } from '@/services/chart-preferences';
import { globalPollingCoordinator } from '@/services/global-polling-coordinator';
import { pollingConfigService } from '@/services/polling-config-service';
import {
  fetchCompleteChartData,
  fetchCompleteChartDataByTime,
  fetchCandlesByTimeRange,
  fetchRecentRealtimePrices,
  aggregatePricesToCurrentCandle,
  getTimeframeMinutes,
  validateCandleAgainstHistorical,
  sanitizeCandleData,
  sanitizeCandleArray,
  ensureUnixTimestamp,
  CandleData,
  RealtimePrice as RealtimePriceType
} from '@/services/candle-data-service';
import { candlePersistenceService } from '@/services/candle-persistence-service';
import { chartCandlePoller } from '@/services/chart-candle-poller';
import { backgroundCandleAggregator } from '@/services/background-candle-aggregator';
import { chartDirectPricePoller } from '@/services/chart-direct-price-poller';
import { candleCacheManager } from '@/services/candle-cache-manager';
import {
  calculateVWAP,
  calculateSessionVWAP,
  calculateWeeklySessionVWAP,
  smoothVWAPForDisplay,
  calculateEMA,
  calculateRSI,
  calculateATR,
  calculateVolumeMetrics,
  detectCandlePatterns,
  IndicatorResult,
  VolumeData,
  PatternDetection
} from '@/utils/technicalIndicators';
import { getForexMarketStatus, getTimeUntilMarketChange, getSymbolMarketStatus, type MarketStatus, type SymbolMarketStatus } from '@/utils/marketHours';
import { concurrentBulkLoader } from '@/services/concurrent-bulk-loader';
import { ChartLoadingOverlay, BackgroundLoadingIndicator } from '@/components/ChartLoadingOverlay';
import { priceValidationService } from '@/services/price-validation-service';
import { chartCircuitBreaker } from '@/services/chart-circuit-breaker';
import { validateSymbol, type ValidatedSymbol } from '@/types/symbol';
import { ChartDataGuarantor } from '@/services/chart-data-guarantor';
import { currentCandleReconstructor } from '@/services/current-candle-reconstructor';
import { shouldDisableMetaAPI, isWebContainer } from '@/lib/environment';
import { circuitBreakerService } from '@/services/circuit-breaker-service';
import { formatPrice, formatSpread } from '@/utils/chartFormatters';

interface MarketChartProps {
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  tradeLines?: {
    entry?: number;
    stopLoss?: number;
    takeProfit?: number; // Legacy support - will be shown as TP2 if tp1/tp2 not provided
    tp1?: number; // Conservative high-probability target
    tp2?: number; // Full profit target
    watchedLevel?: number;
    earlyExitLevel?: number;
  };
  onTradeExecuted?: () => void;
  onPriceUpdate?: (price: number, priceChange: number) => void;
}

interface CurrentCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  startTime: number;
}

export function MarketChart({ symbol, onSymbolChange, tradeLines, onTradeExecuted, onPriceUpdate }: MarketChartProps) {
  // CRITICAL: Validate and track current symbol to reject cross-contaminated updates
  const validationResult = validateSymbol(symbol);
  if (!validationResult.isValid) {
    console.error(`[Chart] Invalid symbol provided: ${symbol}`);
    return <div className="text-red-500 p-4">Error: Invalid symbol {symbol}</div>;
  }

  const validatedSymbol = validationResult.symbol!;
  const currentSymbolRef = useRef<ValidatedSymbol>(validatedSymbol);
  const isMountedRef = useRef<boolean>(true);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema50SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema200SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const tradeLineRefs = useRef<{
    entry?: any;
    stopLoss?: any;
    takeProfit?: any; // Legacy
    tp1?: any; // Conservative target
    tp2?: any; // Full target
    watchedLevel?: any;
    earlyExitLevel?: any;
  }>({});
  const bidLineRef = useRef<any>(null);
  const askLineRef = useRef<any>(null);
  const midLineRef = useRef<any>(null);
  const daySeparatorOverlayRef = useRef<HTMLDivElement>(null);
  const daySeparatorRafRef = useRef<number | null>(null);
  const sessionBandsOverlayRef = useRef<HTMLDivElement>(null);
  const sessionBandsRafRef = useRef<number | null>(null);

  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [bidPrice, setBidPrice] = useState<number | null>(null);
  const [askPrice, setAskPrice] = useState<number | null>(null);
  const [spread, setSpread] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [backgroundLoading, setBackgroundLoading] = useState<{ completed: number; total: number; currentBatch: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [priceUpdateFlash, setPriceUpdateFlash] = useState(false);
  const [updateCount, setUpdateCount] = useState(0);
  const [debugInfo, setDebugInfo] = useState<string>('');
  const [dataQualityWarning, setDataQualityWarning] = useState<string | null>(null);
  const [dataCompleteness, setDataCompleteness] = useState<{ isComplete: boolean; candleCount: number; targetCount: number } | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>(() => chartPreferencesService.getTimeframe(symbol));
  const [isLive, setIsLive] = useState(false);
  const [systemStatus, setSystemStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connected');
  const [marketStatus, setMarketStatus] = useState<'live' | 'delayed' | 'offline'>('live');
  const [priceSource, setPriceSource] = useState<'metaapi' | 'database' | 'offline'>('offline');
  const [cryptoDataSource, setCryptoDataSource] = useState<string | null>(null);
  const [directPollerActive, setDirectPollerActive] = useState(false);
  const [isDatabaseOnlyMode, setIsDatabaseOnlyMode] = useState(shouldDisableMetaAPI());
  const [forexMarketStatus, setForexMarketStatus] = useState<MarketStatus>(() => getForexMarketStatus());
  const [symbolMarketStatus, setSymbolMarketStatus] = useState<SymbolMarketStatus>(() => getSymbolMarketStatus(symbol));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [cacheAge, setCacheAge] = useState<number | null>(null);

  const [rsiData, setRsiData] = useState<IndicatorResult[]>([]);
  const [atrData, setAtrData] = useState<IndicatorResult[]>([]);
  const [volumeData, setVolumeData] = useState<VolumeData[]>([]);
  const [patternData, setPatternData] = useState<PatternDetection[]>([]);

  const [vwapValue, setVwapValue] = useState<number | null>(null);
  const [ema20Value, setEma20Value] = useState<number | null>(null);
  const [ema50Value, setEma50Value] = useState<number | null>(null);
  const [ema200Value, setEma200Value] = useState<number | null>(null);
  const [indicatorVisibility, setIndicatorVisibility] = useState<IndicatorVisibility>({
    vwap: true,
    ema20: true,
    ema50: false,
    ema200: false
  });
  const [showDaySeparators, setShowDaySeparators] = useState<boolean>(() =>
    chartPreferencesService.getShowDaySeparators()
  );
  const [showSessionBands, setShowSessionBands] = useState<boolean>(() =>
    chartPreferencesService.getShowSessionBands()
  );

  const currentCandleRef = useRef<CurrentCandle | null>(null);
  const lastFetchTimeRef = useRef<string | null>(null);
  const historicalCandlesRef = useRef<CandleData[]>([]);
  const updateQueueRef = useRef<number[]>([]);
  const isUpdatingRef = useRef<boolean>(false);
  const userInteractedRef = useRef<boolean>(false);
  const liveTickStreamActive = useRef<boolean>(false);
  const lastTickUpdateRef = useRef<number>(0);
  const renderFrameRef = useRef<number | null>(null);
  const safeguardTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isChartReadyRef = useRef<boolean>(false);
  const isInitializingRef = useRef<boolean>(false);

  // Notify parent component of price updates
  useEffect(() => {
    if (currentPrice !== null && onPriceUpdate) {
      onPriceUpdate(currentPrice, priceChange);
    }
  }, [currentPrice, priceChange, onPriceUpdate]);

  useEffect(() => {
    // CRITICAL FIX: Track symbol-specific market status, not forex-only status
    let previousMarketStatus = symbolMarketStatus.isOpen;

    const updateMarketStatus = () => {
      const newStatus = getForexMarketStatus();
      const newSymbolStatus = getSymbolMarketStatus(symbol);
      const wasOpen = previousMarketStatus;
      const isNowOpen = newSymbolStatus.isOpen; // Use symbol-specific status

      setForexMarketStatus(newStatus);
      setSymbolMarketStatus(newSymbolStatus);

      // Market just closed - freeze time range (ONLY for forex, crypto never closes)
      if (wasOpen && !isNowOpen && isMountedRef.current && chartRef.current && !newSymbolStatus.is24Hour) {
        if (import.meta.env.DEV) {
          console.log(`[Chart] ${symbol} market closed - freezing range`);
        }
        try {
          const timeScale = chartRef.current.timeScale();
          const currentRange = timeScale.getVisibleLogicalRange();

          if (currentRange) {
            timeScale.setVisibleLogicalRange(currentRange);
          }
        } catch (error) {
          console.warn('[Chart] timeScale operation error (chart may be disposed)');
        }
      }

      // Market just opened - resume real-time scrolling (ONLY for forex, crypto never stopped)
      if (!wasOpen && isNowOpen && isMountedRef.current && chartRef.current && !newSymbolStatus.is24Hour) {
        if (import.meta.env.DEV) {
          console.log(`[Chart] ${symbol} market opened`);
        }
        try {
          chartRef.current.timeScale().scrollToRealTime();
        } catch (error) {
          console.warn('[Chart] scrollToRealTime error (chart may be disposed)');
        }
      }

      previousMarketStatus = isNowOpen;
    };

    updateMarketStatus();
    const interval = setInterval(updateMarketStatus, 60000);

    return () => clearInterval(interval);
  }, [symbol]); // Re-check when symbol changes

  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.hidden) {
        // Cancel any pending render frames
        if (renderFrameRef.current) {
          cancelAnimationFrame(renderFrameRef.current);
          renderFrameRef.current = null;
        }
        // Reduce polling frequency when tab is hidden
        chartCandlePoller.pause();
      } else {

        // Resume polling FIRST so the system is ready
        chartCandlePoller.resume();

        // ENHANCED: Smart catchup - fetch ALL candles created while user was away
        try {
          if (historicalCandlesRef.current.length > 0) {
            const lastKnownTime = historicalCandlesRef.current[historicalCandlesRef.current.length - 1].time;
            const lastKnownDate = new Date(lastKnownTime * 1000);
            const now = new Date();
            const hoursAway = (now.getTime() - lastKnownDate.getTime()) / (1000 * 60 * 60);


            // If user was away for more than 5 minutes, fetch all missed candles
            if (hoursAway > (5 / 60)) {

              // Fetch candles from the last known time until now
              const lookbackHours = Math.min(Math.ceil(hoursAway) + 1, 24); // Cap at 24 hours
              const allCandles = await fetchCandlesByTimeRange(symbol, timeframe, lookbackHours);

              // Filter to only NEW candles after last known
              const newCandles = allCandles.filter(c => c.time > lastKnownTime);

              if (newCandles.length > 0) {
                if (import.meta.env.DEV) {
                  console.log(`[Chart] Found ${newCandles.length} missed candles`);
                }

                // Add new candles to historical data
                historicalCandlesRef.current = [...historicalCandlesRef.current, ...newCandles];

                // Update chart with new candles
                if (candlestickSeriesRef.current) {
                  newCandles.forEach(candle => {
                    try {
                      candlestickSeriesRef.current?.update(candle);
                    } catch (error) {
                      console.error('[Chart] Error updating candle:', error);
                    }
                  });
                }

                // Update price and indicators with latest candle
                const latestCandle = newCandles[newCandles.length - 1];
                setCurrentPrice(latestCandle.close);

                if (historicalCandlesRef.current.length >= 2) {
                  const firstCandle = historicalCandlesRef.current[0];
                  setPriceChange(((latestCandle.close - firstCandle.open) / firstCandle.open) * 100);
                }

              }

              // CRITICAL FIX: Reconstruct current candle after catchup
              const lastHistoricalTime = historicalCandlesRef.current[historicalCandlesRef.current.length - 1].time;

              try {
                const reconstruction = await currentCandleReconstructor.reconstructCurrentCandle(
                  symbol,
                  timeframe,
                  lastHistoricalTime
                );

                if (reconstruction.wasReconstructed && reconstruction.candle) {
                  if (import.meta.env.DEV) {
                    console.log(`[Chart] Reconstructed from ${reconstruction.tickCount} ticks`);
                  }

                  const safeCurrentCandle: CandleData = {
                    time: Number(reconstruction.candle.time),
                    open: Number(reconstruction.candle.open),
                    high: Number(reconstruction.candle.high),
                    low: Number(reconstruction.candle.low),
                    close: Number(reconstruction.candle.close)
                  };

                  currentCandleRef.current = {
                    ...safeCurrentCandle,
                    startTime: safeCurrentCandle.time * 1000
                  };

                  if (candlestickSeriesRef.current) {
                    candlestickSeriesRef.current.update(safeCurrentCandle);
                    setCurrentPrice(safeCurrentCandle.close);
                  }

                  console.log('[Chart] 💾 Current candle state restored');
                } else {
                  console.log('[Chart] ℹ️ No current candle to reconstruct');
                  currentCandleRef.current = null;
                }
              } catch (error) {
                console.error('[Chart] Error reconstructing current candle:', error);
                currentCandleRef.current = null;
              }
            } else {

              // Still reconstruct current candle even for brief absences
              if (historicalCandlesRef.current.length > 0) {
                const lastHistoricalTime = historicalCandlesRef.current[historicalCandlesRef.current.length - 1].time;

                try {
                  const reconstruction = await currentCandleReconstructor.reconstructCurrentCandle(
                    symbol,
                    timeframe,
                    lastHistoricalTime
                  );

                  if (reconstruction.wasReconstructed && reconstruction.candle) {
                    const safeCurrentCandle: CandleData = {
                      time: Number(reconstruction.candle.time),
                      open: Number(reconstruction.candle.open),
                      high: Number(reconstruction.candle.high),
                      low: Number(reconstruction.candle.low),
                      close: Number(reconstruction.candle.close)
                    };

                    currentCandleRef.current = {
                      ...safeCurrentCandle,
                      startTime: safeCurrentCandle.time * 1000
                    };

                    if (candlestickSeriesRef.current) {
                      candlestickSeriesRef.current.update(safeCurrentCandle);
                      setCurrentPrice(safeCurrentCandle.close);
                    }
                  } else {
                    currentCandleRef.current = null;
                  }
                } catch (error) {
                  console.error('[Chart] Error reconstructing current candle:', error);
                  currentCandleRef.current = null;
                }
              }
            }
          }

          // Force refresh poller to get latest data
          await chartCandlePoller.forceRefresh(symbol, timeframe);
          setLastUpdate(new Date());
        } catch (error) {
          console.error('[Chart] Error during smart catchup:', error);
          // Fallback to regular refresh
          await chartCandlePoller.forceRefresh(symbol, timeframe);
        }

      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [symbol, timeframe]);

  useEffect(() => {
    const handleGapBackfillComplete = async (event: Event) => {
      const customEvent = event as CustomEvent;
      const { symbol: filledSymbol, timeframe: filledTimeframe, result } = customEvent.detail;

      if (filledSymbol === symbol && filledTimeframe === timeframe && result.candlesInserted > 0) {
        if (import.meta.env.DEV) {
          console.log(`[Chart] Gap backfill: ${result.candlesInserted} candles added`);
        }

        await handleChartRefresh();
      }
    };

    window.addEventListener('gap-backfill-complete', handleGapBackfillComplete);

    return () => {
      window.removeEventListener('gap-backfill-complete', handleGapBackfillComplete);
    };
  }, [symbol, timeframe]);

  useEffect(() => {
    if (!chartContainerRef.current) {
      console.error('[Chart] chartContainerRef is null, cannot create chart');
      return;
    }

    const containerWidth = chartContainerRef.current.clientWidth;
    const containerHeight = chartContainerRef.current.clientHeight;

    if (containerWidth === 0 || containerHeight === 0) {
      console.warn('[Chart] Container dimensions are 0, chart may not display properly');
    }

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#1f2937' },
        textColor: '#9ca3af',
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: '#374151' },
        horzLines: { color: '#374151' },
      },
      width: containerWidth || 600,
      height: containerHeight || 400,
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
        barSpacing: 8,
        minBarSpacing: 1,
        rightBarStaysOnScroll: true,
      },
      rightPriceScale: {
        visible: true,
        borderVisible: true,
        borderColor: '#4b5563',
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
        autoScale: true,
        alignLabels: true,
        mode: 0,
      },
      crosshair: {
        mode: 1,
        vertLine: {
          width: 1,
          color: '#6b7280',
          style: 2,
          labelBackgroundColor: '#374151',
        },
        horzLine: {
          width: 1,
          color: '#6b7280',
          style: 2,
          labelBackgroundColor: '#374151',
        },
      },
      watermark: {
        visible: false,
      },
    });

    // GOVERNANCE (CCIP): Mobile standard = 2 decimal places on the Y-axis ruler.
    // Desktop retains symbol-specific precision for full technical accuracy.
    const isMobileViewport = window.innerWidth < 640;
    const isCryptoSymbol = ['BTCUSD', 'ETHUSD'].includes(symbol);
    const isGoldSymbol = symbol === 'XAUUSD';
    const isIndexSymbol = ['US30', 'NAS100', 'SPX500'].includes(symbol);
    const chartPrecision = isMobileViewport
      ? 2
      : (isCryptoSymbol || isGoldSymbol || isIndexSymbol ? 2 : 5);
    const chartMinMove = isMobileViewport
      ? 0.01
      : (isCryptoSymbol || isGoldSymbol || isIndexSymbol ? 0.01 : 0.00001);

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
      priceFormat: {
        type: 'price',
        precision: chartPrecision,
        minMove: chartMinMove,
      },
      lastValueVisible: true,
      priceLineVisible: false,
    });

    const vwapSeries = chart.addSeries(LineSeries, {
      color: '#3b82f6',
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const ema20Series = chart.addSeries(LineSeries, {
      color: '#10b981',
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const ema50Series = chart.addSeries(LineSeries, {
      color: '#f59e0b',
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const ema200Series = chart.addSeries(LineSeries, {
      color: '#ef4444',
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;
    vwapSeriesRef.current = vwapSeries;
    ema20SeriesRef.current = ema20Series;
    ema50SeriesRef.current = ema50Series;
    ema200SeriesRef.current = ema200Series;

    const handleUserInteraction = () => {
      userInteractedRef.current = true;
    };

    const timeScale = chart.timeScale();
    timeScale.subscribeVisibleLogicalRangeChange(handleUserInteraction);

    const handleResize = () => {
      if (!isMountedRef.current || !chartContainerRef.current) {
        return;
      }
      try {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight
        });
      } catch (error) {
        console.warn('[Chart] Resize error (chart may be disposed):', error);
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      // First, mark as unmounted to stop all updates
      isMountedRef.current = false;

      // Remove event listeners
      window.removeEventListener('resize', handleResize);

      try {
        // Unsubscribe from chart events before disposal
        timeScale.unsubscribeVisibleLogicalRangeChange(handleUserInteraction);
      } catch (error) {
        console.warn('[Chart] Error unsubscribing from chart events:', error);
      }

      // Dispose chart BEFORE clearing refs (so other code can still check refs during cleanup)
      try {
        if (chart) {
          chart.remove();
        }
      } catch (error) {
        console.warn('[Chart] Error disposing chart:', error);
      }

      // NOW clear all refs AFTER chart is disposed
      chartRef.current = null;
      candlestickSeriesRef.current = null;
      vwapSeriesRef.current = null;
      ema20SeriesRef.current = null;
      ema50SeriesRef.current = null;
      ema200SeriesRef.current = null;
    };
  }, []);

  const updateIndicatorsDebounced = (candles: CandleData[]) => {
    if (isUpdatingRef.current) return;

    isUpdatingRef.current = true;
    requestAnimationFrame(() => {
      updateIndicators(candles);
      isUpdatingRef.current = false;
    });
  };

  const getVWAPLookbackPeriod = (tf: Timeframe): number => {
    // Adjust VWAP lookback based on timeframe to maintain similar time coverage
    // Shorter timeframes = more candles, longer timeframes = fewer candles
    const lookbackMap: Record<Timeframe, number> = {
      'M1': 200,   // 200 minutes = ~3.3 hours
      'M5': 150,   // 750 minutes = ~12.5 hours
      'M15': 100,  // 1500 minutes = 25 hours (~1 day)
      'M30': 75,   // 2250 minutes = 37.5 hours (~1.5 days)
      'H1': 50,    // 50 hours = ~2 days
      'H4': 30,    // 120 hours = 5 days
      'D1': 20     // 20 days
    };
    return lookbackMap[tf] || 100;
  };

  const updateIndicators = (candles: CandleData[]) => {
    if (candles.length === 0) return;

    // HYBRID VWAP APPROACH: Use different calculation methods based on timeframe
    // M1-H1: Rolling VWAP (responsive to current price action)
    // H4-D1: Session-based VWAP (resets daily, more meaningful for intraday)
    let vwap: IndicatorResult[];

    if (timeframe === 'H4' || timeframe === 'D1') {
      // Daily session VWAP for H4 and D1 timeframes
      vwap = calculateSessionVWAP(candles);
    } else {
      // Rolling VWAP for M1, M5, M15, M30, H1
      const vwapLookback = getVWAPLookbackPeriod(timeframe);
      vwap = calculateVWAP(candles, vwapLookback);
    }

    // Apply EMA smoothing for higher timeframes to eliminate visual jaggedness
    // This is cosmetic only - doesn't affect AI analysis
    let vwapForDisplay = vwap;
    if (timeframe === 'H4' || timeframe === 'D1' || timeframe === 'W1') {
      vwapForDisplay = smoothVWAPForDisplay(vwap, 5);
    }

    const ema20 = calculateEMA(candles, 20);
    const ema50 = calculateEMA(candles, 50);
    const ema200 = calculateEMA(candles, 200);
    const rsi = calculateRSI(candles, 14);
    const atr = calculateATR(candles, 14);
    const volume = calculateVolumeMetrics(candles);
    const patterns = detectCandlePatterns(candles, vwap);

    if (vwapSeriesRef.current) {
      if (indicatorVisibility.vwap && vwapForDisplay.length > 0) {
        vwapSeriesRef.current.setData(vwapForDisplay);
        // Use raw VWAP value for indicator display (not smoothed)
        setVwapValue(vwap.length > 0 ? vwap[vwap.length - 1].value : null);
      } else {
        vwapSeriesRef.current.setData([]);
        setVwapValue(null);
      }
    }
    if (ema20SeriesRef.current) {
      if (indicatorVisibility.ema20 && ema20.length > 0) {
        ema20SeriesRef.current.setData(ema20);
        setEma20Value(ema20[ema20.length - 1].value);
      } else {
        ema20SeriesRef.current.setData([]);
        setEma20Value(null);
      }
    }
    if (ema50SeriesRef.current) {
      if (indicatorVisibility.ema50 && ema50.length > 0) {
        ema50SeriesRef.current.setData(ema50);
        setEma50Value(ema50[ema50.length - 1].value);
      } else {
        ema50SeriesRef.current.setData([]);
        setEma50Value(null);
      }
    }
    if (ema200SeriesRef.current) {
      if (indicatorVisibility.ema200 && ema200.length > 0) {
        ema200SeriesRef.current.setData(ema200);
        setEma200Value(ema200[ema200.length - 1].value);
      } else {
        ema200SeriesRef.current.setData([]);
        setEma200Value(null);
      }
    }

    setRsiData(rsi);
    setAtrData(atr);
    setVolumeData(volume);
    setPatternData(patterns);
  };

  // Gap detection removed - now using automatic recent candle backfill instead

  const updateCurrentCandleFromTick = (tick: { symbol: string; bid: number; ask: number; timestamp: string; midPrice: number; brokerTime?: string }) => {
    // CRITICAL: Check if chart is still mounted
    if (!isMountedRef.current || !candlestickSeriesRef.current || !chartRef.current) {
      return;
    }

    // CRITICAL: Check circuit breaker first
    if (!chartCircuitBreaker.isUpdateAllowed(validatedSymbol)) {
      console.error(`[Chart][${symbol}] 🔴 CIRCUIT BREAKER OPEN - Updates blocked`);
      return;
    }

    // CRITICAL: Double-check symbol validation using both prop and ref
    if (tick.symbol !== symbol || tick.symbol !== currentSymbolRef.current) {
      console.warn(`[Chart][${symbol}] ❌ REJECTED tick for wrong symbol: got ${tick.symbol}, expected ${symbol} (ref: ${currentSymbolRef.current})`);

      // Record contamination event
      const tickSymbolValidation = validateSymbol(tick.symbol);
      if (tickSymbolValidation.isValid) {
        chartCircuitBreaker.recordContamination(
          tickSymbolValidation.symbol!,
          validatedSymbol,
          'tick-update',
          tick
        );
      }
      return;
    }

    // CRITICAL: Validate price is within expected range for this symbol
    const priceValidation = priceValidationService.validatePrice(tick.symbol, tick.midPrice);
    if (!priceValidation.isValid) {
      console.error(`[Chart][${symbol}] ❌ REJECTED tick with invalid price: ${tick.midPrice} - ${priceValidation.reason}`);

      // Check if this might be a different symbol's price
      const suspectedSymbol = priceValidationService.detectPossibleSymbolMismatch(tick.symbol, tick.midPrice);
      if (suspectedSymbol) {
        console.error(`[Chart][${symbol}] 🚨 CROSS-CONTAMINATION DETECTED: Received ${suspectedSymbol} price ${tick.midPrice} instead of ${symbol} price!`);
      }
      return;
    }

    if (!candlestickSeriesRef.current) {
      return;
    }

    // CRITICAL FIX: Check if market is open before processing tick
    // BUT ALWAYS allow 24/7 symbols (crypto) to process ticks regardless of isOpen state
    if (!symbolMarketStatus.isOpen && !symbolMarketStatus.is24Hour) {
      return;
    }

    // DEBUG: Log successful tick processing

    const now = Date.now();
    if (now - lastTickUpdateRef.current < 16) {
      return;
    }
    lastTickUpdateRef.current = now;

    if (renderFrameRef.current) {
      cancelAnimationFrame(renderFrameRef.current);
    }

    renderFrameRef.current = requestAnimationFrame(() => {

      const price = tick.midPrice;
      // CCIP-2026-04-02 (TICK-CANDLE-CLOCK-SKEW):
      // Use brokerTime (server-authoritative) when available to derive the candle slot.
      // tick.timestamp from the MetaAPI path is set to new Date().toISOString() (client time),
      // which can diverge from broker/server UTC and place the tick in the wrong candle period.
      // brokerTime comes directly from the broker feed and is the SSOT for candle alignment.
      const tickTimeMs = new Date(tick.brokerTime || tick.timestamp).getTime();
      const timeframeMinutes = getTimeframeMinutes(timeframe);
      const candleTime = Math.floor(tickTimeMs / (timeframeMinutes * 60 * 1000)) * (timeframeMinutes * 60 * 1000);
      const candleTimeSeconds = Math.floor(candleTime / 1000);

      // CRITICAL FIX: Reject ticks that would create candles older than our historical data
      const lastHistoricalTime = historicalCandlesRef.current.length > 0
        ? historicalCandlesRef.current[historicalCandlesRef.current.length - 1].time
        : 0;


      // FIX: Changed from <= to < so ticks for the CURRENT forming candle aren't rejected
      // The forming candle matches lastHistoricalTime, so we need to allow it
      if (candleTimeSeconds < lastHistoricalTime) {
        console.warn(`[Chart][${symbol}] ⏭️ REJECTING old tick: ${candleTimeSeconds} < ${lastHistoricalTime} (${new Date(candleTimeSeconds * 1000).toLocaleTimeString()} < ${new Date(lastHistoricalTime * 1000).toLocaleTimeString()})`);
        return;
      }

      // Also reject if this tick would create a candle older than our current forming candle
      if (currentCandleRef.current && candleTimeSeconds < currentCandleRef.current.time) {
        console.warn(`[Chart][${symbol}] ⏭️ REJECTING tick older than current candle: ${candleTimeSeconds} < ${currentCandleRef.current.time}`);
        return;
      }

      // FIX: Allow ticks for the current candle by checking >= instead of >
      const expectedMinTime = lastHistoricalTime + (getTimeframeMinutes(timeframe) * 60);
      if (candleTimeSeconds < expectedMinTime && lastHistoricalTime > 0 && candleTimeSeconds !== lastHistoricalTime) {
        console.warn(`[Chart][${symbol}] ⏭️ REJECTING tick: candle time ${candleTimeSeconds} < expected min time ${expectedMinTime}`);
        return;
      }


      if (!currentCandleRef.current || currentCandleRef.current.startTime !== candleTime) {
        currentCandleRef.current = {
          time: candleTimeSeconds,
          open: price,
          high: price,
          low: price,
          close: price,
          startTime: candleTime
        };
      } else {
        const oldClose = currentCandleRef.current.close;
        currentCandleRef.current.high = Math.max(currentCandleRef.current.high, price);
        currentCandleRef.current.low = Math.min(currentCandleRef.current.low, price);
        currentCandleRef.current.close = price;
      }

      try {
        // CRITICAL: Ensure all values are primitive numbers
        const timeValue = Number(currentCandleRef.current.time);
        if (typeof timeValue !== 'number' || isNaN(timeValue)) {
          console.error('[Chart] ❌ Invalid time value detected:', {
            time: currentCandleRef.current.time,
            type: typeof currentCandleRef.current.time
          });
          return;
        }

        let mergedHigh = Number(currentCandleRef.current.high);
        let mergedLow = Number(currentCandleRef.current.low);

        const chartData = candlestickSeriesRef.current?.data();
        if (chartData && chartData.length > 0) {
          const existingCandle = chartData.find(c => c.time === timeValue);
          if (existingCandle) {
            mergedHigh = Math.max(mergedHigh, Number(existingCandle.high));
            mergedLow = Math.min(mergedLow, Number(existingCandle.low));
            currentCandleRef.current.high = mergedHigh;
            currentCandleRef.current.low = mergedLow;
          }
        }

        const safeCandle: CandleData = {
          time: timeValue,
          open: Number(currentCandleRef.current.open),
          high: mergedHigh,
          low: mergedLow,
          close: Number(currentCandleRef.current.close)
        };

        console.log(`[Chart][${symbol}] 📊 About to update chart with tick:`, {
          time: new Date(safeCandle.time * 1000).toLocaleTimeString(),
          ohlc: `${safeCandle.open.toFixed(2)}/${safeCandle.high.toFixed(2)}/${safeCandle.low.toFixed(2)}/${safeCandle.close.toFixed(2)}`
        });

        candlestickSeriesRef.current?.update(safeCandle);

        console.log(`[Chart][${symbol}] ✅ Chart updated successfully with live tick!`);

        setCurrentPrice(price);
        setBidPrice(tick.bid);
        setAskPrice(tick.ask);
        setSpread(tick.ask - tick.bid);
        setLastUpdate(new Date());
        setIsLive(true);
        setUpdateCount(prev => prev + 1);
        setMarketStatus('live');
        setSystemStatus('connected');
        liveTickStreamActive.current = true;

        setPriceUpdateFlash(true);
        setTimeout(() => setPriceUpdateFlash(false), 300);

        if (updateCount % 20 === 0) {
          const progress = backgroundCandleAggregator.getCandleProgress(symbol, timeframe);
          setDebugInfo(`Live: ${new Date(tick.timestamp).toLocaleTimeString()} | Progress: ${progress.toFixed(0)}%`);
        }
      } catch (error) {
        // Check if error is due to disposed chart
        if (error instanceof Error && error.message.includes('disposed')) {
          console.warn('[Chart] Chart was disposed during update, ignoring error');
          return;
        }
        console.error('[Chart] Error updating from tick:', error);
      }

      renderFrameRef.current = null;
    });
  };

  const updateCurrentCandleFromPoller = (latestCandle: CandleData) => {
    if (!isChartReadyRef.current) {
      return;
    }

    // CRITICAL TYPE GUARD: Ensure time is a primitive number, not an object
    if (typeof latestCandle.time !== 'number') {
      console.error('[Chart] ❌ CRITICAL: Candle time is not a number!', {
        time: latestCandle.time,
        type: typeof latestCandle.time,
        isObject: typeof latestCandle.time === 'object',
        candle: latestCandle
      });

      // Try to recover by converting it
      try {
        const fixedTime = ensureUnixTimestamp(latestCandle.time, 'updateCurrentCandleFromPoller');
        latestCandle = { ...latestCandle, time: fixedTime };
        console.log('[Chart] ✅ Recovered candle with fixed timestamp:', fixedTime);
      } catch (error) {
        console.error('[Chart] ❌ Failed to recover candle timestamp, skipping update');
        return;
      }
    }

    // CRITICAL: Double-check symbol validation using both prop and ref
    if (latestCandle.symbol && (latestCandle.symbol !== symbol || latestCandle.symbol !== currentSymbolRef.current)) {
      console.warn(`[Chart][${symbol}] ❌ REJECTED polled candle for wrong symbol: got ${latestCandle.symbol}, expected ${symbol} (ref: ${currentSymbolRef.current})`);
      return;
    }

    if (!candlestickSeriesRef.current) {
      return;
    }

    // Allow historical data to display even when market is closed
    // Only block if this is a "current" candle that's more recent than close time
    // This ensures the chart shows historical data during closed hours

    const lastHistoricalTime = historicalCandlesRef.current.length > 0
      ? historicalCandlesRef.current[historicalCandlesRef.current.length - 1].time
      : 0;

    // STRICT OVERLAP PREVENTION: Reject any candle with timestamp <= last historical
    if (latestCandle.time <= lastHistoricalTime) {
      console.warn(`[Chart] OVERLAP PREVENTED: Rejecting polled candle at ${new Date(latestCandle.time * 1000).toISOString()} (last historical: ${new Date(lastHistoricalTime * 1000).toISOString()})`);
      return;
    }

    // Validate this is at least one full interval after last historical
    const expectedMinTime = lastHistoricalTime + (getTimeframeMinutes(timeframe) * 60);
    if (latestCandle.time < expectedMinTime && lastHistoricalTime > 0) {
      console.warn(`[Chart] GAP VIOLATION: Rejecting candle at ${latestCandle.time}, expected >= ${expectedMinTime}`);
      return;
    }

    if (historicalCandlesRef.current.length > 0) {
      const validation = validateCandleAgainstHistorical(latestCandle, historicalCandlesRef.current, symbol);
      if (!validation.isValid) {
        console.error(`[Chart] ❌ Rejecting polled candle for ${symbol}: ${validation.reason}`);
        setDataQualityWarning(`Data validation failed: ${validation.reason}. Waiting for valid data.`);
        return;
      }
    }

    const isNewCompletedCandle = currentCandleRef.current && latestCandle.time > currentCandleRef.current.time;

    if (isNewCompletedCandle) {
      console.log(`[Chart] 🔄 DB confirmed completed candle at ${new Date(latestCandle.time * 1000).toLocaleTimeString()}`);
      historicalCandlesRef.current.push(latestCandle);

      if (historicalCandlesRef.current.length > 500) {
        historicalCandlesRef.current = historicalCandlesRef.current.slice(-300);
      }

      // Update the cached historical candles to keep them in sync
      chartCandlePoller.setFullHistoricalCandles(symbol, timeframe, historicalCandlesRef.current);

      currentCandleRef.current = null;
    } else if (!isNewCompletedCandle) {
      // If no current candle exists yet, initialize from database
      // But if we already have a live candle, don't overwrite it - let the merge logic below handle it
      if (!currentCandleRef.current) {
        const candleTimeMs = latestCandle.time * 1000;
        const timeframeMinutes = getTimeframeMinutes(timeframe);
        const candleStartMs = Math.floor(candleTimeMs / (timeframeMinutes * 60 * 1000)) * (timeframeMinutes * 60 * 1000);

        currentCandleRef.current = {
          time: latestCandle.time,
          open: latestCandle.open,
          high: latestCandle.high,
          low: latestCandle.low,
          close: latestCandle.close,
          startTime: candleStartMs
        };

        console.log(`[Chart] 📊 Initialized currentCandleRef from database (OHLC: ${latestCandle.open.toFixed(2)}/${latestCandle.high.toFixed(2)}/${latestCandle.low.toFixed(2)}/${latestCandle.close.toFixed(2)})`);
      } else {
        console.log(`[Chart] 📊 Skipping currentCandleRef overwrite - preserving live tick data for merge`);
      }
    }

    try {
      // CRITICAL: Deep validation of candle time format
      if (typeof latestCandle.time !== 'number' || isNaN(latestCandle.time)) {
        console.error('[Chart] ❌ Invalid candle time from poller:', {
          candle: latestCandle,
          timeType: typeof latestCandle.time,
          timeValue: latestCandle.time
        });
        return;
      }

      // CRITICAL: Use sanitizeCandleData to handle all edge cases (Date objects, strings, etc)
      const safeCandle = sanitizeCandleData(latestCandle);

      // Validate all fields are valid numbers after sanitization
      if (isNaN(safeCandle.time) || isNaN(safeCandle.open) || isNaN(safeCandle.high) ||
          isNaN(safeCandle.low) || isNaN(safeCandle.close)) {
        console.error('[Chart] ❌ Invalid candle data after sanitization:', {
          original: latestCandle,
          sanitized: safeCandle
        });
        return;
      }

      // CRITICAL FIX: Get the last candle time from the chart AND sanitize it
      // Double-check refs still exist (component might have unmounted during async operations)
      if (!isMountedRef.current || !candlestickSeriesRef.current) {
        return;
      }

      const chartData = candlestickSeriesRef.current.data();

      if (chartData.length > 0) {
        const lastChartCandle = chartData[chartData.length - 1];

        // Log what we're getting from the chart
        console.log('[Chart] Last chart candle inspection:', {
          time: lastChartCandle.time,
          timeType: typeof lastChartCandle.time,
          isObject: typeof lastChartCandle.time === 'object',
          constructor: lastChartCandle.time?.constructor?.name
        });

        // If the chart has object timestamps, we need to sanitize the entire chart
        if (typeof lastChartCandle.time === 'object') {
          console.error('[Chart] ❌ CRITICAL: Chart contains object timestamps! Re-sanitizing entire chart...');

          // Sanitize all existing chart data
          const sanitizedChartData = sanitizeCandleArray(chartData);
          candlestickSeriesRef.current.setData(sanitizedChartData);

          console.log('[Chart] ✅ Chart data re-sanitized successfully');
          return; // Exit and let the next update work with clean data
        }
      }

      const lastChartCandleTime = chartData.length > 0 ? chartData[chartData.length - 1].time : 0;

      // Validate lastChartCandleTime is a number
      if (typeof lastChartCandleTime !== 'number' || isNaN(lastChartCandleTime)) {
        console.error('[Chart] ❌ Invalid lastChartCandleTime after check:', {
          value: lastChartCandleTime,
          type: typeof lastChartCandleTime
        });
        return;
      }

      // Check if this is an update to an existing candle or a new candle
      if (safeCandle.time < lastChartCandleTime) {
        // This candle is older than the latest chart candle
        // Check if it exists in the chart (could be an update to an older candle)
        const existingCandleIndex = chartData.findIndex(c => c.time === safeCandle.time);

        if (existingCandleIndex !== -1) {
          // This is an update to an existing historical candle - allow it
          console.log(`[Chart] 🔄 Updating existing candle at ${new Date(safeCandle.time * 1000).toLocaleTimeString()}`);
          candlestickSeriesRef.current.update(safeCandle);
          return;
        }

        // Truly old candle that doesn't exist - skip it
        console.warn(`[Chart] ⏭️ Skipping old candle at ${new Date(safeCandle.time * 1000).toLocaleTimeString()} (last chart candle: ${new Date(Number(lastChartCandleTime) * 1000).toLocaleTimeString()})`);
        return;
      }

      // This is either a new candle or an update to the latest candle - proceed
      if (safeCandle.time === lastChartCandleTime) {
        console.log(`[Chart] 🔄 Updating current candle at ${new Date(safeCandle.time * 1000).toLocaleTimeString()}`);
      } else {
        console.log(`[Chart] ✨ New candle at ${new Date(safeCandle.time * 1000).toLocaleTimeString()}`);
      }

      // Wrap chart update in try-catch to capture any Lightweight Charts errors
      try {
        console.log('[Chart] About to update with safeCandle:', {
          time: safeCandle.time,
          timeType: typeof safeCandle.time,
          candle: safeCandle
        });

        // CRITICAL FIX: Merge database candle with live tick data
        // This prevents database updates from overwriting real-time DirectPoller ticks
        // CCIP-2026-03-13d: After merge, guard the result with the same 5% range contract
        // as candle-data-service.ts:438, chart-candle-poller.ts, and
        // current-candle-reconstructor.ts. Prevents a corrupted currentCandleRef from
        // amplifying into the merged output via Math.max/min.
        let finalCandle = safeCandle;
        if (currentCandleRef.current && currentCandleRef.current.time === safeCandle.time) {
          const mergedHigh = Math.max(safeCandle.high, currentCandleRef.current.high);
          const mergedLow = Math.min(safeCandle.low, currentCandleRef.current.low);
          const mergedClose = currentCandleRef.current.close;

          const mergedRange = mergedHigh - mergedLow;
          const mergedAvg = (safeCandle.open + mergedClose) / 2;
          const mergedRangePct = mergedAvg > 0 ? (mergedRange / mergedAvg) * 100 : 0;

          if (mergedRangePct > 5) {
            console.warn(
              `[Chart] CCIP-2026-03-13d: Merged candle range ${mergedRangePct.toFixed(2)}% > 5% — ` +
              `discarding live tick high/low, keeping database candle to prevent corrupted wick`
            );
            finalCandle = safeCandle;
          } else {
            finalCandle = {
              ...safeCandle,
              high: mergedHigh,
              low: mergedLow,
              close: mergedClose
            };

            currentCandleRef.current.high = finalCandle.high;
            currentCandleRef.current.low = finalCandle.low;
            currentCandleRef.current.close = finalCandle.close;
          }

          console.log(`[Chart] Merged DB candle with live tick: close ${safeCandle.close.toFixed(5)} → ${finalCandle.close.toFixed(5)}`);
        }

        candlestickSeriesRef.current.update(finalCandle);
      } catch (updateError) {
        console.error('[Chart] Update error:', updateError);
        console.error('[Chart] Failed candle:', safeCandle);
        console.error('[Chart] Last chart data:', chartData.slice(-3));
        console.error('[Chart] Candle data causing error:', {
          safeCandle,
          timeType: typeof safeCandle.time,
          lastChartTime: lastChartCandleTime,
          lastChartTimeType: typeof lastChartCandleTime
        });
        return;
      }

      if (isMountedRef.current && chartRef.current && !userInteractedRef.current) {
        try {
          chartRef.current.timeScale().scrollToRealTime();
        } catch (error) {
          console.warn('[Chart] scrollToRealTime error (chart may be disposed)');
        }
      }

      const allCandles = [...historicalCandlesRef.current, latestCandle];
      if (updateQueueRef.current.length >= 5 || isNewCompletedCandle) {
        updateIndicatorsDebounced(allCandles);
        updateQueueRef.current = [];
      } else {
        updateQueueRef.current.push(latestCandle.close);
      }

      if (!liveTickStreamActive.current) {
        setCurrentPrice(latestCandle.close);
        setLastUpdate(new Date());
        setUpdateCount(prev => prev + 1);
      }

      setSystemStatus('connected');
      setDataQualityWarning(null);

      setDebugInfo(`DB: ${new Date(latestCandle.time * 1000).toLocaleTimeString()}, Mode: ${liveTickStreamActive.current ? 'Live+DB' : 'DB Only'}`);
    } catch (chartError) {
      console.error('[Chart] Update error:', chartError);
    }
  };


  const initializeChart = async (showLoadingState = true) => {
    isChartReadyRef.current = false;
    isInitializingRef.current = true;
    try {
      console.log(`[Chart Init] ========================================`);
      console.log(`[Chart Init] Starting initialization for ${symbol} ${timeframe}`);
      console.log(`[Chart Init] Environment: ${shouldDisableMetaAPI() ? 'Development/Bolt (Database Only)' : 'Production'}`);
      console.log(`[Chart Init] candlestickSeriesRef exists: ${!!candlestickSeriesRef.current}`);
      console.log(`[Chart Init] historicalCandlesRef length: ${historicalCandlesRef.current.length}`);

      if (showLoadingState) {
        setIsLoading(true);
      }
      setError(null);
      if (showLoadingState) {
        setLoadingProgress(null);
      }

      // Optimize candle count for development environments
      const isDevEnvironment = shouldDisableMetaAPI();
      const targetCandleCount = isDevEnvironment ? 50 : ChartDataGuarantor.calculateSmartCandleCount(timeframe);
      console.log(`[Chart Init] Using ChartDataGuarantor - Target: ${targetCandleCount} candles (${isDevEnvironment ? 'DEV MODE' : 'PRODUCTION'})`);

      // Add timeout protection for development environments
      const timeoutMs = isDevEnvironment ? 10000 : 30000; // 10s for dev, 30s for production
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Chart initialization timeout')), timeoutMs);
      });

      const result = await Promise.race([
        ChartDataGuarantor.guaranteeChartDataWithBackfill(symbol, timeframe, targetCandleCount),
        timeoutPromise
      ]);
      console.log(`[Chart Init] ⚠️ CRITICAL: Guarantor returned ${result.candles.length} candles (target: ${targetCandleCount})`);

      console.log(`[Chart Init] Guarantor result:`, {
        candleCount: result.candles.length,
        isComplete: result.isComplete,
        hasGaps: result.hasGaps,
        missingCount: result.missingCount,
        loadTime: result.loadTime
      });

      if (result.candles.length === 0) {
        console.error('[Chart Init] ❌ ZERO CANDLES returned from guarantor!');
        console.error('[Chart Init] Checking database directly...');

        // EMERGENCY: Try direct database query with reduced limit for development
        const emergencyLimit = isDevEnvironment ? 50 : 200;
        console.log(`[Chart Init] Emergency direct query with limit: ${emergencyLimit}`);

        // 🎯 Uses forex_candles_best for quality-filtered data
        const { data: directCandles, error: directError } = await supabase
          .from('forex_candles_best')
          .select('*')
          .eq('symbol', symbol)
          .eq('timeframe', timeframe)
          .order('open_time', { ascending: false })
          .limit(emergencyLimit);

        if (directError) {
          console.error('[Chart Init] Direct query error:', directError);
          const errorMessage = isDevEnvironment
            ? `Development Mode: Unable to load data for ${symbol}. Database may be unavailable.`
            : 'Failed to load chart data. Please check your connection.';
          setError(errorMessage);
          setIsLoading(false);
          setLoadingProgress(null);
          return;
        } else {
          console.log('[Chart Init] Direct query returned:', directCandles?.length || 0, 'candles');
          if (directCandles && directCandles.length > 0) {
            console.log('[Chart Init] 🚨 EMERGENCY: Using direct query candles!');
            result.candles = directCandles.reverse().map((c: any) => ({
              time: Math.floor(new Date(c.open_time).getTime() / 1000),
              open: parseFloat(c.open),
              high: parseFloat(c.high),
              low: parseFloat(c.low),
              close: parseFloat(c.close)
            }));
          }
        }

        if (result.candles.length === 0) {
          console.warn('[Chart Init] No candle data found for symbol:', symbol);
          const message = isDevEnvironment
            ? `Development Mode: No data available for ${symbol} ${timeframe}. The database may need to be populated with historical data.`
            : 'Waiting for price data... The price feed will start shortly.';
          setError(message);
          setIsLoading(false);
          setLoadingProgress(null);
          return;
        }
      }

      setDataCompleteness({
        isComplete: result.isComplete,
        candleCount: result.candles.length,
        targetCount: targetCandleCount
      });

      if (!result.isComplete) {
        if (result.hasGaps) {
          setDataQualityWarning(`Found ${result.gapDetails.length} gaps. Auto-filling...`);
          console.log('[Chart Init] Triggering gap fills:', result.gapDetails);
        } else if (result.missingCount > 0) {
          setDataQualityWarning(`${result.missingCount} candles missing. Loading historical data...`);
        }
      } else {
        setDataQualityWarning(null);
      }

      const chartData = {
        historical: result.candles,
        current: null
      };

      console.log('[Chart Init] Chart data received:', {
        historicalCount: chartData.historical.length,
        hasCurrent: !!chartData.current
      });

      if (chartData.historical.length === 0 && !chartData.current) {
        console.warn('[Chart Init] No candle data found after bulk load for symbol:', symbol);
        setError('Waiting for price data... The price feed will start shortly.');
        setIsLoading(false);
        setLoadingProgress(null);
        return;
      }

      // CRITICAL FIX: Deduplicate candles by timestamp and ensure strict ordering
      const sortedHistorical = [...chartData.historical].sort((a, b) => a.time - b.time);
      const uniqueHistorical = [];
      const seenTimestamps = new Set<number>();

      for (const candle of sortedHistorical) {
        // Keep all historical candles for viewing (including weekends)
        // Weekend filtering only applies to LIVE candle formation, not historical display
        if (!seenTimestamps.has(candle.time)) {
          seenTimestamps.add(candle.time);
          uniqueHistorical.push(candle);
        } else {
          console.warn(`[Chart Init] Skipping duplicate candle at ${new Date(candle.time * 1000).toISOString()}`);
        }
      }

      console.log(`[Chart Init] Loaded ${uniqueHistorical.length} candles from database`);
      setDataQualityWarning(null);

      // Validate all candle times before setting
      const validatedCandles = uniqueHistorical.filter((candle, index) => {
        if (typeof candle.time !== 'number' || isNaN(candle.time)) {
          console.error(`[Chart Init] Invalid candle at index ${index}:`, {
            candle,
            timeType: typeof candle.time
          });
          return false;
        }
        return true;
      });

      if (validatedCandles.length !== uniqueHistorical.length) {
        console.warn(`[Chart Init] Filtered out ${uniqueHistorical.length - validatedCandles.length} invalid candles`);
      }

      historicalCandlesRef.current = validatedCandles;

      // CRITICAL FIX: Cache the full historical candles for instant restoration on timeframe switches
      if (validatedCandles.length > 0) {
        chartCandlePoller.setFullHistoricalCandles(symbol, timeframe, validatedCandles);
        console.log(`[Chart Init] 💾 Cached ${validatedCandles.length} candles for instant timeframe switching`);

        const firstCandle = validatedCandles[0];
        const lastCandle = validatedCandles[validatedCandles.length - 1];
        console.log(`[Chart Init] Historical range: ${new Date(firstCandle.time * 1000).toISOString()} to ${new Date(lastCandle.time * 1000).toISOString()}`);
        console.log(`[Chart Init] Total span: ${((lastCandle.time - firstCandle.time) / 3600).toFixed(1)} hours`);

        // CRITICAL FIX: Reconstruct the current in-progress candle from database ticks
        console.log('[Chart Init] 🔄 Attempting to reconstruct current candle from database ticks...');
        try {
          const reconstruction = await currentCandleReconstructor.reconstructCurrentCandle(
            symbol,
            timeframe,
            lastCandle.time
          );

          if (reconstruction.wasReconstructed && reconstruction.candle) {
            console.log(`[Chart Init] ✅ Current candle reconstructed from ${reconstruction.tickCount} ticks`);
            console.log(`[Chart Init]   OHLC: ${reconstruction.candle.open.toFixed(5)} / ${reconstruction.candle.high.toFixed(5)} / ${reconstruction.candle.low.toFixed(5)} / ${reconstruction.candle.close.toFixed(5)}`);
            console.log(`[Chart Init]   Time: ${new Date(reconstruction.candle.time * 1000).toISOString()}`);

            // Set the reconstructed candle as the current candle
            const safeCurrentCandle: CandleData = {
              time: Number(reconstruction.candle.time),
              open: Number(reconstruction.candle.open),
              high: Number(reconstruction.candle.high),
              low: Number(reconstruction.candle.low),
              close: Number(reconstruction.candle.close)
            };

            currentCandleRef.current = {
              ...safeCurrentCandle,
              startTime: safeCurrentCandle.time * 1000
            };

            console.log('[Chart Init] 💾 Current candle restored - will persist across refreshes');

            // Display the reconstructed candle on the chart immediately
            if (candlestickSeriesRef.current) {
              try {
                candlestickSeriesRef.current.update(safeCurrentCandle);
                console.log('[Chart Init] ✅ Reconstructed candle displayed on chart');
              } catch (error) {
                console.error('[Chart Init] Error displaying reconstructed candle:', error);
              }
            }
          } else {
            console.log(`[Chart Init] ℹ️ No current candle to reconstruct (${reconstruction.tickCount} ticks found)`);
          }
        } catch (error) {
          console.error('[Chart Init] Error reconstructing current candle:', error);
        }
      }

      if (candlestickSeriesRef.current && validatedCandles.length > 0) {
        // CRITICAL: Sanitize ALL candles to ensure primitive numbers before giving to chart
        const sanitizedCandles = sanitizeCandleArray(validatedCandles);

        console.log('[Chart Init] ✅ Setting chart data with', sanitizedCandles.length, 'candles');
        console.log('[Chart Init] First candle:', sanitizedCandles[0]);
        console.log('[Chart Init] Last candle:', sanitizedCandles[sanitizedCandles.length - 1]);
        console.log('[Chart Init] First candle type check:', {
          time: typeof sanitizedCandles[0].time,
          open: typeof sanitizedCandles[0].open,
          timeValue: sanitizedCandles[0].time
        });

        // Set data directly without gap processing
        candlestickSeriesRef.current.setData(sanitizedCandles);

        // VERIFICATION: Check if data was actually set
        if (!isMountedRef.current || !candlestickSeriesRef.current) {
          return;
        }
        const chartDataAfterSet = candlestickSeriesRef.current.data();
        console.log('[Chart Init] ✅ Chart data set successfully - Verification:', {
          sentToChart: sanitizedCandles.length,
          actuallyInChart: chartDataAfterSet.length,
          match: chartDataAfterSet.length > 0
        });

        if (chartDataAfterSet.length === 0) {
          console.error('[Chart Init] ❌ CRITICAL: Chart has ZERO candles after setData()!');
          console.error('[Chart Init] This indicates a lightweight-charts library issue or data format problem');
          // EMERGENCY FALLBACK: Try setting data directly without any processing
          console.error('[Chart Init] Attempting emergency fallback - setting data without processing...');
          candlestickSeriesRef.current.setData(sanitizedCandles);
        } else if (chartDataAfterSet.length < sanitizedCandles.length) {
          console.warn('[Chart Init] ⚠️ WARNING: Chart has fewer candles than sent:', {
            sent: sanitizedCandles.length,
            inChart: chartDataAfterSet.length,
            missing: sanitizedCandles.length - chartDataAfterSet.length
          });
        }
      } else {
        console.error('[Chart Init] ❌ Cannot set chart data:', {
          hasSeriesRef: !!candlestickSeriesRef.current,
          candleCount: validatedCandles.length
        });
      }

      if (chartData.current) {
        const lastHistoricalTime = validatedCandles.length > 0
          ? validatedCandles[validatedCandles.length - 1].time
          : 0;

        console.log(`[Chart Init] Current candle time: ${new Date(chartData.current.time * 1000).toISOString()}`);
        console.log(`[Chart Init] Last historical time: ${new Date(lastHistoricalTime * 1000).toISOString()}`);

        // CRITICAL FIX: Strictly validate current candle is after historical data
        if (chartData.current.time > lastHistoricalTime) {
          const timeDiff = chartData.current.time - lastHistoricalTime;
          const expectedInterval = getTimeframeMinutes(timeframe) * 60;

          if (timeDiff === expectedInterval) {
            console.log(`[Chart Init] ✓ PERFECT: Current candle follows historical with exact ${timeframe} interval`);
          } else if (timeDiff > expectedInterval) {
            console.warn(`[Chart Init] ⚠ GAP: ${timeDiff / 60} minutes between last historical and current (expected ${expectedInterval / 60})`);
          }

          // CRITICAL: Ensure current candle time is a primitive number
          const safeCurrentCandle: CandleData = {
            time: Number(chartData.current.time),
            open: Number(chartData.current.open),
            high: Number(chartData.current.high),
            low: Number(chartData.current.low),
            close: Number(chartData.current.close)
          };

          currentCandleRef.current = {
            ...safeCurrentCandle,
            startTime: safeCurrentCandle.time * 1000
          };
          candlestickSeriesRef.current?.update(safeCurrentCandle);
        } else if (chartData.current.time === lastHistoricalTime) {
          console.error(`[Chart Init] ❌ OVERLAP PREVENTED: Current candle matches last historical timestamp - rejecting current candle`);
          // Do not set current candle - it overlaps with historical data
          currentCandleRef.current = null;
        } else {
          console.error(`[Chart Init] ❌ OVERLAP PREVENTED: Current candle (${chartData.current.time}) is older than last historical (${lastHistoricalTime}) - rejecting current candle`);
          // Do not set current candle - it would create backwards time travel
          currentCandleRef.current = null;
        }
      }

      let validatedCurrentCandle: CandleData | null = currentCandleRef.current;

      if (currentCandleRef.current && uniqueHistorical.length > 0) {
        const validation = validateCandleAgainstHistorical(currentCandleRef.current, uniqueHistorical, symbol);
        if (!validation.isValid) {
          console.error(`[Chart Init] ❌ Current candle failed validation: ${validation.reason}`);
          console.error(`[Chart Init] Excluding current candle from initial chart display`);
          validatedCurrentCandle = null;
          setDataQualityWarning(`Initial current candle excluded due to price anomaly. Waiting for valid data.`);
        }
      }

      const allCandles = validatedCurrentCandle
        ? [...uniqueHistorical, validatedCurrentCandle]
        : uniqueHistorical;

      if (allCandles.length > 0) {
        const lastCandle = allCandles[allCandles.length - 1];
        const firstCandle = allCandles[0];

        setCurrentPrice(lastCandle.close);
        setPriceChange(((lastCandle.close - firstCandle.open) / firstCandle.open) * 100);
        setLastUpdate(new Date());

        console.log(`[Chart Init] ${symbol} - Loaded ${uniqueHistorical.length} historical candles, Current: ${validatedCurrentCandle ? 'Yes (validated)' : currentCandleRef.current ? 'No (failed validation)' : 'No'}`);
        console.log(`[Chart Init] Latest candle time: ${new Date(lastCandle.time * 1000).toLocaleString()}`);
        console.log(`[Chart Init] Price range for indicators: ${Math.min(...allCandles.map(c => c.low)).toFixed(5)} - ${Math.max(...allCandles.map(c => c.high)).toFixed(5)}`);

        requestAnimationFrame(() => {
          updateIndicators(allCandles);
          if (isMountedRef.current && chartRef.current && !userInteractedRef.current) {
            try {
              chartRef.current.timeScale().scrollToRealTime();
            } catch (error) {
              console.warn('[Chart] scrollToRealTime error (chart may be disposed)');
            }
          }
        });
      }

      console.log('[Chart Init] Initialization complete, setting isLoading to false');
      isChartReadyRef.current = true;
      isInitializingRef.current = false;
      setIsLoading(false);
      setLoadingProgress(null);

      console.log(`[Chart Init] Priority 2: Starting background loading for remaining pairs...`);
      concurrentBulkLoader.loadAllPairsInBackground(
        symbol,
        timeframe,
        (progress) => {
          setBackgroundLoading({
            completed: progress.completed,
            total: progress.total,
            currentBatch: progress.currentBatch
          });

          if (progress.completed === progress.total) {
            setTimeout(() => setBackgroundLoading(null), 3000);
          }
        }
      );
    } catch (err) {
      isInitializingRef.current = false;
      console.error('[Chart Init] Failed to initialize chart:', err);
      if (err instanceof Error) {
        console.error('[Chart Init] Error stack:', err.stack);

        // Handle timeout specifically
        if (err.message.includes('timeout')) {
          const message = shouldDisableMetaAPI()
            ? `Development Mode: Chart initialization timed out. The database connection may be slow or unavailable.`
            : 'Chart loading timed out. Please refresh to try again.';
          setError(message);
        } else {
          setError(err.message || 'Failed to load chart data');
        }
      } else {
        setError('Failed to load chart data');
      }
      setIsLoading(false);
      setLoadingProgress(null);
    }
  };

  useEffect(() => {
    const loadVisibilityPreferences = async () => {
      try {
        const visibility = await chartPreferencesService.getIndicatorVisibility();
        setIndicatorVisibility(visibility);
      } catch (error) {
        console.error('Failed to load indicator visibility preferences:', error);
      }
    };

    loadVisibilityPreferences();

    const handlePreferenceChange = (event: CustomEvent) => {
      const newVisibility = event.detail as IndicatorVisibility;
      setIndicatorVisibility(newVisibility);
    };

    window.addEventListener('indicator-preferences-changed', handlePreferenceChange as EventListener);

    return () => {
      window.removeEventListener('indicator-preferences-changed', handlePreferenceChange as EventListener);
    };
  }, []);

  useEffect(() => {
    console.log(`[Chart][${symbol}] Main useEffect triggered for: ${symbol} ${timeframe}`);

    // Update the current symbol ref
    currentSymbolRef.current = symbol;

    if (!candlestickSeriesRef.current) {
      console.log(`[Chart][${symbol}] candlestickSeriesRef is null, waiting for chart creation`);
      return;
    }

    console.log(`[Chart][${symbol}] Chart series exists, CLEARING old data before loading new symbol...`);

    // Mark chart as not ready while switching symbols
    isChartReadyRef.current = false;
    isInitializingRef.current = false;

    // CRITICAL FIX: Force clear ALL chart data when symbol changes to prevent contamination
    try {
      candlestickSeriesRef.current.setData([]);
      vwapSeriesRef.current?.setData([]);
      ema20SeriesRef.current?.setData([]);
      ema50SeriesRef.current?.setData([]);
      ema200SeriesRef.current?.setData([]);
      console.log(`[Chart][${symbol}] ✅ Cleared all chart series data`);
    } catch (clearError) {
      console.error(`[Chart][${symbol}] Error clearing chart data:`, clearError);
    }

    // Reset all refs to prevent stale data
    historicalCandlesRef.current = [];
    currentCandleRef.current = null;
    lastFetchTimeRef.current = null;
    liveTickStreamActive.current = false;

    console.log(`[Chart][${symbol}] Chart series cleared, FORCE LOADING from database...`);

    // CRITICAL FIX: ALWAYS load fresh from database - skip cache entirely
    // This ensures candles ALWAYS appear
    console.log('[Chart] 🔴 BYPASSING CACHE - Force loading from database...');

    concurrentBulkLoader.interruptForSymbol(symbol, timeframe);

    // ALWAYS force fresh database load with loading state
    initializeChart(true);

    // SAFEGUARD: Verify chart has data after a delay
    if (safeguardTimeoutRef.current) {
      clearTimeout(safeguardTimeoutRef.current);
    }
    safeguardTimeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current || !candlestickSeriesRef.current) {
        return;
      }
      if (isInitializingRef.current) {
        console.log('[Chart] 🔍 SAFEGUARD: Initialization still in progress, skipping redundant reload');
        return;
      }
      const chartData = candlestickSeriesRef.current.data();
      console.log(`[Chart] 🔍 SAFEGUARD CHECK: Chart has ${chartData.length} candles`);
      if (chartData.length === 0) {
        console.error('[Chart] ❌ SAFEGUARD TRIGGERED: Chart is empty after initialization!');
        console.error('[Chart] Attempting forced reload...');
        initializeChart(true);
      }
    }, 3000);

    // Check if we should run in database-only mode (development/WebContainer or circuit breaker open)
    const isDevEnvironment = shouldDisableMetaAPI();
    const isCircuitOpen = circuitBreakerService.isOpen();
    const databaseOnlyMode = isDevEnvironment || isCircuitOpen;

    if (databaseOnlyMode) {
      if (isDevEnvironment) {
        console.log(`[Chart] 🔵 Running in DATABASE-ONLY mode (${isWebContainer() ? 'WebContainer' : 'Development'} environment)`);
      } else if (isCircuitOpen) {
        console.log(`[Chart] ⚡ Running in DATABASE-ONLY mode (Circuit breaker is OPEN)`);
      }
      setIsDatabaseOnlyMode(true);
      setSystemStatus('connected');
      setPriceSource('database');
    } else {
      console.log(`[Chart] 🚀 Starting SMOOTH HYBRID mode: Direct MetaAPI + Fallback DB polling for ${symbol} ${timeframe}`);
      setSystemStatus('connecting');
      setIsDatabaseOnlyMode(false);
    }

    // PRIORITY 1: Start direct MetaAPI polling for smooth updates (every 3s)
    // Skip if in database-only mode to prevent circuit breaker spam
    if (!databaseOnlyMode) {
      console.log(`[Chart][${symbol}] 🎯 Starting direct MetaAPI price poller (3s interval)...`);
      chartDirectPricePoller.addSymbol(symbol);
    } else {
      console.log(`[Chart][${symbol}] 💾 Database-only mode - MetaAPI polling disabled`);
    }

    // CRITICAL FIX: Pass symbol to register listener for THIS symbol only
    // Skip if in database-only mode
    const unsubscribeDirectPrice = !databaseOnlyMode ? chartDirectPricePoller.onPriceUpdate(symbol, (price) => {
      // Symbol check now redundant (poller filters) but kept as safety guard
      if (price.symbol === symbol) {
        console.log(`[Chart][${symbol}] 📈 Direct price update from ${price.source}: ${price.midPrice.toFixed(5)}`);

        // Track crypto data source for UI display
        const isCrypto = ['BTCUSD', 'ETHUSD'].includes(symbol);
        if (isCrypto && price.source) {
          setCryptoDataSource(price.source);
        }

        // CRITICAL FIX: Save tick to database so it persists and can be queried by forming candle
        // This ensures database polling sees the same live ticks as the chart
        import('@/services/background-candle-aggregator').then(({ backgroundCandleAggregator }) => {
          backgroundCandleAggregator.processExternalTick(
            price.symbol,
            price.bid,
            price.ask,
            price.timestamp
          ).catch(err => console.error('[Chart] Failed to persist tick:', err));
        });

        updateCurrentCandleFromTick({
          symbol: price.symbol,
          bid: price.bid,
          ask: price.ask,
          timestamp: price.timestamp,
          brokerTime: price.brokerTime,
          midPrice: price.midPrice
        });

        // Update bid/ask prices for display
        setBidPrice(price.bid);
        setAskPrice(price.ask);
        setSpread(price.ask - price.bid);

        setMarketStatus('live');
      }
    }) : () => {};

    // Enable direct price poller status monitoring
    const unsubscribeDirectStatus = !databaseOnlyMode ? chartDirectPricePoller.onStatusUpdate((status) => {
      setPriceSource(status.source);
      setDirectPollerActive(status.isActive);
      console.log(`[Chart] 📊 Direct poller status: ${status.source}, active: ${status.isActive}`);
    }) : () => {};

    // ✅ START THE DIRECT PRICE POLLER FOR REALTIME UPDATES (skip in database-only mode)
    if (!databaseOnlyMode) {
      chartDirectPricePoller.start();
    }

    // DISABLED: Background aggregator causes conflicts - using direct price poller + database polling
    const unsubscribeTicks = () => {}; // Noop cleanup (aggregator not used)

    // Start database polling for validation and completed candles
    console.log(`[Chart] 💾 Starting database polling (3s interval)...`);
    chartCandlePoller.startPolling(symbol, timeframe).then(() => {
      console.log(`[Chart] ✅ Database polling active for ${symbol} ${timeframe}`);
      setSystemStatus('connected');
    }).catch((error) => {
      console.error(`[Chart] ❌ Failed to start polling:`, error);
      setSystemStatus('disconnected');
    });

    const unsubscribePoller = chartCandlePoller.onUpdate(symbol, timeframe, (result) => {
      if (result.hasNewData && result.candles.length > 0) {
        const latestCandle = result.candles[result.candles.length - 1];
        console.log(`[Chart] 🔄 DB validation: new candle at ${new Date(latestCandle.time * 1000).toLocaleTimeString()}`);
        updateCurrentCandleFromPoller(latestCandle);
      }
    });

    globalPollingCoordinator.setSymbolViewed(symbol, true);

    // DISABLED: Using database polling only for consistency
    // const formingCandle = backgroundCandleAggregator.getFormingCandle(symbol, timeframe);
    // if (formingCandle) {
    //   console.log(`[Chart] 📊 Loaded forming candle from aggregator:`, formingCandle);
    //   updateCurrentCandleFromPoller(formingCandle);
    // }

    // Check DB for latest completed candle
    const existingCandle = chartCandlePoller.getLatestCandle(symbol, timeframe);
    if (existingCandle) {
      console.log(`[Chart] 💾 Loaded latest completed candle from DB:`, existingCandle);
      updateCurrentCandleFromPoller(existingCandle);
    }

    // Monitor connection health
    const healthCheck = setInterval(() => {
      const timeSinceLastTick = Date.now() - lastTickUpdateRef.current;
      if (timeSinceLastTick > 30000 && liveTickStreamActive.current) {
        console.warn(`[Chart] ⚠️ No ticks for ${timeSinceLastTick / 1000}s - tick stream may be stale`);
        liveTickStreamActive.current = false;
        setMarketStatus('delayed');
      }
    }, 15000);

    return () => {
      console.log(`[Chart] 🛑 Stopping ${databaseOnlyMode ? 'database-only' : 'hybrid polling'} mode for ${symbol} ${timeframe}`);
      if (!databaseOnlyMode) {
        chartDirectPricePoller.removeSymbol(symbol);
      }
      unsubscribeDirectPrice();
      unsubscribeDirectStatus();
      unsubscribeTicks();
      unsubscribePoller();
      chartCandlePoller.stopPolling(symbol, timeframe);
      globalPollingCoordinator.setSymbolViewed(symbol, false);
      clearInterval(healthCheck);
      if (renderFrameRef.current) {
        cancelAnimationFrame(renderFrameRef.current);
      }
      if (safeguardTimeoutRef.current) {
        clearTimeout(safeguardTimeoutRef.current);
      }
    };
  }, [symbol, timeframe]);

  useEffect(() => {
    if (historicalCandlesRef.current.length > 0) {
      let validatedCurrentCandle: CandleData | null = currentCandleRef.current;

      if (currentCandleRef.current) {
        const validation = validateCandleAgainstHistorical(currentCandleRef.current, historicalCandlesRef.current, symbol);
        if (!validation.isValid) {
          console.warn(`[Chart] Current candle excluded from indicator recalculation: ${validation.reason}`);
          validatedCurrentCandle = null;
        }
      }

      const allCandles = validatedCurrentCandle
        ? [...historicalCandlesRef.current, validatedCurrentCandle]
        : historicalCandlesRef.current;
      updateIndicators(allCandles);
    }
  }, [indicatorVisibility]);

  const renderDaySeparators = () => {
    if (!showDaySeparators || timeframe === 'D1' || !chartRef.current || !daySeparatorOverlayRef.current || !chartContainerRef.current) {
      if (daySeparatorOverlayRef.current) {
        daySeparatorOverlayRef.current.innerHTML = '';
      }
      return;
    }

    const chart = chartRef.current;
    const overlay = daySeparatorOverlayRef.current;
    const container = chartContainerRef.current;
    const candles = historicalCandlesRef.current;

    if (candles.length === 0) {
      overlay.innerHTML = '';
      return;
    }

    const timeScale = chart.timeScale();
    let visibleRange: { from: number; to: number } | null = null;
    try {
      visibleRange = timeScale.getVisibleRange() as { from: number; to: number } | null;
    } catch {
      return;
    }
    if (!visibleRange) {
      overlay.innerHTML = '';
      return;
    }

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    const dayBoundaries: number[] = [];
    let prevDay = -1;
    for (const candle of candles) {
      const day = Math.floor(candle.time / 86400);
      if (prevDay !== -1 && day !== prevDay) {
        const boundaryTs = day * 86400;
        if (boundaryTs >= visibleRange.from && boundaryTs <= visibleRange.to) {
          dayBoundaries.push(boundaryTs);
        }
      }
      prevDay = day;
    }

    const fragments: string[] = [];
    for (const ts of dayBoundaries) {
      let xPos: number;
      try {
        xPos = timeScale.timeToCoordinate(ts as any) as number;
      } catch {
        continue;
      }
      if (xPos === null || xPos < 0 || xPos > containerWidth) continue;

      const date = new Date(ts * 1000);
      const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      fragments.push(
        `<div style="position:absolute;left:${xPos}px;top:0;width:1px;height:${containerHeight}px;background:rgba(255,255,255,0.12);pointer-events:none;">` +
        `<div style="position:absolute;top:6px;left:4px;font-size:10px;color:rgba(255,255,255,0.35);white-space:nowrap;font-family:monospace;letter-spacing:0.03em;">${label}</div>` +
        `</div>`
      );
    }

    overlay.innerHTML = fragments.join('');
  };

  const SESSION_DEFINITIONS = [
    { name: 'ASIA', startHour: 0, endHour: 8, color: 'rgba(56,189,248,0.07)' },
    { name: 'LONDON', startHour: 8, endHour: 16, color: 'rgba(251,191,36,0.07)' },
    { name: 'NEW YORK', startHour: 13, endHour: 21, color: 'rgba(248,113,113,0.07)' },
  ];

  const renderSessionBands = () => {
    if (!showSessionBands || timeframe === 'D1' || !chartRef.current || !sessionBandsOverlayRef.current || !chartContainerRef.current) {
      if (sessionBandsOverlayRef.current) {
        sessionBandsOverlayRef.current.innerHTML = '';
      }
      return;
    }

    const chart = chartRef.current;
    const overlay = sessionBandsOverlayRef.current;
    const container = chartContainerRef.current;
    const candles = historicalCandlesRef.current;

    if (candles.length === 0) {
      overlay.innerHTML = '';
      return;
    }

    const timeScale = chart.timeScale();
    let visibleRange: { from: number; to: number } | null = null;
    try {
      visibleRange = timeScale.getVisibleRange() as { from: number; to: number } | null;
    } catch {
      return;
    }
    if (!visibleRange) {
      overlay.innerHTML = '';
      return;
    }

    const containerHeight = container.clientHeight;
    const containerWidth = container.clientWidth;

    const startDay = Math.floor(visibleRange.from / 86400);
    const endDay = Math.floor(visibleRange.to / 86400) + 1;

    const fragments: string[] = [];

    for (let day = startDay; day <= endDay; day++) {
      const dayBaseUtc = day * 86400;

      for (const session of SESSION_DEFINITIONS) {
        const sessionStart = dayBaseUtc + session.startHour * 3600;
        const sessionEnd = dayBaseUtc + session.endHour * 3600;

        if (sessionEnd < visibleRange.from || sessionStart > visibleRange.to) continue;

        let xStart: number;
        let xEnd: number;
        try {
          xStart = timeScale.timeToCoordinate(Math.max(sessionStart, visibleRange.from) as any) as number;
          xEnd = timeScale.timeToCoordinate(Math.min(sessionEnd, visibleRange.to) as any) as number;
        } catch {
          continue;
        }

        if (xStart === null || xEnd === null) continue;
        if (xEnd <= 0 || xStart >= containerWidth) continue;

        xStart = Math.max(0, xStart);
        xEnd = Math.min(containerWidth, xEnd);
        const width = xEnd - xStart;
        if (width < 2) continue;

        const labelColor = session.color.replace('0.07', '0.55');
        const showLabel = width > 42;

        fragments.push(
          `<div style="position:absolute;left:${xStart}px;top:0;width:${width}px;height:${containerHeight}px;background:${session.color};pointer-events:none;">` +
          (showLabel ? `<div style="position:absolute;top:6px;left:6px;font-size:9px;color:${labelColor};white-space:nowrap;font-family:monospace;letter-spacing:0.06em;font-weight:600;">${session.name}</div>` : '') +
          `</div>`
        );
      }
    }

    overlay.innerHTML = fragments.join('');
  };

  useEffect(() => {
    if (!chartRef.current) return;

    const chart = chartRef.current;
    const timeScale = chart.timeScale();

    const scheduleRender = () => {
      if (sessionBandsRafRef.current !== null) {
        cancelAnimationFrame(sessionBandsRafRef.current);
      }
      sessionBandsRafRef.current = requestAnimationFrame(() => {
        renderSessionBands();
        sessionBandsRafRef.current = null;
      });
    };

    timeScale.subscribeVisibleTimeRangeChange(scheduleRender);
    scheduleRender();

    return () => {
      try {
        timeScale.unsubscribeVisibleTimeRangeChange(scheduleRender);
      } catch {
        // chart may be disposed
      }
      if (sessionBandsRafRef.current !== null) {
        cancelAnimationFrame(sessionBandsRafRef.current);
        sessionBandsRafRef.current = null;
      }
    };
  }, [showSessionBands, timeframe]);

  useEffect(() => {
    if (sessionBandsRafRef.current !== null) {
      cancelAnimationFrame(sessionBandsRafRef.current);
    }
    sessionBandsRafRef.current = requestAnimationFrame(() => {
      renderSessionBands();
      sessionBandsRafRef.current = null;
    });
  }, [historicalCandlesRef.current.length, showSessionBands, timeframe]);

  useEffect(() => {
    const handleExternalChange = (e: CustomEvent) => {
      setShowSessionBands(e.detail as boolean);
    };
    window.addEventListener('session-bands-changed', handleExternalChange as EventListener);
    return () => window.removeEventListener('session-bands-changed', handleExternalChange as EventListener);
  }, []);

  useEffect(() => {
    const handleExternalChange = (e: CustomEvent) => {
      setShowDaySeparators(e.detail as boolean);
    };
    window.addEventListener('day-separators-changed', handleExternalChange as EventListener);
    return () => window.removeEventListener('day-separators-changed', handleExternalChange as EventListener);
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;

    const chart = chartRef.current;
    const timeScale = chart.timeScale();

    const scheduleRender = () => {
      if (daySeparatorRafRef.current !== null) {
        cancelAnimationFrame(daySeparatorRafRef.current);
      }
      daySeparatorRafRef.current = requestAnimationFrame(() => {
        renderDaySeparators();
        daySeparatorRafRef.current = null;
      });
    };

    timeScale.subscribeVisibleTimeRangeChange(scheduleRender);

    scheduleRender();

    return () => {
      try {
        timeScale.unsubscribeVisibleTimeRangeChange(scheduleRender);
      } catch {
        // chart may be disposed
      }
      if (daySeparatorRafRef.current !== null) {
        cancelAnimationFrame(daySeparatorRafRef.current);
        daySeparatorRafRef.current = null;
      }
    };
  }, [showDaySeparators, timeframe]);

  useEffect(() => {
    if (daySeparatorRafRef.current !== null) {
      cancelAnimationFrame(daySeparatorRafRef.current);
    }
    daySeparatorRafRef.current = requestAnimationFrame(() => {
      renderDaySeparators();
      daySeparatorRafRef.current = null;
    });
  }, [historicalCandlesRef.current.length, showDaySeparators, timeframe]);

  const handleToggleDaySeparators = () => {
    const newValue = !showDaySeparators;
    setShowDaySeparators(newValue);
    chartPreferencesService.setShowDaySeparators(newValue);
  };

  const handleToggleSessionBands = () => {
    const newValue = !showSessionBands;
    setShowSessionBands(newValue);
    chartPreferencesService.setShowSessionBands(newValue);
  };

  // Listen for gap detection events and trigger backfill
  // Gap detection removed - clean backfill system will handle historical data
  // Charts now rely on continuous-candle-aggregator for fresh data

  useEffect(() => {
    if (!chartRef.current || !candlestickSeriesRef.current || !tradeLines) return;

    if (tradeLineRefs.current.entry) {
      candlestickSeriesRef.current.removePriceLine(tradeLineRefs.current.entry);
      tradeLineRefs.current.entry = undefined;
    }
    if (tradeLineRefs.current.stopLoss) {
      candlestickSeriesRef.current.removePriceLine(tradeLineRefs.current.stopLoss);
      tradeLineRefs.current.stopLoss = undefined;
    }
    if (tradeLineRefs.current.takeProfit) {
      candlestickSeriesRef.current.removePriceLine(tradeLineRefs.current.takeProfit);
      tradeLineRefs.current.takeProfit = undefined;
    }
    if (tradeLineRefs.current.tp1) {
      candlestickSeriesRef.current.removePriceLine(tradeLineRefs.current.tp1);
      tradeLineRefs.current.tp1 = undefined;
    }
    if (tradeLineRefs.current.tp2) {
      candlestickSeriesRef.current.removePriceLine(tradeLineRefs.current.tp2);
      tradeLineRefs.current.tp2 = undefined;
    }
    if (tradeLineRefs.current.watchedLevel) {
      candlestickSeriesRef.current.removePriceLine(tradeLineRefs.current.watchedLevel);
      tradeLineRefs.current.watchedLevel = undefined;
    }
    if (tradeLineRefs.current.earlyExitLevel) {
      candlestickSeriesRef.current.removePriceLine(tradeLineRefs.current.earlyExitLevel);
      tradeLineRefs.current.earlyExitLevel = undefined;
    }

    const { entry, stopLoss, takeProfit, tp1, tp2, watchedLevel, earlyExitLevel } = tradeLines;

    // Determine which TP values to use: prefer tp1/tp2, fallback to legacy takeProfit
    const useTP1 = tp1 !== undefined && tp1 !== null;
    const useTP2 = tp2 !== undefined && tp2 !== null;
    const useLegacyTP = !useTP1 && !useTP2 && takeProfit !== undefined && takeProfit !== null;

    console.log(`%c[Chart Lines] Creating trade lines for ${symbol}`, 'color: #00aaff; font-weight: bold');
    console.log(`  Entry Price: ${entry?.toFixed(5) || 'none'}`);
    console.log(`  Stop Loss:   ${stopLoss?.toFixed(5) || 'none'}`);
    console.log(`  TP1 (Conservative): ${tp1?.toFixed(5) || 'none'}`);
    console.log(`  TP2 (Full Target): ${tp2?.toFixed(5) || 'none'}`);
    console.log(`  Legacy Take Profit: ${takeProfit?.toFixed(5) || 'none'}`);

    if (entry && stopLoss && (tp2 || takeProfit)) {
      const slDistance = Math.abs(entry - stopLoss);
      const fullTP = tp2 || takeProfit;
      const tpDistance = Math.abs(entry - fullTP);
      const chartRR = tpDistance / slDistance;
      console.log(`  Chart calculated R:R: 1:${chartRR.toFixed(2)}`);
      console.log(`  SL Distance: ${slDistance.toFixed(5)} (${(slDistance / 0.00001).toFixed(1)} pips for standard pairs)`);
      console.log(`  TP Distance: ${tpDistance.toFixed(5)} (${(tpDistance / 0.00001).toFixed(1)} pips for standard pairs)`);
    }

    if (entry) {
      tradeLineRefs.current.entry = candlestickSeriesRef.current.createPriceLine({
        price: entry,
        color: '#3b82f6',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: 'Entry',
      });
    }

    if (stopLoss) {
      tradeLineRefs.current.stopLoss = candlestickSeriesRef.current.createPriceLine({
        price: stopLoss,
        color: '#ef4444',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Stop Loss',
      });
    }

    // Draw TP1 line (Conservative target) - cyan color
    if (useTP1) {
      tradeLineRefs.current.tp1 = candlestickSeriesRef.current.createPriceLine({
        price: tp1,
        color: '#06b6d4', // cyan-500
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'TP1',
      });
    }

    // Draw TP2 line (Full target) - emerald color
    if (useTP2) {
      tradeLineRefs.current.tp2 = candlestickSeriesRef.current.createPriceLine({
        price: tp2,
        color: '#10b981', // emerald-500
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'TP2',
      });
    }

    // Legacy single TP (for backward compatibility)
    if (useLegacyTP) {
      tradeLineRefs.current.takeProfit = candlestickSeriesRef.current.createPriceLine({
        price: takeProfit,
        color: '#10b981',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Take Profit',
      });
    }

    if (watchedLevel) {
      tradeLineRefs.current.watchedLevel = candlestickSeriesRef.current.createPriceLine({
        price: watchedLevel,
        color: '#f97316',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '⚠️ Critical Level',
      });
    }

    if (earlyExitLevel) {
      tradeLineRefs.current.earlyExitLevel = candlestickSeriesRef.current.createPriceLine({
        price: earlyExitLevel,
        color: '#22c55e',
        lineWidth: 2,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: '🎯 Early Exit',
      });
    }

    return () => {
      if (candlestickSeriesRef.current) {
        if (tradeLineRefs.current.entry) {
          candlestickSeriesRef.current.removePriceLine(tradeLineRefs.current.entry);
        }
        if (tradeLineRefs.current.stopLoss) {
          candlestickSeriesRef.current.removePriceLine(tradeLineRefs.current.stopLoss);
        }
        if (tradeLineRefs.current.takeProfit) {
          candlestickSeriesRef.current.removePriceLine(tradeLineRefs.current.takeProfit);
        }
        if (tradeLineRefs.current.tp1) {
          candlestickSeriesRef.current.removePriceLine(tradeLineRefs.current.tp1);
        }
        if (tradeLineRefs.current.tp2) {
          candlestickSeriesRef.current.removePriceLine(tradeLineRefs.current.tp2);
        }
        if (tradeLineRefs.current.watchedLevel) {
          candlestickSeriesRef.current.removePriceLine(tradeLineRefs.current.watchedLevel);
        }
        if (tradeLineRefs.current.earlyExitLevel) {
          candlestickSeriesRef.current.removePriceLine(tradeLineRefs.current.earlyExitLevel);
        }
      }
    };
  }, [tradeLines]);

  // BID/ASK/MID Price Lines Effect
  useEffect(() => {
    if (!chartRef.current || !candlestickSeriesRef.current) return;

    if (bidLineRef.current) {
      candlestickSeriesRef.current.removePriceLine(bidLineRef.current);
      bidLineRef.current = null;
    }
    if (askLineRef.current) {
      candlestickSeriesRef.current.removePriceLine(askLineRef.current);
      askLineRef.current = null;
    }
    if (midLineRef.current) {
      candlestickSeriesRef.current.removePriceLine(midLineRef.current);
      midLineRef.current = null;
    }

    if (bidPrice !== null && askPrice !== null) {
      const midPrice = (bidPrice + askPrice) / 2;

      bidLineRef.current = candlestickSeriesRef.current.createPriceLine({
        price: bidPrice,
        color: '#f97316',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: '',
      });

      askLineRef.current = candlestickSeriesRef.current.createPriceLine({
        price: askPrice,
        color: '#06b6d4',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: '',
      });

      midLineRef.current = candlestickSeriesRef.current.createPriceLine({
        price: midPrice,
        color: '#ffffff',
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: false,
        title: '',
      });
    }

    return () => {
      if (candlestickSeriesRef.current) {
        if (bidLineRef.current) {
          candlestickSeriesRef.current.removePriceLine(bidLineRef.current);
        }
        if (askLineRef.current) {
          candlestickSeriesRef.current.removePriceLine(askLineRef.current);
        }
        if (midLineRef.current) {
          candlestickSeriesRef.current.removePriceLine(midLineRef.current);
        }
      }
    };
  }, [bidPrice, askPrice]);

  const FOREX_PAIRS = [
    'XAUUSD', 'US30', 'NAS100', 'SPX500',
    'EURUSD', 'GBPUSD', 'USDJPY',
    'BTCUSD', 'ETHUSD'
  ];

  const TIMEFRAMES: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

  const handleTimeframeChange = (newTimeframe: Timeframe) => {
    setTimeframe(newTimeframe);
    chartPreferencesService.setTimeframe(symbol, newTimeframe);
  };

  const handleSymbolChangeInternal = (newSymbol: string) => {
    const savedTimeframe = chartPreferencesService.getTimeframe(newSymbol);
    setTimeframe(savedTimeframe);
    onSymbolChange(newSymbol);
  };

  const handleChartRefresh = async () => {
    if (isRefreshing) return;

    console.log(`[Chart] 🔄 Manual refresh triggered for ${symbol} ${timeframe}`);
    setIsRefreshing(true);

    try {
      // CRITICAL: Clear cache to force loading from database
      console.log(`[Chart] 🗑️ Clearing cache for ${symbol} ${timeframe} to show latest data`);
      await candleCacheManager.invalidateSymbolTimeframe(symbol, timeframe);

      // Clear current state
      currentCandleRef.current = null;
      historicalCandlesRef.current = [];

      if (candlestickSeriesRef.current) {
        candlestickSeriesRef.current.setData([]);
        vwapSeriesRef.current?.setData([]);
        ema20SeriesRef.current?.setData([]);
        ema50SeriesRef.current?.setData([]);
        ema200SeriesRef.current?.setData([]);
      }

      // Reload chart with fresh data (initializeChart will trigger backfill automatically)
      await initializeChart(false);

      await chartCandlePoller.forceRefresh(symbol, timeframe);

      console.log(`[Chart] ✅ Manual refresh complete for ${symbol} ${timeframe}`);
    } catch (error) {
      console.error('[Chart] Error during manual refresh:', error);
      setError('Failed to refresh chart data');
    } finally {
      setTimeout(() => {
        setIsRefreshing(false);
      }, 500);
    }
  };

  return (
    <div className="h-full flex flex-col relative">
      <div className="flex-shrink-0 pt-6 pb-3">
        {/* Top row: Selectors and Refresh button */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-1.5 sm:gap-3">
            <select
              value={symbol}
              onChange={(e) => handleSymbolChangeInternal(e.target.value)}
              className="chart-select bg-gray-800 text-white px-2 sm:px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-xs sm:text-sm"
            >
              {FOREX_PAIRS.map(pair => (
                <option key={pair} value={pair}>{pair}</option>
              ))}
            </select>

            <select
              value={timeframe}
              onChange={(e) => handleTimeframeChange(e.target.value as Timeframe)}
              className="chart-select bg-gray-800 text-white px-2 sm:px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-xs sm:text-sm"
            >
              {TIMEFRAMES.map(tf => (
                <option key={tf} value={tf}>{tf}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Session bands toggle */}
            {timeframe !== 'D1' && (
              <button
                onClick={handleToggleSessionBands}
                className={`px-2 py-1.5 rounded-lg transition-all text-[10px] font-medium border ${
                  showSessionBands
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/25'
                    : 'bg-gray-800 text-gray-500 border-gray-700 hover:border-gray-600 hover:text-gray-400'
                }`}
                title="Toggle trading session bands (Asia / London / New York)"
              >
                SES
              </button>
            )}
            {/* Day separator toggle */}
            {timeframe !== 'D1' && (
              <button
                onClick={handleToggleDaySeparators}
                className={`px-2 py-1.5 rounded-lg transition-all text-[10px] font-medium border ${
                  showDaySeparators
                    ? 'bg-sky-500/15 text-sky-400 border-sky-500/40 hover:bg-sky-500/25'
                    : 'bg-gray-800 text-gray-500 border-gray-700 hover:border-gray-600 hover:text-gray-400'
                }`}
                title="Toggle daily session separators"
              >
                1D
              </button>
            )}

            {/* Refresh button */}
            <button
              onClick={handleChartRefresh}
              disabled={isRefreshing}
              className={`p-1.5 sm:p-2 rounded-lg transition-all ${
                isRefreshing
                  ? 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
                  : 'bg-gray-800 hover:bg-gray-700 text-white border border-gray-700 hover:border-gray-600'
              }`}
              title="Refresh chart data"
            >
              <RefreshCw
                size={14}
                className={isRefreshing ? 'animate-spin' : ''}
              />
            </button>
          </div>
        </div>

        {currentPrice && (
          <div className="flex justify-center mb-3">
            <div className="flex sm:hidden items-center gap-2 text-xs">
              <div className={`font-bold transition-all duration-500 ease-out ${
                priceUpdateFlash
                  ? (priceChange >= 0 ? 'text-emerald-400 scale-105' : 'text-red-400 scale-105')
                  : 'text-white scale-100'
              }`}>
                {formatPrice(currentPrice, symbol, true)}
                <span className={`ml-2 text-[10px] ${
                  priceChange >= 0 ? 'text-emerald-500' : 'text-red-500'
                }`}>
                  {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
                </span>
              </div>
              {cryptoDataSource && ['BTCUSD', 'ETHUSD'].includes(symbol) && (
                <div className="text-[9px] text-gray-500 px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/20">
                  {cryptoDataSource.replace('-live', '').toUpperCase()}
                </div>
              )}
            </div>

            <div className="hidden sm:flex items-center gap-3">
              <div className={`text-2xl font-bold transition-all duration-500 ease-out ${
                priceUpdateFlash
                  ? (priceChange >= 0 ? 'text-emerald-400 scale-105' : 'text-red-400 scale-105')
                  : 'text-white scale-100'
              }`}>
                {formatPrice(currentPrice, symbol, false)}
              </div>
              <div className={`text-sm flex items-center gap-1 ${
                priceChange >= 0 ? 'text-emerald-500' : 'text-red-500'
              }`}>
                <Activity size={14} />
                {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
              </div>
              {cryptoDataSource && ['BTCUSD', 'ETHUSD'].includes(symbol) && (
                <div className="px-2 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  {cryptoDataSource.replace('-live', '').toUpperCase()}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {dataQualityWarning && (
        <div className="mb-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="text-yellow-500 flex-shrink-0 mt-0.5" size={18} />
            <div>
              <p className="text-yellow-500 text-sm font-medium">Data Quality Notice</p>
              <p className="text-yellow-400/80 text-xs mt-1">{dataQualityWarning}</p>
            </div>
          </div>
        </div>
      )}


      <div className="flex-1 relative isolate min-h-0">
        {isLoading && (
          <ChartLoadingOverlay
            symbol={symbol}
            timeframe={timeframe}
            loaded={loadingProgress?.loaded}
            total={loadingProgress?.total}
          />
        )}

        {error && (
          <div className="absolute inset-0 bg-gray-800 rounded-lg flex items-center justify-center z-10">
            <div className="text-center p-6 max-w-md">
              <AlertCircle className="text-red-500 mx-auto mb-3" size={32} />
              <p className="text-white font-semibold mb-2">Chart Loading Error</p>
              <p className="text-white/70 text-sm mb-4">{error}</p>
              <button
                onClick={() => {
                  setError(null);
                  initializeChart(true);
                }}
                className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-medium transition-colors flex items-center gap-2 mx-auto"
              >
                <RefreshCw size={16} />
                Retry
              </button>
              {shouldDisableMetaAPI() && (
                <p className="text-white/50 text-xs mt-4">
                  Development Mode: Ensure Supabase is configured and database contains data
                </p>
              )}
            </div>
          </div>
        )}

        <div className="relative h-full">
          <div ref={chartContainerRef} className="rounded-lg overflow-hidden h-full" />
          <div ref={sessionBandsOverlayRef} className="absolute inset-0 pointer-events-none overflow-hidden rounded-lg" style={{ zIndex: 2 }} />
          <div ref={daySeparatorOverlayRef} className="absolute inset-0 pointer-events-none overflow-hidden rounded-lg" />

          {/* Status Overlay - Bottom Left */}
          <div className="absolute bottom-2 left-2 z-20 pointer-events-none">
            <div className="bg-gray-900/90 backdrop-blur-sm border border-gray-800/50 rounded px-1.5 py-1 space-y-0.5 shadow-lg">
              <div className="text-white/60 flex items-center gap-1 text-[10px]">
                <Clock size={9} />
                Last updated: {lastUpdate ? lastUpdate.toLocaleTimeString() : 'Waiting...'}
              </div>
              {cacheAge !== null && (
                <div className={`text-[10px] ${cacheAge > 15 ? 'text-yellow-400' : 'text-blue-400'}`}>
                  Data: {cacheAge < 1 ? 'Live' : `${Math.round(cacheAge)}min ago`}
                </div>
              )}
              {isDatabaseOnlyMode && (
                <div className="text-[10px] text-blue-400 font-medium">
                  💾 Database Mode {isWebContainer() ? '(Dev)' : ''}
                </div>
              )}
              <div className={`text-[10px] font-medium ${symbolMarketStatus.isOpen ? 'text-green-400' : 'text-red-400'}`}>
                {symbolMarketStatus.is24Hour
                  ? `Market Open 24/7`
                  : symbolMarketStatus.isOpen
                    ? 'Market Open'
                    : 'Forex Closed'
                }
              </div>
            </div>
          </div>
        </div>
      </div>

      {backgroundLoading && (
        <BackgroundLoadingIndicator
          completed={backgroundLoading.completed}
          total={backgroundLoading.total}
          currentBatch={backgroundLoading.currentBatch}
        />
      )}
    </div>
  );
}
