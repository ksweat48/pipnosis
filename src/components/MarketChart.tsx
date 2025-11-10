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
  CandleData,
  RealtimePrice as RealtimePriceType
} from '@/services/candle-data-service';
import { detectAndBackfillGaps } from '@/services/candle-backfill-service';
import { candlePersistenceService } from '@/services/candle-persistence-service';
import { chartCandlePoller } from '@/services/chart-candle-poller';
import { backgroundCandleAggregator } from '@/services/background-candle-aggregator';
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
import { getForexMarketStatus, type MarketStatus } from '@/utils/marketHours';

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
    return saved !== null ? saved === 'true' : true;
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
    const updateMarketStatus = () => {
      setForexMarketStatus(getForexMarketStatus());
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
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#1f2937' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: '#374151' },
        horzLines: { color: '#374151' },
      },
      width: chartContainerRef.current.clientWidth,
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
    if (tick.symbol !== symbol || !candlestickSeriesRef.current) {
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

      if (candleTimeSeconds <= lastHistoricalTime) {
        // Silently ignore old ticks from initialization
        return;
      }

      // Also reject if this tick would create a candle older than our current forming candle
      if (currentCandleRef.current && candleTimeSeconds < currentCandleRef.current.time) {
        // This is an old tick, ignore it
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
        candlestickSeriesRef.current?.update({
          time: currentCandleRef.current.time,
          open: currentCandleRef.current.open,
          high: currentCandleRef.current.high,
          low: currentCandleRef.current.low,
          close: currentCandleRef.current.close
        });

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
    if (!candlestickSeriesRef.current) {
      return;
    }

    const lastHistoricalTime = historicalCandlesRef.current.length > 0
      ? historicalCandlesRef.current[historicalCandlesRef.current.length - 1].time
      : 0;

    if (latestCandle.time <= lastHistoricalTime) {
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

      currentCandleRef.current = null;
    }

    try {
      candlestickSeriesRef.current.update(latestCandle);

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


  const initializeChart = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const dataLimit = chartPreferencesService.getDataLimit(timeframe);
      const chartData = await fetchCompleteChartData(symbol, timeframe, dataLimit);

      if (chartData.historical.length === 0 && !chartData.current) {
        console.warn('No candle data found for symbol:', symbol);
        setError('Waiting for price data... The price feed will start shortly.');
        setIsLoading(false);
        return;
      }

      const sortedHistorical = [...chartData.historical].sort((a, b) => a.time - b.time);
      const uniqueHistorical = sortedHistorical.filter((candle, index, array) => {
        if (index === 0) return true;
        return candle.time > array[index - 1].time;
      });

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

      historicalCandlesRef.current = backfilledCandles;

      if (backfilledCandles.length > 0) {
        const firstCandle = backfilledCandles[0];
        const lastCandle = backfilledCandles[backfilledCandles.length - 1];
        console.log(`[Chart Init] Historical range: ${new Date(firstCandle.time * 1000).toISOString()} to ${new Date(lastCandle.time * 1000).toISOString()}`);
        console.log(`[Chart Init] Total span: ${((lastCandle.time - firstCandle.time) / 3600).toFixed(1)} hours`);
      }

      if (candlestickSeriesRef.current) {
        candlestickSeriesRef.current.setData(backfilledCandles);
      }

      if (chartData.current) {
        const lastHistoricalTime = backfilledCandles.length > 0
          ? backfilledCandles[backfilledCandles.length - 1].time
          : 0;

        console.log(`[Chart Init] Current candle time: ${new Date(chartData.current.time * 1000).toISOString()}`);
        console.log(`[Chart Init] Last historical time: ${new Date(lastHistoricalTime * 1000).toISOString()}`);

        if (chartData.current.time > lastHistoricalTime) {
          const timeDiff = chartData.current.time - lastHistoricalTime;
          const expectedInterval = getTimeframeMinutes(timeframe) * 60;

          if (timeDiff === expectedInterval) {
            console.log(`[Chart Init] ✓ PERFECT: Current candle follows historical with exact ${timeframe} interval`);
          } else if (timeDiff > expectedInterval) {
            console.warn(`[Chart Init] ⚠ GAP: ${timeDiff / 60} minutes between last historical and current (expected ${expectedInterval / 60})`);
          }

          currentCandleRef.current = {
            ...chartData.current,
            startTime: chartData.current.time * 1000
          };
          candlestickSeriesRef.current?.update(chartData.current);
        } else if (chartData.current.time === lastHistoricalTime) {
          console.warn(`[Chart Init] ⚠ Current candle matches last historical - this should not happen with proper filtering`);
        } else {
          console.error(`[Chart Init] ✗ ERROR: Current candle is older than last historical - data integrity issue`);
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

      setIsLoading(false);
    } catch (err) {
      console.error('Failed to initialize chart:', err);
      setError('Failed to load chart data');
      setIsLoading(false);
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
    if (!candlestickSeriesRef.current) return;

    currentCandleRef.current = null;
    lastFetchTimeRef.current = null;
    historicalCandlesRef.current = [];
    liveTickStreamActive.current = false;

    initializeChart();

    console.log(`[Chart] 🚀 Starting hybrid mode: Live ticks + DB polling for ${symbol} ${timeframe}`);
    setSystemStatus('connecting');

    // Start live tick stream from BackgroundAggregator
    console.log(`[Chart] 📡 Subscribing to live tick stream...`);
    const unsubscribeTicks = backgroundCandleAggregator.onTickUpdate((tick) => {
      updateCurrentCandleFromTick(tick);
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
      console.log(`[Chart] 🛑 Stopping hybrid mode for ${symbol} ${timeframe}`);
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
          </div>

          {/* Desktop: Price on the right side */}
          {currentPrice && (
            <div className="hidden sm:flex items-center gap-4">
              <div className="flex items-center gap-3">
                <div className={`text-2xl font-bold text-white transition-all duration-300 ${
                  priceUpdateFlash ? 'scale-110 text-emerald-400' : ''
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
            <div className={`text-lg font-bold text-white transition-all duration-300 ${
              priceUpdateFlash ? 'scale-110 text-emerald-400' : ''
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
          <div className="absolute inset-0 bg-gray-800/50 rounded-lg flex items-center justify-center z-10">
            <div className="text-center">
              <div className="animate-spin h-8 w-8 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full mx-auto mb-2"></div>
              <p className="text-white/70 text-sm">Loading chart data...</p>
            </div>
          </div>
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

        <div ref={chartContainerRef} className="rounded-lg overflow-hidden" />
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
    </div>
  );
}
