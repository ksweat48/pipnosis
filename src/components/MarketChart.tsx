import React, { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, IChartApi, ISeriesApi, LineStyle, LineSeries } from 'lightweight-charts';
import { supabase } from '@/lib/supabase';
import { TrendingUp, Activity, AlertCircle, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { chartPreferencesService, Timeframe, type IndicatorVisibility } from '@/services/chart-preferences';
import {
  fetchCompleteChartData,
  fetchRecentRealtimePrices,
  aggregatePricesToCurrentCandle,
  getTimeframeMinutes,
  CandleData,
  RealtimePrice as RealtimePriceType
} from '@/services/candle-data-service';
import { detectAndBackfillGaps } from '@/services/candle-backfill-service';
import { candlePersistenceService } from '@/services/candle-persistence-service';
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
import { getForexMarketStatus, type MarketStatus } from '@/utils/marketHours';

interface MarketChartProps {
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  tradeLines?: {
    entry?: number;
    stopLoss?: number;
    takeProfit?: number;
  };
}

interface CurrentCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  startTime: number;
}

export function MarketChart({ symbol, onSymbolChange, tradeLines }: MarketChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema50SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema200SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

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

  useEffect(() => {
    const updateMarketStatus = () => {
      setForexMarketStatus(getForexMarketStatus());
    };

    updateMarketStatus();
    const interval = setInterval(updateMarketStatus, 60000);

    return () => clearInterval(interval);
  }, []);

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

  const updateIndicators = (candles: CandleData[]) => {
    if (candles.length === 0) return;

    const vwap = calculateVWAP(candles);
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

  const updateCurrentCandle = (newPrice: number, timestamp: number) => {
    const timestampUtc = new Date(timestamp);
    console.log(`[updateCurrentCandle] Called with price: ${newPrice.toFixed(5)}, timestamp UTC: ${timestampUtc.toISOString()}`);

    if (!candlestickSeriesRef.current) {
      console.warn('[updateCurrentCandle] Candlestick series not ready');
      return;
    }

    const intervalMinutes = getTimeframeMinutes(timeframe);
    const intervalMs = intervalMinutes * 60 * 1000;
    const candleTime = Math.floor(timestamp / intervalMs) * intervalMs;
    const candleTimeSeconds = Math.floor(candleTime / 1000);

    console.log(`[updateCurrentCandle] Candle time: ${new Date(candleTimeSeconds * 1000).toISOString()}`);

    if (historicalCandlesRef.current.length > 0) {
      const lastHistoricalTime = historicalCandlesRef.current[historicalCandlesRef.current.length - 1].time;
      console.log(`[updateCurrentCandle] Last historical time: ${new Date(lastHistoricalTime * 1000).toISOString()}`);
      if (candleTimeSeconds <= lastHistoricalTime) {
        console.warn(`[updateCurrentCandle] Skipping - candle time ${candleTimeSeconds} <= last historical ${lastHistoricalTime}`);
        return;
      }
    }

    if (!currentCandleRef.current || currentCandleRef.current.startTime !== candleTime) {
      if (currentCandleRef.current && historicalCandlesRef.current) {
        const completedCandle: CandleData = {
          time: currentCandleRef.current.time,
          open: currentCandleRef.current.open,
          high: currentCandleRef.current.high,
          low: currentCandleRef.current.low,
          close: currentCandleRef.current.close
        };

        const lastHistoricalTime = historicalCandlesRef.current.length > 0
          ? historicalCandlesRef.current[historicalCandlesRef.current.length - 1].time
          : 0;

        if (completedCandle.time > lastHistoricalTime) {
          historicalCandlesRef.current = [...historicalCandlesRef.current, completedCandle];
          console.log(`[Chart] Candle completed at ${new Date(completedCandle.time * 1000).toISOString()} - Saving to database...`);

          candlePersistenceService.saveCompletedCandle(symbol, timeframe, completedCandle)
            .then(result => {
              if (result.success) {
                console.log(`[Chart] ✓ Candle saved successfully: ${result.candleTime}`);
              } else {
                console.error(`[Chart] ✗ Failed to save candle: ${result.error}`);
              }
            })
            .catch(err => {
              console.error(`[Chart] ✗ Error saving candle:`, err);
            });
        }
      }

      currentCandleRef.current = {
        time: candleTimeSeconds,
        open: newPrice,
        high: newPrice,
        low: newPrice,
        close: newPrice,
        startTime: candleTime
      };
    } else {
      currentCandleRef.current.high = Math.max(currentCandleRef.current.high, newPrice);
      currentCandleRef.current.low = Math.min(currentCandleRef.current.low, newPrice);
      currentCandleRef.current.close = newPrice;
    }

    const updatedCandle: CandleData = {
      time: currentCandleRef.current.time,
      open: currentCandleRef.current.open,
      high: currentCandleRef.current.high,
      low: currentCandleRef.current.low,
      close: currentCandleRef.current.close
    };

    try {
      candlestickSeriesRef.current.update(updatedCandle);

      if (chartRef.current && !userInteractedRef.current) {
        chartRef.current.timeScale().scrollToRealTime();
      }

      updateQueueRef.current.push(newPrice);
      if (updateQueueRef.current.length >= 5) {
        const allCandles = [...historicalCandlesRef.current, updatedCandle];
        updateIndicatorsDebounced(allCandles);
        updateQueueRef.current = [];
      }

      setCurrentPrice(newPrice);
      setLastUpdate(new Date());
      setIsLive(true);
      setUpdateCount(prev => prev + 1);

      setPriceUpdateFlash(true);
      setTimeout(() => setPriceUpdateFlash(false), 300);

      console.log(`[Chart Update] ${symbol} - Price: ${newPrice.toFixed(5)}, Time: ${new Date(timestamp).toISOString()}`);
      setDebugInfo(`Candle Time: ${new Date(currentCandleRef.current.time * 1000).toLocaleTimeString()}, Updates: ${updateCount + 1}`);
    } catch (chartError) {
      console.error('Chart update error:', chartError);
    }
  };

  const fetchNewPrices = async () => {
    try {
      const intervalMinutes = getTimeframeMinutes(timeframe);
      const lookbackMinutes = Math.max(intervalMinutes * 2, 5);
      const recentPrices = await fetchRecentRealtimePrices(symbol, lookbackMinutes);

      console.log(`[Price Fetch] ${symbol} - Fetched ${recentPrices.length} prices from last ${lookbackMinutes} minutes`);

      if (recentPrices.length > 0) {
        let newPrices = recentPrices;

        if (lastFetchTimeRef.current) {
          newPrices = recentPrices.filter(p => p.created_at > lastFetchTimeRef.current!);
          console.log(`[Price Fetch] ${symbol} - Filtered to ${newPrices.length} new prices since ${new Date(lastFetchTimeRef.current).toLocaleTimeString()}`);
        }

        if (newPrices.length > 0) {
          const latestPrice = newPrices[newPrices.length - 1];
          const bid = parseFloat(latestPrice.bid);
          const ask = parseFloat(latestPrice.ask);

          if (!isNaN(bid) && !isNaN(ask) && bid > 0 && ask > 0) {
            const midPrice = (bid + ask) / 2;
            const timestampUtc = new Date(latestPrice.broker_time || latestPrice.created_at).getTime();

            console.log(`[Price Fetch] ${symbol} - ✓ Updating chart with price: ${midPrice.toFixed(5)} at ${new Date(timestampUtc).toISOString()}`);
            console.log(`[Price Fetch] ${symbol} - Bid: ${bid.toFixed(5)}, Ask: ${ask.toFixed(5)}, Spread: ${(ask - bid).toFixed(5)}`);

            updateCurrentCandle(midPrice, timestampUtc);
            lastFetchTimeRef.current = latestPrice.created_at;
            setError(null);
          } else {
            console.warn(`[Price Fetch] ${symbol} - Invalid price values: bid=${bid}, ask=${ask}`);
          }
        } else {
          console.log(`[Price Fetch] ${symbol} - No NEW prices since last fetch`);
        }
      } else {
        console.warn(`[Price Fetch] ${symbol} - No prices found in database for last ${lookbackMinutes} minutes`);
      }
    } catch (err) {
      console.error(`[Price Fetch] ${symbol} - Error:`, err);
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

      if (candlestickSeriesRef.current) {
        candlestickSeriesRef.current.setData(backfilledCandles);
      }

      if (chartData.current) {
        const lastHistoricalTime = uniqueHistorical.length > 0
          ? uniqueHistorical[uniqueHistorical.length - 1].time
          : 0;

        if (chartData.current.time > lastHistoricalTime) {
          currentCandleRef.current = {
            ...chartData.current,
            startTime: chartData.current.time * 1000
          };
          candlestickSeriesRef.current?.update(chartData.current);
        }
      }

      const allCandles = currentCandleRef.current
        ? [...uniqueHistorical, currentCandleRef.current]
        : uniqueHistorical;

      if (allCandles.length > 0) {
        const lastCandle = allCandles[allCandles.length - 1];
        const firstCandle = allCandles[0];

        setCurrentPrice(lastCandle.close);
        setPriceChange(((lastCandle.close - firstCandle.open) / firstCandle.open) * 100);
        setLastUpdate(new Date());

        console.log(`[Chart Init] ${symbol} - Loaded ${uniqueHistorical.length} historical candles, Current: ${currentCandleRef.current ? 'Yes' : 'No'}`);
        console.log(`[Chart Init] Latest candle time: ${new Date(lastCandle.time * 1000).toLocaleString()}`);

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

    initializeChart();

    console.log(`[Chart Subscription] Setting up real-time subscription for ${symbol}...`);

    const subscription = supabase
      .channel(`realtime_prices_chart_${symbol}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'realtime_prices',
          filter: `symbol=eq.${symbol}`,
        },
        (payload) => {
          console.log(`[Chart Subscription] ${symbol} - INSERT event received:`, payload);
          fetchNewPrices();
        }
      )
      .subscribe((status) => {
        console.log(`[Chart Subscription] ${symbol} - Subscription status:`, status);
      });

    console.log(`[Chart Polling] Starting 5-second polling interval for ${symbol}`);
    const pollInterval = setInterval(fetchNewPrices, 5000);

    return () => {
      subscription.unsubscribe();
      clearInterval(pollInterval);

      candlePersistenceService.flushPending(symbol, timeframe);
    };
  }, [symbol, timeframe]);

  useEffect(() => {
    if (historicalCandlesRef.current.length > 0) {
      const allCandles = currentCandleRef.current
        ? [...historicalCandlesRef.current, currentCandleRef.current]
        : historicalCandlesRef.current;
      updateIndicators(allCandles);
    }
  }, [indicatorVisibility]);

  useEffect(() => {
    if (!chartRef.current || !tradeLines) return;

    const { entry, stopLoss, takeProfit } = tradeLines;

    if (entry) {
      candlestickSeriesRef.current?.createPriceLine({
        price: entry,
        color: '#3b82f6',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Entry',
      });
    }

    if (stopLoss) {
      candlestickSeriesRef.current?.createPriceLine({
        price: stopLoss,
        color: '#ef4444',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Stop Loss',
      });
    }

    if (takeProfit) {
      candlestickSeriesRef.current?.createPriceLine({
        price: takeProfit,
        color: '#10b981',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Take Profit',
      });
    }
  }, [tradeLines]);

  const FOREX_PAIRS = [
    'XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF',
    'AUDUSD', 'USDCAD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY'
  ];

  const TIMEFRAMES: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'D1', 'W1'];

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
    <div className="space-y-4">
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
                <div className={`px-3 py-1 rounded-lg text-sm font-semibold ${
                  forexMarketStatus.isOpen
                    ? 'bg-green-500/20 text-green-400 border border-green-500/50'
                    : 'bg-red-500/20 text-red-400 border border-red-500/50'
                }`}>
                  {forexMarketStatus.status}
                </div>
                <div className={`text-sm flex items-center gap-1 ${
                  priceChange >= 0 ? 'text-emerald-500' : 'text-red-500'
                }`}>
                  <Activity size={14} />
                  {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
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
            <div className={`px-2.5 py-0.5 rounded-lg text-xs font-semibold ${
              forexMarketStatus.isOpen
                ? 'bg-green-500/20 text-green-400 border border-green-500/50'
                : 'bg-red-500/20 text-red-400 border border-red-500/50'
            }`}>
              {forexMarketStatus.status}
            </div>
            <div className={`text-sm flex items-center gap-1 ${
              priceChange >= 0 ? 'text-emerald-500' : 'text-red-500'
            }`}>
              <Activity size={12} />
              {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
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
            {showIndicators ? 'Hide' : 'Show'} Technical Indicators
          </span>
          {showIndicators ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>

        <div
          className={`transition-all duration-300 ease-in-out overflow-hidden ${
            showIndicators ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
          }`}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <RSIPanel data={rsiData} />
            <ATRPanel data={atrData} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
            <VolumePanel data={volumeData} />
            <PatternDetectionPanel patterns={patternData} />
          </div>
        </div>
      </div>
    </div>
  );
}
