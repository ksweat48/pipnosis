import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createChart, CandlestickSeries, IChartApi, ISeriesApi, LineStyle, LineSeries } from 'lightweight-charts';
import { supabase } from '@/lib/supabase';
import { TrendingUp, Activity, AlertCircle, Clock, RefreshCw, Zap } from 'lucide-react';
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
import {
  calculateVWAP,
  calculateEMA,
  calculateRSI,
  calculateATR,
  calculateVolumeMetrics,
  detectCandlePatterns,
  IndicatorResult,
  VolumeData,
  PatternDetection
} from '@/utils/technicalIndicators';
import { getForexMarketStatus, getTimeUntilMarketChange, type MarketStatus } from '@/utils/marketHours';
import { concurrentBulkLoader } from '@/services/concurrent-bulk-loader';
import { ChartLoadingOverlay, BackgroundLoadingIndicator } from '@/components/ChartLoadingOverlay';
import { priceValidationService } from '@/services/price-validation-service';
import { chartCircuitBreaker } from '@/services/chart-circuit-breaker';
import { validateSymbol, type ValidatedSymbol } from '@/types/symbol';
import { ChartDataGuarantor } from '@/services/chart-data-guarantor';
import { currentCandleReconstructor } from '@/services/current-candle-reconstructor';

interface MarketChartProps {
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  tradeLines?: {
    entry?: number;
    stopLoss?: number;
    takeProfit?: number;
  };
  onTradeExecuted?: () => void;
}

interface CurrentCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  startTime: number;
}

export function MarketChart({ symbol, onSymbolChange, tradeLines, onTradeExecuted }: MarketChartProps) {
  const navigate = useNavigate();

  // CRITICAL: Validate and track current symbol to reject cross-contaminated updates
  const validationResult = validateSymbol(symbol);
  if (!validationResult.isValid) {
    console.error(`[Chart] Invalid symbol provided: ${symbol}`);
    return <div className="text-red-500 p-4">Error: Invalid symbol {symbol}</div>;
  }

  const validatedSymbol = validationResult.symbol!;
  const currentSymbolRef = useRef<ValidatedSymbol>(validatedSymbol);

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
    takeProfit?: any;
  }>({});

  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
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
  const [directPollerActive, setDirectPollerActive] = useState(false);
  const [forexMarketStatus, setForexMarketStatus] = useState<MarketStatus>(() => getForexMarketStatus());
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  useEffect(() => {
    let previousMarketStatus = forexMarketStatus.isOpen;

    const updateMarketStatus = () => {
      const newStatus = getForexMarketStatus();
      const wasOpen = previousMarketStatus;
      const isNowOpen = newStatus.isOpen;

      setForexMarketStatus(newStatus);

      // Market just closed - freeze time range
      if (wasOpen && !isNowOpen && chartRef.current) {
        console.log('[Chart] 🔒 Market closed - freezing time range');
        const timeScale = chartRef.current.timeScale();
        const currentRange = timeScale.getVisibleLogicalRange();

        if (currentRange) {
          timeScale.setVisibleLogicalRange(currentRange);
        }
      }

      // Market just opened - resume real-time scrolling
      if (!wasOpen && isNowOpen && chartRef.current) {
        console.log('[Chart] 🔓 Market opened - resuming updates');
        chartRef.current.timeScale().scrollToRealTime();
      }

      previousMarketStatus = isNowOpen;
    };

    updateMarketStatus();
    const interval = setInterval(updateMarketStatus, 60000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.hidden) {
        console.log('[Chart] 🙈 Tab hidden - pausing live tick rendering');
        console.log('[Chart] 💾 DB polling continues (reduced frequency)');
        // Cancel any pending render frames
        if (renderFrameRef.current) {
          cancelAnimationFrame(renderFrameRef.current);
          renderFrameRef.current = null;
        }
        // Reduce polling frequency when tab is hidden
        chartCandlePoller.pause();
      } else {
        console.log('[Chart] 👁️ Tab visible - resuming full hybrid mode');
        console.log('[Chart] 🔄 Reconstructing current candle from latest data...');

        // Resume polling FIRST so the system is ready
        chartCandlePoller.resume();

        // ENHANCED: Smart catchup - fetch ALL candles created while user was away
        try {
          if (historicalCandlesRef.current.length > 0) {
            const lastKnownTime = historicalCandlesRef.current[historicalCandlesRef.current.length - 1].time;
            const lastKnownDate = new Date(lastKnownTime * 1000);
            const now = new Date();
            const hoursAway = (now.getTime() - lastKnownDate.getTime()) / (1000 * 60 * 60);

            console.log(`[Chart] User was away for ${hoursAway.toFixed(1)} hours`);

            // If user was away for more than 5 minutes, fetch all missed candles
            if (hoursAway > (5 / 60)) {
              console.log('[Chart] 🔄 Fetching missed candles from database...');

              // Fetch candles from the last known time until now
              const lookbackHours = Math.min(Math.ceil(hoursAway) + 1, 24); // Cap at 24 hours
              const allCandles = await fetchCandlesByTimeRange(symbol, timeframe, lookbackHours);

              // Filter to only NEW candles after last known
              const newCandles = allCandles.filter(c => c.time > lastKnownTime);

              if (newCandles.length > 0) {
                console.log(`[Chart] 🆕 Found ${newCandles.length} candles created while away`);

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

                console.log(`[Chart] ✓ Chart updated with all missed candles`);
              } else {
                console.log('[Chart] No new candles found (user was away during same candle period)');
              }

              // CRITICAL FIX: Reconstruct current candle after catchup
              const lastHistoricalTime = historicalCandlesRef.current[historicalCandlesRef.current.length - 1].time;
              console.log('[Chart] 🔄 Reconstructing current candle from database ticks...');

              try {
                const reconstruction = await currentCandleReconstructor.reconstructCurrentCandle(
                  symbol,
                  timeframe,
                  lastHistoricalTime
                );

                if (reconstruction.wasReconstructed && reconstruction.candle) {
                  console.log(`[Chart] ✅ Current candle reconstructed from ${reconstruction.tickCount} ticks`);

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
              console.log('[Chart] User was only away briefly, no catchup needed');

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

        console.log('[Chart] 📡 Live tick rendering resumed');
        console.log('[Chart] 💾 DB polling resumed at full frequency');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [symbol, timeframe]);

  useEffect(() => {
    if (!chartContainerRef.current) {
      console.error('[Chart] chartContainerRef is null, cannot create chart');
      return;
    }

    const containerWidth = chartContainerRef.current.clientWidth;
    console.log('[Chart] Creating chart with container width:', containerWidth);

    if (containerWidth === 0) {
      console.warn('[Chart] Container width is 0, chart may not display properly');
    }

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#1f2937' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: '#374151' },
        horzLines: { color: '#374151' },
      },
      width: containerWidth || 600,
      height: 400,
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
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
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
      priceFormat: {
        type: 'price',
        precision: 5,
        minMove: 0.00001,
      },
      lastValueVisible: true,
      priceLineVisible: true,
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
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
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
      'D1': 20,    // 20 days
      'W1': 12     // 12 weeks = ~3 months
    };
    return lookbackMap[tf] || 100;
  };

  const updateIndicators = (candles: CandleData[]) => {
    if (candles.length === 0) return;

    const vwapLookback = getVWAPLookbackPeriod(timeframe);
    const vwap = calculateVWAP(candles, vwapLookback);
    const ema20 = calculateEMA(candles, 20);
    const ema50 = calculateEMA(candles, 50);
    const ema200 = calculateEMA(candles, 200);
    const rsi = calculateRSI(candles, 14);
    const atr = calculateATR(candles, 14);
    const volume = calculateVolumeMetrics(candles);
    const patterns = detectCandlePatterns(candles, vwap);

    if (vwapSeriesRef.current) {
      if (indicatorVisibility.vwap && vwap.length > 0) {
        vwapSeriesRef.current.setData(vwap);
        setVwapValue(vwap[vwap.length - 1].value);
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

  const updateCurrentCandleFromTick = (tick: { symbol: string; bid: number; ask: number; timestamp: string; midPrice: number }) => {
    // CRITICAL: Check if chart is still mounted
    if (!candlestickSeriesRef.current || !chartRef.current) {
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

    // Check if market is open before processing tick
    if (!forexMarketStatus.isOpen) {
      return;
    }

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
      const timestampMs = new Date(tick.timestamp).getTime();
      const timeframeMinutes = getTimeframeMinutes(timeframe);
      const candleTime = Math.floor(timestampMs / (timeframeMinutes * 60 * 1000)) * (timeframeMinutes * 60 * 1000);
      const candleTimeSeconds = Math.floor(candleTime / 1000);

      // CRITICAL FIX: Reject ticks that would create candles older than our historical data
      const lastHistoricalTime = historicalCandlesRef.current.length > 0
        ? historicalCandlesRef.current[historicalCandlesRef.current.length - 1].time
        : 0;

      // STRICT OVERLAP PREVENTION: Reject any candle with timestamp <= last historical
      if (candleTimeSeconds <= lastHistoricalTime) {
        // Silently ignore old ticks that would create overlaps
        return;
      }

      // Also reject if this tick would create a candle older than our current forming candle
      if (currentCandleRef.current && candleTimeSeconds < currentCandleRef.current.time) {
        // This is an old tick, ignore it
        return;
      }

      // Validate this candle is at least one interval after the last historical
      const expectedMinTime = lastHistoricalTime + (getTimeframeMinutes(timeframe) * 60);
      if (candleTimeSeconds < expectedMinTime && lastHistoricalTime > 0) {
        console.warn(`[Chart] Rejecting tick: candle time ${candleTimeSeconds} < expected min time ${expectedMinTime}`);
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
        console.log(`[Chart] 🆕 New forming candle started for ${symbol} at ${new Date(candleTime).toLocaleTimeString()}`);
      } else {
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

        const safeCandle: CandleData = {
          time: timeValue,
          open: Number(currentCandleRef.current.open),
          high: Number(currentCandleRef.current.high),
          low: Number(currentCandleRef.current.low),
          close: Number(currentCandleRef.current.close)
        };

        candlestickSeriesRef.current?.update(safeCandle);

        setCurrentPrice(price);
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

    // Check if market is open before processing poller update
    if (!forexMarketStatus.isOpen) {
      return;
    }

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
        candlestickSeriesRef.current.update(safeCandle);
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

      if (chartRef.current && !userInteractedRef.current) {
        chartRef.current.timeScale().scrollToRealTime();
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
    try {
      console.log(`[Chart Init] ========================================`);
      console.log(`[Chart Init] Starting initialization for ${symbol} ${timeframe}`);
      console.log(`[Chart Init] candlestickSeriesRef exists: ${!!candlestickSeriesRef.current}`);
      console.log(`[Chart Init] historicalCandlesRef length: ${historicalCandlesRef.current.length}`);

      if (showLoadingState) {
        setIsLoading(true);
      }
      setError(null);
      if (showLoadingState) {
        setLoadingProgress(null);
      }

      const targetCandleCount = ChartDataGuarantor.calculateSmartCandleCount(timeframe);
      console.log(`[Chart Init] Using ChartDataGuarantor - Target: ${targetCandleCount} candles`);

      const result = await ChartDataGuarantor.guaranteeChartData(symbol, timeframe, targetCandleCount);
      console.log(`[Chart Init] ⚠️ CRITICAL: Guarantor returned ${result.candles.length} candles`);

      console.log(`[Chart Init] Guarantor result:`, {
        candleCount: result.candles.length,
        isComplete: result.isComplete,
        hasGaps: result.hasGaps,
        missingCount: result.missingCount,
        loadTime: result.loadTime
      });

      if (result.candles.length === 0) {
        console.error('[Chart Init] ❌ ZERO CANDLES returned from guarantor!');
        console.error('[Chart Init] This should NEVER happen for active symbols');
        console.error('[Chart Init] Checking database directly...');

        // EMERGENCY: Try direct database query
        const { data: directCandles, error: directError } = await supabase
          .from('forex_candles')
          .select('*')
          .eq('symbol', symbol)
          .eq('timeframe', timeframe)
          .order('open_time', { ascending: false })
          .limit(200);

        if (directError) {
          console.error('[Chart Init] Direct query error:', directError);
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
          setError('Waiting for price data... The price feed will start shortly.');
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

        candlestickSeriesRef.current.setData(sanitizedCandles);

        // VERIFICATION: Check if data was actually set
        const chartDataAfterSet = candlestickSeriesRef.current.data();
        console.log('[Chart Init] ✅ Chart data set successfully - Verification:', {
          sentToChart: sanitizedCandles.length,
          actuallyInChart: chartDataAfterSet.length,
          match: sanitizedCandles.length === chartDataAfterSet.length
        });

        if (chartDataAfterSet.length === 0) {
          console.error('[Chart Init] ❌ CRITICAL: Chart has ZERO candles after setData()!');
          console.error('[Chart Init] This indicates a lightweight-charts library issue or data format problem');
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
          if (chartRef.current && !userInteractedRef.current) {
            chartRef.current.timeScale().scrollToRealTime();
          }
        });
      }

      console.log('[Chart Init] Initialization complete, setting isLoading to false');
      setIsLoading(false);
      setLoadingProgress(null);

      if (result.hasGaps && result.gapDetails.length > 0) {
        console.log(`[Chart Init] Detected ${result.gapDetails.length} weekday gaps, requesting auto-fill...`);
        result.gapDetails.forEach(gap => {
          ChartDataGuarantor.requestGapFill(symbol, timeframe, gap.start, gap.end);
        });
      }

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
      console.error('[Chart Init] Failed to initialize chart:', err);
      if (err instanceof Error) {
        console.error('[Chart Init] Error stack:', err.stack);
      }
      setError('Failed to load chart data');
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
      if (candlestickSeriesRef.current) {
        const chartData = candlestickSeriesRef.current.data();
        console.log(`[Chart] 🔍 SAFEGUARD CHECK: Chart has ${chartData.length} candles`);
        if (chartData.length === 0) {
          console.error('[Chart] ❌ SAFEGUARD TRIGGERED: Chart is empty after initialization!');
          console.error('[Chart] Attempting forced reload...');
          initializeChart(true);
        }
      }
    }, 2000);

    console.log(`[Chart] 🚀 Starting SMOOTH HYBRID mode: Direct MetaAPI + Fallback DB polling for ${symbol} ${timeframe}`);
    setSystemStatus('connecting');

    // PRIORITY 1: Start direct MetaAPI polling for smooth updates (every 3s)
    console.log(`[Chart][${symbol}] 🎯 Starting direct MetaAPI price poller (3s interval)...`);
    chartDirectPricePoller.addSymbol(symbol);

    // CRITICAL FIX: Pass symbol to register listener for THIS symbol only
    const unsubscribeDirectPrice = chartDirectPricePoller.onPriceUpdate(symbol, (price) => {
      // Symbol check now redundant (poller filters) but kept as safety guard
      if (price.symbol === symbol) {
        console.log(`[Chart][${symbol}] 📈 Direct price update from ${price.source}: ${price.midPrice.toFixed(5)}`);
        updateCurrentCandleFromTick({
          symbol: price.symbol,
          bid: price.bid,
          ask: price.ask,
          timestamp: price.timestamp,
          midPrice: price.midPrice
        });
        setMarketStatus('live');
      }
    });

    const unsubscribeDirectStatus = chartDirectPricePoller.onStatusUpdate((status) => {
      setPriceSource(status.source);
      setDirectPollerActive(status.isActive);
      console.log(`[Chart] 📊 Direct poller status: ${status.source}, active: ${status.isActive}`);
    });

    chartDirectPricePoller.start();

    // FALLBACK: Background aggregator for when direct polling fails
    console.log(`[Chart] 📡 Subscribing to background aggregator as fallback for ${symbol}...`);
    // CRITICAL FIX: Pass symbol to ensure we only receive ticks for THIS symbol
    const unsubscribeTicks = backgroundCandleAggregator.onTickUpdate(symbol, (tick) => {
      // Only use if direct poller is not providing updates
      if (!directPollerActive) {
        updateCurrentCandleFromTick(tick);
      }
    });

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

    // Check if there's a forming candle from the aggregator
    const formingCandle = backgroundCandleAggregator.getFormingCandle(symbol, timeframe);
    if (formingCandle) {
      console.log(`[Chart] 📊 Loaded forming candle from aggregator:`, formingCandle);
      updateCurrentCandleFromPoller(formingCandle);
    }

    // Also check DB for latest completed candle
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
      console.log(`[Chart] 🛑 Stopping smooth hybrid mode for ${symbol} ${timeframe}`);
      chartDirectPricePoller.removeSymbol(symbol);
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

    const { entry, stopLoss, takeProfit } = tradeLines;

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

    if (takeProfit) {
      tradeLineRefs.current.takeProfit = candlestickSeriesRef.current.createPriceLine({
        price: takeProfit,
        color: '#10b981',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Take Profit',
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
      }
    };
  }, [tradeLines]);

  const FOREX_PAIRS = [
    'XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'
  ];

  const TIMEFRAMES: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'];

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
      currentCandleRef.current = null;
      historicalCandlesRef.current = [];

      if (candlestickSeriesRef.current) {
        candlestickSeriesRef.current.setData([]);
        vwapSeriesRef.current?.setData([]);
        ema20SeriesRef.current?.setData([]);
        ema50SeriesRef.current?.setData([]);
        ema200SeriesRef.current?.setData([]);
      }

      await initializeChart(true);

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
    <div className="space-y-4 relative">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <select
              value={symbol}
              onChange={(e) => handleSymbolChangeInternal(e.target.value)}
              className="bg-gray-800 text-white px-3 sm:px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm"
            >
              {FOREX_PAIRS.map(pair => (
                <option key={pair} value={pair}>{pair}</option>
              ))}
            </select>

            <select
              value={timeframe}
              onChange={(e) => handleTimeframeChange(e.target.value as Timeframe)}
              className="bg-gray-800 text-white px-3 sm:px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm"
            >
              {TIMEFRAMES.map(tf => (
                <option key={tf} value={tf}>{tf}</option>
              ))}
            </select>

          </div>

          {/* Desktop: Price on the right side */}
          {currentPrice && (
            <div className="hidden sm:flex items-center gap-4">
              <div className="flex items-center gap-3">
                <div className={`text-2xl font-bold transition-all duration-500 ease-out ${
                  priceUpdateFlash
                    ? (priceChange >= 0 ? 'text-emerald-400 scale-105' : 'text-red-400 scale-105')
                    : 'text-white scale-100'
                }`}>
                  {currentPrice.toFixed(5)}
                </div>
                <div className={`text-sm flex items-center gap-1 ${
                  priceChange >= 0 ? 'text-emerald-500' : 'text-red-500'
                }`}>
                  <Activity size={14} />
                  {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
                </div>
                <div className={`px-3 py-1 rounded-lg text-sm font-semibold ${
                  forexMarketStatus.isOpen
                    ? 'bg-green-500/20 text-green-400 border border-green-500/50'
                    : 'bg-red-500/20 text-red-400 border border-red-500/50'
                }`}>
                  {forexMarketStatus.status}
                </div>
                <button
                  onClick={handleChartRefresh}
                  disabled={isRefreshing}
                  className={`p-2 rounded-lg transition-all ${
                    isRefreshing
                      ? 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
                      : 'bg-gray-800 hover:bg-gray-700 text-white border border-gray-700 hover:border-gray-600'
                  }`}
                  title="Refresh chart data"
                >
                  <RefreshCw
                    size={16}
                    className={isRefreshing ? 'animate-spin' : ''}
                  />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Mobile: Price below controls */}
        {currentPrice && (
          <div className="sm:hidden flex items-center justify-center gap-3 px-3 py-2 bg-gray-800/50 rounded-lg border border-gray-700">
            <div className={`text-lg font-bold transition-all duration-500 ease-out ${
              priceUpdateFlash
                ? (priceChange >= 0 ? 'text-emerald-400 scale-105' : 'text-red-400 scale-105')
                : 'text-white scale-100'
            }`}>
              {currentPrice.toFixed(5)}
            </div>
            <div className={`text-sm flex items-center gap-1 ${
              priceChange >= 0 ? 'text-emerald-500' : 'text-red-500'
            }`}>
              <Activity size={12} />
              {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
            </div>
            <div className={`px-2.5 py-0.5 rounded-lg text-xs font-semibold ${
              forexMarketStatus.isOpen
                ? 'bg-green-500/20 text-green-400 border border-green-500/50'
                : 'bg-red-500/20 text-red-400 border border-red-500/50'
            }`}>
              {forexMarketStatus.status}
            </div>
            <button
              onClick={handleChartRefresh}
              disabled={isRefreshing}
              className={`p-1.5 rounded-lg transition-all ${
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


      <div className="relative isolate">
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
            <div className="text-center p-6">
              <AlertCircle className="text-red-500 mx-auto mb-3" size={32} />
              <p className="text-white font-semibold mb-2">Chart Error</p>
              <p className="text-white/70 text-sm">{error}</p>
            </div>
          </div>
        )}

        <div className="relative">
          <div ref={chartContainerRef} className="rounded-lg overflow-hidden" />

          {/* Start Trading Button - Bottom Right */}
          <button
            onClick={() => navigate('/ai-trade')}
            className="absolute bottom-4 right-4 flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-semibold rounded-lg shadow-lg shadow-emerald-600/30 hover:shadow-emerald-500/40 transition-all duration-300 transform hover:scale-105 z-10"
          >
            <Zap size={18} />
            <span>Start Trading</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-4">
          {lastUpdate && (
            <div className="text-white/50 flex items-center gap-2">
              <Clock size={12} />
              Last updated: {lastUpdate.toLocaleTimeString()}
            </div>
          )}
          {updateCount > 0 && (
            <div className="text-emerald-500/70 flex items-center gap-1">
              <TrendingUp size={12} />
              {updateCount} updates
            </div>
          )}
        </div>
        {debugInfo && (
          <div className="text-blue-400/70 font-mono text-xs">
            {debugInfo}
          </div>
        )}
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
