import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, LineStyle } from 'lightweight-charts';
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

interface PriceData {
  time: number;
  value: number;
}

export function MarketChart({ symbol, onSymbolChange, tradeLines }: MarketChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
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
        secondsVisible: true,
      },
      rightPriceScale: {
        borderColor: '#374151',
      },
      crosshair: {
        mode: 1,
      },
    });

    const lineSeries = chart.addLineSeries({
      color: '#10b981',
      lineWidth: 2,
      priceLineVisible: true,
      lastValueVisible: true,
    });

    chartRef.current = chart;
    lineSeriesRef.current = lineSeries;

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

  useEffect(() => {
    if (!lineSeriesRef.current) return;

    const fetchPriceHistory = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const { data, error: dbError } = await supabase
          .from('realtime_prices')
          .select('bid, ask, broker_time, created_at')
          .eq('symbol', symbol)
          .order('created_at', { ascending: true })
          .limit(100);

        if (dbError) {
          console.error('Database error:', dbError);
          setError('Unable to load price data');
          setIsLoading(false);
          return;
        }

        if (data && data.length > 0) {
          const priceData: PriceData[] = data.map((item) => ({
            time: Math.floor(new Date(item.broker_time || item.created_at).getTime() / 1000),
            value: (parseFloat(item.bid) + parseFloat(item.ask)) / 2,
          }));

          lineSeriesRef.current?.setData(priceData);

          const latestPrice = priceData[priceData.length - 1].value;
          const firstPrice = priceData[0].value;
          setCurrentPrice(latestPrice);
          setPriceChange(((latestPrice - firstPrice) / firstPrice) * 100);
          setLastUpdate(new Date());
        } else {
          setError('No price data available for this symbol');
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
          const newData = payload.new as any;
          const midPrice = (parseFloat(newData.bid) + parseFloat(newData.ask)) / 2;
          const timestamp = Math.floor(new Date(newData.broker_time || newData.created_at).getTime() / 1000);

          lineSeriesRef.current?.update({
            time: timestamp,
            value: midPrice,
          });

          setCurrentPrice(midPrice);
          setLastUpdate(new Date());
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
      lineSeriesRef.current?.createPriceLine({
        price: entry,
        color: '#3b82f6',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Entry',
      });
    }

    if (stopLoss) {
      lineSeriesRef.current?.createPriceLine({
        price: stopLoss,
        color: '#ef4444',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Stop Loss',
      });
    }

    if (takeProfit) {
      lineSeriesRef.current?.createPriceLine({
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
