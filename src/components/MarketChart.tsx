import React, { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, IChartApi, ISeriesApi, LineStyle, LineSeries } from 'lightweight-charts';
import { supabase } from '@/lib/supabase';
import { TrendingUp, Activity, AlertCircle, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { chartPreferencesService, Timeframe, type IndicatorVisibility } from '@/services/chart-preferences';
import { globalPollingCoordinator } from '@/services/global-polling-coordinator';
import { pollingConfigService } from '@/services/polling-config-service';
import {
  fetchCompleteChartData,
  fetchRecentRealtimePrices,
  aggregatePricesToCurrentCandle,
  getTimeframeMinutes,
  validateCandleAgainstHistorical,
  sanitizeCandleData,
  sanitizeCandleArray,
  CandleData,
  RealtimePrice as RealtimePriceType
} from '@/services/candle-data-service';
import { detectAndBackfillGaps } from '@/services/candle-backfill-service';
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
import { RSIPanel, ATRPanel, VolumePanel, PatternDetectionPanel } from '@/components/IndicatorPanels';
import { ManualTradePanel } from '@/components/ManualTradePanel';
import { getForexMarketStatus, getTimeUntilMarketChange, type MarketStatus } from '@/utils/marketHours';
import { concurrentBulkLoader } from '@/services/concurrent-bulk-loader';
import { ChartLoadingOverlay, BackgroundLoadingIndicator } from '@/components/ChartLoadingOverlay';

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
  // CRITICAL: Track current symbol to reject cross-contaminated updates
  const currentSymbolRef = useRef<string>(symbol);

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
  const [timeframe, setTimeframe] = useState<Timeframe>(() => chartPreferencesService.getTimeframe(symbol));
  const [isLive, setIsLive] = useState(false);
  const [systemStatus, setSystemStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connected');
  const [marketStatus, setMarketStatus] = useState<'live' | 'delayed' | 'offline'>('live');
  const [priceSource, setPriceSource] = useState<'metaapi' | 'database' | 'offline'>('offline');
  const [directPollerActive, setDirectPollerActive] = useState(false);
  const [forexMarketStatus, setForexMarketStatus] = useState<MarketStatus>(() => getForexMarketStatus());

  const [rsiData, setRsiData] = useState<IndicatorResult[]>([]);
  const [atrData, setAtrData] = useState<IndicatorResult[]>([]);
  const [volumeData, setVolumeData] = useState<VolumeData[]>([]);
  const [patternData, setPatternData] = useState<PatternDetection[]>([]);

  const [vwapValue, setVwapValue] = useState<number | null>(null);
  const [ema20Value, setEma20Value] = useState<number | null>(null);
  const [ema50Value, setEma50Value] = useState<number | null>(null);
  const [ema200Value, setEma200Value] = useState<number | null>(null);
  const [showIndicators, setShowIndicators] = useState(() => {
    const saved = localStorage.getItem(`indicators-visible-${symbol}`);
    return saved !== null ? saved === 'true' : false;
  });
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
    const handleVisibilityChange = () => {
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
        console.log('[Chart] 📡 Live tick rendering active');
        console.log('[Chart] 💾 DB polling resumed at full frequency');
        chartCandlePoller.resume();
        // Force a refresh to catch up on any missed data
        chartCandlePoller.forceRefresh(symbol, timeframe);
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
        secondsVisible: false,
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
    // CRITICAL: Double-check symbol validation using both prop and ref
    if (tick.symbol !== symbol || tick.symbol !== currentSymbolRef.current) {
      console.warn(`[Chart][${symbol}] ❌ REJECTED tick for wrong symbol: got ${tick.symbol}, expected ${symbol} (ref: ${currentSymbolRef.current})`);
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
        console.error('[Chart] Error updating from tick:', error);
      }

      renderFrameRef.current = null;
    });
  };

  const updateCurrentCandleFromPoller = (latestCandle: CandleData) => {
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
        candlestickSeriesRef.current.update(safeCandle);
      } catch (updateError) {
        console.error('[Chart] Update error:', updateError);
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
      console.log(`[Chart Init] Starting initialization for ${symbol} ${timeframe}`);
      if (showLoadingState) {
        setIsLoading(true);
      }
      setError(null);
      if (showLoadingState) {
        setLoadingProgress(null);
      }

      console.log(`[Chart Init] Priority 1: Loading ${symbol} ${timeframe}...`);

      const success = await concurrentBulkLoader.loadSinglePair(
        symbol,
        timeframe,
        (loaded, total) => {
          setLoadingProgress({ loaded, total });
        }
      );

      if (!success) {
        console.warn('[Chart Init] No candle data found for symbol:', symbol);
        setError('Waiting for price data... The price feed will start shortly.');
        setIsLoading(false);
        setLoadingProgress(null);
        return;
      }

      console.log('[Chart Init] Bulk loader succeeded, fetching chart data...');
      const dataLimit = chartPreferencesService.getDataLimit(timeframe);
      const chartData = await fetchCompleteChartData(symbol, timeframe, dataLimit);

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
        // Filter out Saturday candles (market is always closed)
        const candleDate = new Date(candle.time * 1000);
        const dayOfWeek = candleDate.getUTCDay();

        if (dayOfWeek === 6) {
          console.log(`[Chart Init] Filtering out Saturday candle at ${candleDate.toISOString()}`);
          continue;
        }

        if (!seenTimestamps.has(candle.time)) {
          seenTimestamps.add(candle.time);
          uniqueHistorical.push(candle);
        } else {
          console.warn(`[Chart Init] Skipping duplicate candle at ${new Date(candle.time * 1000).toISOString()}`);
        }
      }

      console.log(`[Chart Init] Checking for data gaps in ${uniqueHistorical.length} candles...`);
      const { candles: backfilledCandles, backfillResult } = await detectAndBackfillGaps(
        symbol,
        timeframe,
        uniqueHistorical
      );

      if (backfillResult.gapsFilled > 0) {
        console.log(`[Chart Init] ✓ Backfilled ${backfillResult.gapsFilled} gaps, created ${backfillResult.candlesCreated} candles`);
        setDataQualityWarning(`Data gaps detected and backfilled from tick data. ${backfillResult.candlesCreated} missing candles restored.`);

        setTimeout(() => setDataQualityWarning(null), 10000);
      } else {
        setDataQualityWarning(null);
      }

      if (backfillResult.errors.length > 0) {
        console.warn('[Chart Init] Backfill errors:', backfillResult.errors);
      }

      // Validate all candle times before setting
      const validatedCandles = backfilledCandles.filter((candle, index) => {
        if (typeof candle.time !== 'number' || isNaN(candle.time)) {
          console.error(`[Chart Init] Invalid candle at index ${index}:`, {
            candle,
            timeType: typeof candle.time
          });
          return false;
        }
        return true;
      });

      if (validatedCandles.length !== backfilledCandles.length) {
        console.warn(`[Chart Init] Filtered out ${backfilledCandles.length - validatedCandles.length} invalid candles`);
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
      }

      if (candlestickSeriesRef.current && validatedCandles.length > 0) {
        // CRITICAL: Sanitize ALL candles to ensure primitive numbers before giving to chart
        const sanitizedCandles = sanitizeCandleArray(validatedCandles);

        console.log('[Chart Init] Setting chart data with', sanitizedCandles.length, 'candles');
        console.log('[Chart Init] First candle type check:', {
          time: typeof sanitizedCandles[0].time,
          open: typeof sanitizedCandles[0].open,
          timeValue: sanitizedCandles[0].time
        });

        candlestickSeriesRef.current.setData(sanitizedCandles);
        console.log('[Chart Init] Chart data set successfully');
      } else {
        console.error('[Chart Init] Cannot set chart data:', {
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

    console.log(`[Chart][${symbol}] Chart series cleared, checking for cached data...`);

    // CRITICAL FIX: Check if we have cached data from the poller before clearing everything
    const cachedCandles = chartCandlePoller.getCachedCandles(symbol, timeframe);
    const hasCachedData = cachedCandles.length > 0;

    if (hasCachedData) {
      console.log(`[Chart] ✅ Found ${cachedCandles.length} cached candles for ${symbol} ${timeframe} - restoring immediately`);

      // CRITICAL: Sanitize cached data to ensure primitive numbers
      const sanitizedCachedCandles = sanitizeCandleArray(cachedCandles);

      // Restore cached data to chart immediately for instant display
      historicalCandlesRef.current = sanitizedCachedCandles;
      candlestickSeriesRef.current.setData(sanitizedCachedCandles);

      // Update price and indicators with cached data
      const lastCandle = cachedCandles[cachedCandles.length - 1];
      const firstCandle = cachedCandles[0];
      setCurrentPrice(lastCandle.close);
      setPriceChange(((lastCandle.close - firstCandle.open) / firstCandle.open) * 100);
      setLastUpdate(new Date());

      // Update indicators with cached data
      requestAnimationFrame(() => {
        updateIndicators(cachedCandles);
        if (chartRef.current && !userInteractedRef.current) {
          chartRef.current.timeScale().scrollToRealTime();
        }
      });

      setIsLoading(false);
      setError(null);
    } else {
      console.log(`[Chart][${symbol}] No cached data found, will load from database...`);
    }

    concurrentBulkLoader.interruptForSymbol(symbol, timeframe);

    // Always run initialization to check for new data
    if (!hasCachedData) {
      initializeChart(true); // Show loading state when no cached data
    } else {
      // If we have cached data, still refresh in background but don't show loading state
      console.log('[Chart] Refreshing data in background...');
      initializeChart(false); // Don't show loading state when we have cached data
    }

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
    console.log(`[Chart] 📡 Subscribing to background aggregator as fallback...`);
    const unsubscribeTicks = backgroundCandleAggregator.onTickUpdate((tick) => {
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
    const saved = localStorage.getItem(`indicators-visible-${newSymbol}`);
    setShowIndicators(saved !== null ? saved === 'true' : true);
    onSymbolChange(newSymbol);
  };

  const toggleIndicators = () => {
    const newValue = !showIndicators;
    setShowIndicators(newValue);
    localStorage.setItem(`indicators-visible-${symbol}`, String(newValue));
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

            <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 bg-gray-800/50 rounded-lg border border-gray-700">
              <div className={`w-2 h-2 rounded-full ${
                systemStatus === 'connected' ? 'bg-green-500 animate-pulse' :
                systemStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' :
                'bg-red-500'
              }`}></div>
              <span className="hidden sm:inline text-xs font-medium text-gray-300">System</span>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 bg-gray-800/50 rounded-lg border border-gray-700">
              <div className={`w-2 h-2 rounded-full ${
                marketStatus === 'live' ? 'bg-green-500 animate-pulse' :
                marketStatus === 'delayed' ? 'bg-yellow-500 animate-pulse' :
                'bg-red-500'
              }`}></div>
              <span className="hidden sm:inline text-xs font-medium text-gray-300">Market</span>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 bg-gray-800/50 rounded-lg border border-gray-700">
              <div className={`w-2 h-2 rounded-full ${
                priceSource === 'metaapi' ? 'bg-blue-500 animate-pulse' :
                priceSource === 'database' ? 'bg-yellow-500' :
                'bg-gray-500'
              }`}></div>
              <span className="hidden sm:inline text-xs font-medium ${
                priceSource === 'metaapi' ? 'text-blue-400' :
                priceSource === 'database' ? 'text-yellow-400' :
                'text-gray-400'
              }">
                {priceSource === 'metaapi' ? 'Live' : priceSource === 'database' ? 'Delayed' : 'Offline'}
              </span>
            </div>
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

        {!isLoading && !error && (vwapValue || ema20Value || ema50Value || ema200Value) && (
          <div className="absolute top-2 left-1/2 transform -translate-x-1/2 z-20 bg-gray-900/80 backdrop-blur-sm px-4 py-2 rounded-lg border border-gray-700 shadow-lg">
            <div className="flex items-center gap-4 text-xs font-medium">
              {vwapValue && (
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                  <span className="text-gray-400">VWAP</span>
                </div>
              )}
              {ema20Value && (
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                  <span className="text-gray-400">EMA 20</span>
                </div>
              )}
              {ema50Value && (
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                  <span className="text-gray-400">EMA 50</span>
                </div>
              )}
              {ema200Value && (
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-red-500"></div>
                  <span className="text-gray-400">EMA 200</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="relative">
          <div ref={chartContainerRef} className="rounded-lg overflow-hidden" />

          {/* Market Closed Overlay */}
          {!forexMarketStatus.isOpen && (
            <div className="absolute inset-0 bg-gray-900/80 backdrop-blur-sm flex items-center justify-center z-10 pointer-events-none rounded-lg">
              <div className="bg-red-900/40 border border-red-500/50 rounded-xl px-8 py-6 text-center">
                <Clock className="w-12 h-12 text-red-400 mx-auto mb-3" />
                <h3 className="text-xl font-bold text-white mb-2">Market Closed</h3>
                <p className="text-red-200">
                  {(() => {
                    const timeUntil = getTimeUntilMarketChange();
                    return `Market ${timeUntil.isOpening ? 'opens' : 'closes'} in ${timeUntil.hours}h ${timeUntil.minutes}m`;
                  })()}
                </p>
              </div>
            </div>
          )}
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

      <div className="mt-4">
        <button
          onClick={toggleIndicators}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg border border-gray-700 transition-all mb-4"
        >
          <span className="text-sm font-medium">
            {showIndicators ? 'Hide' : 'Show'} Manual Trading & Technical Indicators
          </span>
          {showIndicators ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>

        <div
          className={`transition-all duration-300 ease-in-out overflow-hidden ${
            showIndicators ? 'max-h-[3000px] opacity-100' : 'max-h-0 opacity-0'
          }`}
        >
          <div className="mb-4">
            <ManualTradePanel
              symbol={symbol}
              onTradeExecuted={onTradeExecuted}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <RSIPanel data={rsiData} />
            <ATRPanel data={atrData} />
            <VolumePanel data={volumeData} />
            <PatternDetectionPanel patterns={patternData} />
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
