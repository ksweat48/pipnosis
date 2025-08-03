import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, LineStyle, ColorType } from 'lightweight-charts';
import { TrendingUp, BarChart3, RefreshCw, Settings } from 'lucide-react';

interface MarketChartProps {
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  tradeLines?: {
    entry?: number;
    stopLoss?: number;
    takeProfit?: number;
  };
  className?: string;
}

interface CandlestickData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export const MarketChart: React.FC<MarketChartProps> = ({
  symbol,
  onSymbolChange,
  tradeLines,
  className = ""
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const entryLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const slLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const tpLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Top 3 pairs as per Immutable Laws
  const availablePairs = ['EURUSD', 'GBPUSD', 'XAUUSD'];

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 500,
      layout: {
        background: { type: ColorType.Solid, color: '#0f172a' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: '#334155',
        scaleMargins: {
          top: 0.1,
          bottom: 0.2,
        },
      },
      timeScale: {
        borderColor: '#334155',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
      },
    });

    // Create candlestick series
    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderDownColor: '#ef4444',
      borderUpColor: '#10b981',
      wickDownColor: '#ef4444',
      wickUpColor: '#10b981',
      priceLineVisible: false,
    });

    // Create volume series
    const volumeSeries = chart.addHistogramSeries({
      color: '#64748b',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '',
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;
    volumeSeriesRef.current = volumeSeries;

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chart) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chart) {
        chart.remove();
      }
    };
  }, []);

  // Generate mock OHLCV data for demonstration
  const generateMockData = (symbol: string): CandlestickData[] => {
    const data: CandlestickData[] = [];
    const now = new Date();
    const isJPY = symbol.includes('JPY');
    const isGold = symbol === 'XAUUSD';
    
    let basePrice = symbol === 'XAUUSD' ? 2045 : 
                   symbol === 'GBPUSD' ? 1.2735 : 1.1425; // EURUSD default
    
    // Generate 200 candles (about 8 hours of M15 data for better chart)
    for (let i = 199; i >= 0; i--) {
      const time = new Date(now.getTime() - i * 15 * 60 * 1000); // 15-minute intervals
      
      // Generate realistic price movement
      const volatility = isGold ? 8 : symbol === 'GBPUSD' ? 0.003 : 0.002;
      const change = (Math.random() - 0.5) * volatility;
      
      const open = basePrice;
      const close = basePrice + change;
      const high = Math.max(open, close) + Math.random() * volatility * 0.3;
      const low = Math.min(open, close) - Math.random() * volatility * 0.3;
      const volume = Math.floor(Math.random() * 1000) + 100;
      
      data.push({
        time: time.toISOString().split('T')[0] + ' ' + time.toTimeString().split(' ')[0].substring(0, 5),
        open: parseFloat(open.toFixed(isGold ? 2 : 5)),
        high: parseFloat(high.toFixed(isGold ? 2 : 5)),
        low: parseFloat(low.toFixed(isGold ? 2 : 5)),
        close: parseFloat(close.toFixed(isGold ? 2 : 5)),
        volume
      });
      
      basePrice = close; // Next candle starts where this one ended
    }
    
    return data;
  };

  // Load chart data
  useEffect(() => {
    if (!candlestickSeriesRef.current || !volumeSeriesRef.current) return;

    setIsLoading(true);
    setError(null);

    try {
      // Generate mock data for the selected symbol
      const chartData = generateMockData(symbol);
      
      // Set candlestick data
      candlestickSeriesRef.current.setData(chartData);
      
      // Set volume data
      const volumeData = chartData.map(candle => ({
        time: candle.time,
        value: candle.volume || 0,
        color: candle.close >= candle.open ? '#10b981' : '#ef4444'
      }));
      
      volumeSeriesRef.current.setData(volumeData);
      
      setLastUpdate(new Date());
      setIsLoading(false);
      
      console.log(`📈 Chart loaded for ${symbol} with ${chartData.length} candles`);
    } catch (err) {
      console.error('Error loading chart data:', err);
      setError('Failed to load chart data');
      setIsLoading(false);
    }
  }, [symbol]);

  // Update trade lines overlay
  useEffect(() => {
    if (!chartRef.current || !tradeLines) return;

    // Remove existing trade lines
    if (entryLineRef.current) {
      chartRef.current.removeSeries(entryLineRef.current);
      entryLineRef.current = null;
    }
    if (slLineRef.current) {
      chartRef.current.removeSeries(slLineRef.current);
      slLineRef.current = null;
    }
    if (tpLineRef.current) {
      chartRef.current.removeSeries(tpLineRef.current);
      tpLineRef.current = null;
    }

    // Add entry line
    if (tradeLines.entry) {
      const entryLine = chartRef.current.addLineSeries({
        color: '#3b82f6',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        title: 'Entry',
        priceLineVisible: false,
      });
      
      const now = new Date();
      entryLine.setData([
        { time: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0], value: tradeLines.entry },
        { time: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0], value: tradeLines.entry }
      ]);
      
      entryLineRef.current = entryLine;
    }

    // Add stop loss line
    if (tradeLines.stopLoss) {
      const slLine = chartRef.current.addLineSeries({
        color: '#ef4444',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        title: 'Stop Loss',
        priceLineVisible: false,
      });
      
      const now = new Date();
      slLine.setData([
        { time: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0], value: tradeLines.stopLoss },
        { time: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0], value: tradeLines.stopLoss }
      ]);
      
      slLineRef.current = slLine;
    }

    // Add take profit line
    if (tradeLines.takeProfit) {
      const tpLine = chartRef.current.addLineSeries({
        color: '#10b981',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        title: 'Take Profit',
        priceLineVisible: false,
      });
      
      const now = new Date();
      tpLine.setData([
        { time: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0], value: tradeLines.takeProfit },
        { time: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0], value: tradeLines.takeProfit }
      ]);
      
      tpLineRef.current = tpLine;
    }
  }, [tradeLines]);

  // Auto-refresh chart data every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isLoading && candlestickSeriesRef.current) {
        // Add new candle to simulate real-time updates
        const lastData = generateMockData(symbol).slice(-1)[0];
        if (lastData) {
          const now = new Date();
          const newCandle = {
            ...lastData,
            time: now.toISOString().split('T')[0] + ' ' + now.toTimeString().split(' ')[0].substring(0, 5)
          };
          
          candlestickSeriesRef.current.update(newCandle);
          setLastUpdate(new Date());
        }
      }
    }, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, [symbol, isLoading]);

  return (
    <div className={`bg-slate-800 rounded-xl border border-slate-700 ${className}`}>
      {/* Chart Header */}
      <div className="p-4 sm:p-6 border-b border-slate-700 bg-gradient-to-r from-slate-800 to-slate-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <BarChart3 className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Live Market Chart</h3>
              <p className="text-sm text-slate-400">Real-time price action with AI trade levels</p>
            </div>
            {isLoading && <RefreshCw className="h-4 w-4 text-blue-400 animate-spin" />}
          </div>
          
          <div className="flex items-center space-x-3">
            {/* Symbol Selector */}
            <select
              value={symbol}
              onChange={(e) => onSymbolChange(e.target.value)}
              className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {availablePairs.map(pair => (
                <option key={pair} value={pair}>{pair}</option>
              ))}
            </select>
            
            <div className="text-xs text-slate-400 text-right">
              <div>M15 Timeframe</div>
              <div>{lastUpdate ? `${lastUpdate.toLocaleTimeString()}` : 'Loading...'}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Chart Container */}
      <div className="relative">
        {isLoading && (
          <div className="absolute inset-0 bg-slate-800/50 flex items-center justify-center z-10">
            <div className="text-center">
              <RefreshCw className="h-8 w-8 text-blue-400 animate-spin mx-auto mb-2" />
              <p className="text-slate-400 text-sm">Loading {symbol} chart...</p>
            </div>
          </div>
        )}
        
        {error && (
          <div className="absolute inset-0 bg-slate-800/50 flex items-center justify-center z-10">
            <div className="text-center">
              <BarChart3 className="h-8 w-8 text-red-400 mx-auto mb-2" />
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          </div>
        )}
        
        <div 
          ref={chartContainerRef} 
          className="w-full"
          style={{ height: '500px' }}
        />
      </div>

      {/* Trade Lines Legend */}
      {tradeLines && (Object.keys(tradeLines).length > 0) && (
        <div className="p-4 sm:p-6 border-t border-slate-700 bg-slate-900/50">
          <div className="flex flex-col space-y-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
            <h4 className="text-sm font-medium text-white">AI Trade Levels</h4>
            <div className="flex flex-wrap items-center gap-4 text-xs">
              {tradeLines.entry && (
                <div className="flex items-center space-x-1">
                  <div className="w-4 h-0.5 bg-blue-500 rounded"></div>
                  <span className="text-blue-300 font-medium">Entry: {tradeLines.entry.toFixed(symbol === 'XAUUSD' ? 2 : 5)}</span>
                </div>
              )}
              {tradeLines.stopLoss && (
                <div className="flex items-center space-x-1">
                  <div className="w-4 h-0.5 bg-red-500 rounded border-dashed"></div>
                  <span className="text-red-300 font-medium">SL: {tradeLines.stopLoss.toFixed(symbol === 'XAUUSD' ? 2 : 5)}</span>
                </div>
              )}
              {tradeLines.takeProfit && (
                <div className="flex items-center space-x-1">
                  <div className="w-4 h-0.5 bg-green-500 rounded border-dashed"></div>
                  <span className="text-green-300 font-medium">TP: {tradeLines.takeProfit.toFixed(symbol === 'XAUUSD' ? 2 : 5)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};