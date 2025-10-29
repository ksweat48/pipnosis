import React, { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, IChartApi, ISeriesApi, LineStyle } from 'lightweight-charts';
import { supabase } from '@/lib/supabase';
import { TrendingUp, Activity, AlertCircle } from 'lucide-react';

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

export function MarketChart({ symbol, onSymbolChange, tradeLines }: MarketChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

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
        borderColor: '#374151',
      },
      crosshair: {
        mode: 1,
      },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;

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

  const aggregateToCandles = (prices: RealtimePrice[], intervalMinutes: number = 1): CandlestickData[] => {
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

  useEffect(() => {
    if (!candlestickSeriesRef.current) return;

    const fetchPriceHistory = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const { data, error: dbError } = await supabase
          .from('realtime_prices')
          .select('bid, ask, broker_time, created_at')
          .eq('symbol', symbol)
          .order('created_at', { ascending: true })
          .limit(500);

        if (dbError) {
          console.error('Database error:', dbError);
          setError(`Unable to load price data: ${dbError.message || 'Unknown error'}`);
          setIsLoading(false);
          return;
        }

        if (data && data.length > 0) {
          const candleData = aggregateToCandles(data as RealtimePrice[], 1);

          if (candleData.length > 0) {
            candlestickSeriesRef.current?.setData(candleData);

            const latestCandle = candleData[candleData.length - 1];
            const firstCandle = candleData[0];
            setCurrentPrice(latestCandle.close);
            setPriceChange(((latestCandle.close - firstCandle.open) / firstCandle.open) * 100);
            setLastUpdate(new Date());
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
        console.error('Failed to fetch price history:', err);
        setError('Failed to load chart data');
        setIsLoading(false);
      }
    };

    fetchPriceHistory();

    const subscription = supabase
      .channel(`realtime_prices_${symbol}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'realtime_prices',
          filter: `symbol=eq.${symbol}`,
        },
        (payload) => {
          fetchPriceHistory();
        }
      )
      .subscribe();

    const pollInterval = setInterval(fetchPriceHistory, 10000);

    return () => {
      subscription.unsubscribe();
      clearInterval(pollInterval);
    };
  }, [symbol]);

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

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <TrendingUp className="text-emerald-500" size={24} />
          <select
            value={symbol}
            onChange={(e) => onSymbolChange(e.target.value)}
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

        <div ref={chartContainerRef} className="rounded-lg overflow-hidden" />
      </div>

      {lastUpdate && (
        <div className="text-xs text-white/50 text-right">
          Last updated: {lastUpdate.toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
