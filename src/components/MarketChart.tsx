import React, { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, IChartApi, ISeriesApi, LineStyle, LineSeries } from 'lightweight-charts';
import { supabase } from '@/lib/supabase';
import { TrendingUp, Activity, AlertCircle, Clock } from 'lucide-react';
import { chartPreferencesService, Timeframe } from '@/services/chart-preferences';
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

interface MarketChartProps {
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  tradeLines?: {
    entry?: number;
    stopLoss?: number;
    takeProfit?: number;
  };
}

interface CandlestickData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface RealtimePrice {
  bid: string;
  ask: string;
  broker_time: string;
  created_at: string;
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
  const [timeframe, setTimeframe] = useState<Timeframe>(() => chartPreferencesService.getTimeframe(symbol));
  const [isLive, setIsLive] = useState(false);

  const [rsiData, setRsiData] = useState<IndicatorResult[]>([]);
  const [atrData, setAtrData] = useState<IndicatorResult[]>([]);
  const [volumeData, setVolumeData] = useState<VolumeData[]>([]);
  const [patternData, setPatternData] = useState<PatternDetection[]>([]);

  const [vwapValue, setVwapValue] = useState<number | null>(null);
  const [ema20Value, setEma20Value] = useState<number | null>(null);
  const [ema50Value, setEma50Value] = useState<number | null>(null);
  const [ema200Value, setEma200Value] = useState<number | null>(null);

  const currentCandleRef = useRef<CurrentCandle | null>(null);
  const lastFetchTimeRef = useRef<string | null>(null);
  const historicalCandlesRef = useRef<CandlestickData[]>([]);

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

  const aggregateToCandles = (prices: RealtimePrice[], intervalMinutes: number): CandlestickData[] => {
    if (prices.length === 0) return [];

    const candleMap = new Map<number, { open: number; high: number; low: number; close: number; prices: number[] }>();

    prices.forEach((price) => {
      const bid = parseFloat(price.bid);
      const ask = parseFloat(price.ask);

      if (isNaN(bid) || isNaN(ask) || bid <= 0 || ask <= 0) {
        return;
      }

      const midPrice = (bid + ask) / 2;
      const timestamp = new Date(price.broker_time || price.created_at).getTime();
      const candleTime = Math.floor(timestamp / (intervalMinutes * 60 * 1000)) * (intervalMinutes * 60);

      if (!candleMap.has(candleTime)) {
        candleMap.set(candleTime, {
          open: midPrice,
          high: midPrice,
          low: midPrice,
          close: midPrice,
          prices: [midPrice],
        });
      } else {
        const candle = candleMap.get(candleTime)!;
        candle.high = Math.max(candle.high, midPrice);
        candle.low = Math.min(candle.low, midPrice);
        candle.close = midPrice;
        candle.prices.push(midPrice);
      }
    });

    const candles: CandlestickData[] = Array.from(candleMap.entries())
      .map(([time, data]) => ({
        time: time / 1000,
        open: data.open,
        high: data.high,
        low: data.low,
        close: data.close,
      }))
      .sort((a, b) => a.time - b.time);

    return candles;
  };

  const updateIndicators = (candles: CandlestickData[]) => {
    if (candles.length === 0) return;

    const vwap = calculateVWAP(candles);
    const ema20 = calculateEMA(candles, 20);
    const ema50 = calculateEMA(candles, 50);
    const ema200 = calculateEMA(candles, 200);
    const rsi = calculateRSI(candles, 14);
    const atr = calculateATR(candles, 14);
    const volume = calculateVolumeMetrics(candles);
    const patterns = detectCandlePatterns(candles, vwap);

    if (vwapSeriesRef.current && vwap.length > 0) {
      vwapSeriesRef.current.setData(vwap);
      setVwapValue(vwap[vwap.length - 1].value);
    }
    if (ema20SeriesRef.current && ema20.length > 0) {
      ema20SeriesRef.current.setData(ema20);
      setEma20Value(ema20[ema20.length - 1].value);
    }
    if (ema50SeriesRef.current && ema50.length > 0) {
      ema50SeriesRef.current.setData(ema50);
      setEma50Value(ema50[ema50.length - 1].value);
    }
    if (ema200SeriesRef.current && ema200.length > 0) {
      ema200SeriesRef.current.setData(ema200);
      setEma200Value(ema200[ema200.length - 1].value);
    }

    setRsiData(rsi);
    setAtrData(atr);
    setVolumeData(volume);
    setPatternData(patterns);
  };

  const updateCurrentCandle = (newPrice: number, timestamp: number) => {
    if (!candlestickSeriesRef.current) return;

    const intervalMinutes = chartPreferencesService.getTimeframeMinutes(timeframe);
    const candleTime = Math.floor(timestamp / (intervalMinutes * 60 * 1000)) * (intervalMinutes * 60);

    if (!currentCandleRef.current || currentCandleRef.current.startTime !== candleTime) {
      if (currentCandleRef.current && historicalCandlesRef.current) {
        historicalCandlesRef.current = [...historicalCandlesRef.current, {
          time: currentCandleRef.current.time,
          open: currentCandleRef.current.open,
          high: currentCandleRef.current.high,
          low: currentCandleRef.current.low,
          close: currentCandleRef.current.close
        }];
      }

      currentCandleRef.current = {
        time: candleTime / 1000,
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

    const updatedCandle: CandlestickData = {
      time: currentCandleRef.current.time,
      open: currentCandleRef.current.open,
      high: currentCandleRef.current.high,
      low: currentCandleRef.current.low,
      close: currentCandleRef.current.close
    };

    candlestickSeriesRef.current.update(updatedCandle);

    const allCandles = [...historicalCandlesRef.current, updatedCandle];
    updateIndicators(allCandles);

    setCurrentPrice(newPrice);
    setLastUpdate(new Date());
    setIsLive(true);
  };

  const fetchNewPrices = async () => {
    try {
      let query = supabase
        .from('realtime_prices')
        .select('bid, ask, broker_time, created_at')
        .eq('symbol', symbol)
        .order('created_at', { ascending: true });

      if (lastFetchTimeRef.current) {
        query = query.gt('created_at', lastFetchTimeRef.current);
      } else {
        const dataLimit = chartPreferencesService.getDataLimit(timeframe);
        query = query.limit(dataLimit);
      }

      const { data, error: dbError } = await query;

      if (dbError) {
        console.error('Database error:', dbError);
        return;
      }

      if (data && data.length > 0) {
        data.forEach((price: RealtimePrice) => {
          const bid = parseFloat(price.bid);
          const ask = parseFloat(price.ask);

          if (!isNaN(bid) && !isNaN(ask) && bid > 0 && ask > 0) {
            const midPrice = (bid + ask) / 2;
            const timestamp = new Date(price.broker_time || price.created_at).getTime();
            updateCurrentCandle(midPrice, timestamp);
          }
        });

        lastFetchTimeRef.current = data[data.length - 1].created_at;
        setError(null);
      }
    } catch (err) {
      console.error('Failed to fetch new prices:', err);
    }
  };

  const initializeChart = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const dataLimit = chartPreferencesService.getDataLimit(timeframe);
      const { data, error: dbError } = await supabase
        .from('realtime_prices')
        .select('bid, ask, broker_time, created_at')
        .eq('symbol', symbol)
        .order('created_at', { ascending: true })
        .limit(dataLimit);

      if (dbError) {
        console.error('Database error:', dbError);
        setError(`Unable to load price data: ${dbError.message || 'Unknown error'}`);
        setIsLoading(false);
        return;
      }

      if (data && data.length > 0) {
        const intervalMinutes = chartPreferencesService.getTimeframeMinutes(timeframe);
        const candleData = aggregateToCandles(data as RealtimePrice[], intervalMinutes);

        if (candleData.length > 0) {
          historicalCandlesRef.current = candleData.slice(0, -1);

          candlestickSeriesRef.current?.setData(historicalCandlesRef.current);

          const lastCandle = candleData[candleData.length - 1];
          const latestPrice = data[data.length - 1];
          const timestamp = new Date(latestPrice.broker_time || latestPrice.created_at).getTime();

          currentCandleRef.current = {
            ...lastCandle,
            startTime: lastCandle.time * 1000
          };

          candlestickSeriesRef.current?.update(lastCandle);

          updateIndicators(candleData);

          const firstCandle = candleData[0];
          setCurrentPrice(lastCandle.close);
          setPriceChange(((lastCandle.close - firstCandle.open) / firstCandle.open) * 100);
          setLastUpdate(new Date());

          lastFetchTimeRef.current = data[data.length - 1].created_at;
        } else {
          console.warn('No valid candle data after aggregation');
          setError('Waiting for price data... The price feed will start shortly.');
        }
      } else {
        console.warn('No price data found for symbol:', symbol);
        setError('Waiting for price data... The price feed will start shortly.');
      }

      setIsLoading(false);
    } catch (err) {
      console.error('Failed to initialize chart:', err);
      setError('Failed to load chart data');
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!candlestickSeriesRef.current) return;

    currentCandleRef.current = null;
    lastFetchTimeRef.current = null;
    historicalCandlesRef.current = [];

    initializeChart();

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
        () => {
          fetchNewPrices();
        }
      )
      .subscribe();

    const pollInterval = setInterval(fetchNewPrices, 5000);

    return () => {
      subscription.unsubscribe();
      clearInterval(pollInterval);
    };
  }, [symbol, timeframe]);

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
    'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD',
    'USDCAD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY'
  ];

  const TIMEFRAMES: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'D1', 'W1'];

  const handleTimeframeChange = (newTimeframe: Timeframe) => {
    setTimeframe(newTimeframe);
    chartPreferencesService.setTimeframe(symbol, newTimeframe);
  };

  const handleSymbolChangeInternal = (newSymbol: string) => {
    const savedTimeframe = chartPreferencesService.getTimeframe(newSymbol);
    setTimeframe(savedTimeframe);
    onSymbolChange(newSymbol);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <TrendingUp className="text-emerald-500" size={24} />
            <select
              value={symbol}
              onChange={(e) => handleSymbolChangeInternal(e.target.value)}
              className="bg-gray-800 text-white px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
            >
              {FOREX_PAIRS.map(pair => (
                <option key={pair} value={pair}>{pair}</option>
              ))}
            </select>
          </div>

          {currentPrice && (
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-2xl font-bold text-white">
                  {currentPrice.toFixed(5)}
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

        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          <Clock className="text-gray-500 w-4 h-4 flex-shrink-0" />
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => handleTimeframeChange(tf)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-all flex-shrink-0 ${
                timeframe === tf
                  ? 'bg-emerald-600 text-white shadow-lg'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white border border-gray-700'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
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
                  <span className="text-blue-400">{vwapValue.toFixed(5)}</span>
                </div>
              )}
              {ema20Value && (
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                  <span className="text-gray-400">EMA 20</span>
                  <span className="text-emerald-400">{ema20Value.toFixed(5)}</span>
                </div>
              )}
              {ema50Value && (
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                  <span className="text-gray-400">EMA 50</span>
                  <span className="text-amber-400">{ema50Value.toFixed(5)}</span>
                </div>
              )}
              {ema200Value && (
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-red-500"></div>
                  <span className="text-gray-400">EMA 200</span>
                  <span className="text-red-400">{ema200Value.toFixed(5)}</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={chartContainerRef} className="rounded-lg overflow-hidden" />
      </div>

      <div className="flex items-center justify-between text-xs">
        {lastUpdate && (
          <div className="text-white/50">
            Last updated: {lastUpdate.toLocaleTimeString()}
          </div>
        )}
        {isLive && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
            <span className="text-emerald-500 font-medium">Market Data: Live</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <RSIPanel data={rsiData} />
        <ATRPanel data={atrData} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <VolumePanel data={volumeData} />
        <PatternDetectionPanel patterns={patternData} />
      </div>
    </div>
  );
}
