import React, { useEffect, useState, useCallback, useRef } from 'react';
import { BarChart3, RefreshCw, Wifi, WifiOff, Database } from 'lucide-react';
import { CandlestickChart } from './CandlestickChart';
import { CandlestickData, Time } from 'lightweight-charts';
import { marketDataService, MarketDataListener } from '../services/market-data';
import { Timeframe, CandleData } from '../services/metaapi';

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

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: 'M1', label: '1 Min' },
  { value: 'M5', label: '5 Min' },
  { value: 'M15', label: '15 Min' },
  { value: 'M30', label: '30 Min' },
  { value: 'H1', label: '1 Hour' },
  { value: 'H4', label: '4 Hour' },
  { value: 'D1', label: 'Daily' },
];

export const MarketChart: React.FC<MarketChartProps> = ({
  symbol,
  onSymbolChange,
  tradeLines,
  className = ""
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [candleData, setCandleData] = useState<CandlestickData<Time>[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe>('M15');
  const [isConnected, setIsConnected] = useState(false);
  const [dataSource, setDataSource] = useState<'live' | 'cache' | 'none'>('none');
  const listenerRef = useRef<MarketDataListener | null>(null);

  const availablePairs = ['EURUSD', 'GBPUSD', 'XAUUSD'];

  const loadHistoricalData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const candles = await marketDataService.getHistoricalData(symbol, timeframe, 500);

      if (candles.length === 0) {
        setError('No market data available');
        setDataSource('none');
        return;
      }

      const chartData = marketDataService.convertToCandlestickData(candles);
      setCandleData(chartData);
      setLastUpdate(new Date());
      setDataSource('cache');
      setIsConnected(marketDataService.isConnected());
    } catch (err) {
      console.error('Failed to load historical data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load market data');
      setDataSource('none');
    } finally {
      setIsLoading(false);
    }
  }, [symbol, timeframe]);

  const subscribeToLiveData = useCallback(() => {
    const listener: MarketDataListener = {
      onCandleUpdate: (candle: CandleData) => {
        if (candle.symbol === symbol && candle.timeframe === timeframe) {
          const chartCandle: CandlestickData<Time> = {
            time: Math.floor(candle.time.getTime() / 1000) as Time,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close
          };

          setCandleData(prev => {
            const existing = prev.findIndex(c => c.time === chartCandle.time);
            if (existing >= 0) {
              const updated = [...prev];
              updated[existing] = chartCandle;
              return updated;
            }
            return [...prev, chartCandle].slice(-500);
          });
          setLastUpdate(new Date());
          setDataSource('live');
        }
      },
      onError: (error: Error) => {
        console.error('Live data error:', error);
        setError(error.message);
        setIsConnected(false);
      }
    };

    listenerRef.current = listener;
    marketDataService.subscribeToSymbol(symbol, timeframe, listener).catch(err => {
      console.error('Failed to subscribe:', err);
      setError('Failed to connect to live data feed');
    });
  }, [symbol, timeframe]);

  useEffect(() => {
    const initializeService = async () => {
      try {
        await marketDataService.initialize();
        setIsConnected(true);
        setError(null);
      } catch (err) {
        console.warn('MetaApi not available, using cached data only:', err);
        setIsConnected(false);
        const errorMsg = err instanceof Error ? err.message : 'Failed to connect to MetaApi';
        if (errorMsg.includes('credentials not configured')) {
          setError('MetaApi credentials not configured. Using cached data only.');
        } else if (errorMsg.includes('CSP') || errorMsg.includes('Network connection blocked')) {
          setError('Connection blocked by security policy. Please check configuration.');
        } else if (errorMsg.includes('Invalid') || errorMsg.includes('credentials')) {
          setError('Invalid MetaApi credentials. Please verify your token and account ID.');
        } else {
          setError('Live data unavailable. Showing cached data.');
        }
      }
    };

    initializeService();

    return () => {
      if (listenerRef.current) {
        marketDataService.unsubscribeFromSymbol(symbol, timeframe, listenerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    loadHistoricalData();
  }, [loadHistoricalData]);

  useEffect(() => {
    if (isConnected) {
      subscribeToLiveData();
    }

    return () => {
      if (listenerRef.current) {
        marketDataService.unsubscribeFromSymbol(symbol, timeframe, listenerRef.current);
      }
    };
  }, [symbol, timeframe, isConnected, subscribeToLiveData]);

  const currentPrice = candleData.length > 0 ? candleData[candleData.length - 1].close : 0;

  return (
    <div className={`${className}`}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 sm:mb-8 space-y-4 sm:space-y-0">
        <div className="flex items-center space-x-3">
          <div className="p-2 sm:p-3 bg-gradient-to-r from-emerald-500/20 to-green-500/20 rounded-xl">
              <BarChart3 className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-lg sm:text-xl font-bold text-white">Live Market Chart</h3>
              <p className="text-xs sm:text-sm text-white/60 font-medium">Real-time price action</p>
            </div>
            {isLoading && <RefreshCw className="h-5 w-5 text-emerald-400 animate-spin" />}
        </div>

        <div className="flex items-center justify-between sm:justify-end space-x-3 sm:space-x-4">
          <select
            value={symbol}
            onChange={(e) => onSymbolChange(e.target.value)}
            className="bg-white/5 backdrop-blur-sm border border-white/20 rounded-xl px-3 py-2 sm:px-4 sm:py-3 text-sm sm:text-base text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
          >
            {availablePairs.map(pair => (
              <option key={pair} value={pair} className="bg-slate-900">{pair}</option>
            ))}
          </select>

          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value as Timeframe)}
            className="bg-white/5 backdrop-blur-sm border border-white/20 rounded-xl px-3 py-2 sm:px-4 sm:py-3 text-sm sm:text-base text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
          >
            {TIMEFRAMES.map(tf => (
              <option key={tf.value} value={tf.value} className="bg-slate-900">{tf.label}</option>
            ))}
          </select>

          <div className="text-right">
            <div className="flex items-center space-x-1">
              {isConnected ? (
                <Wifi className="h-3 w-3 text-emerald-400" />
              ) : (
                <WifiOff className="h-3 w-3 text-red-400" />
              )}
              {dataSource === 'cache' && <Database className="h-3 w-3 text-blue-400" />}
              <span className="text-xs sm:text-sm text-white/50 font-medium">
                {dataSource === 'live' ? 'Live' : dataSource === 'cache' ? 'Cached' : 'Offline'}
              </span>
            </div>
            <div className="text-xs text-white/40">{lastUpdate ? lastUpdate.toLocaleTimeString([], {timeStyle: 'short'}) : 'Loading...'}</div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {isLoading ? (
        <div className="relative bg-gradient-to-br from-slate-900/50 to-slate-800/50 backdrop-blur-sm rounded-2xl border border-white/10 h-64 sm:h-80 lg:h-96 flex items-center justify-center overflow-hidden">
          <div className="text-center relative z-10">
            <div className="relative mb-6">
              <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/20 to-green-500/20 rounded-full blur-xl"></div>
              <RefreshCw className="relative h-8 w-8 sm:h-12 sm:w-12 text-emerald-400 animate-spin mx-auto" />
            </div>
            <p className="text-white/70 text-base sm:text-lg font-medium">Loading {symbol} {timeframe} chart...</p>
            <p className="text-white/50 text-sm mt-2">Connecting to MetaApi...</p>
          </div>
        </div>
      ) : candleData.length > 0 ? (
        <div className="space-y-4">
          <div className="text-center">
            <div className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white">
              {currentPrice.toFixed(symbol === 'XAUUSD' ? 2 : 5)}
            </div>
            <div className="text-white/60 text-sm sm:text-base font-medium">{symbol} Current Price</div>
          </div>
          <CandlestickChart
            symbol={symbol}
            data={candleData}
            tradeLines={tradeLines}
            height={384}
          />
        </div>
      ) : (
        <div className="relative bg-gradient-to-br from-slate-900/50 to-slate-800/50 backdrop-blur-sm rounded-2xl border border-white/10 h-64 sm:h-80 lg:h-96 flex items-center justify-center">
          <div className="text-center">
            <Database className="h-12 w-12 text-white/30 mx-auto mb-4" />
            <p className="text-white/70 text-lg font-medium">No market data available</p>
            <p className="text-white/50 text-sm mt-2">Please configure MetaApi credentials</p>
          </div>
        </div>
      )}

      {tradeLines && Object.keys(tradeLines).length > 0 && (
        <div className="mt-6 sm:mt-8 p-4 sm:p-6 bg-gradient-to-r from-slate-900/30 to-slate-800/30 backdrop-blur-sm rounded-2xl border border-white/10">
          <div className="flex flex-col space-y-3 sm:space-y-4 lg:flex-row lg:items-center lg:justify-between lg:space-y-0">
            <h4 className="text-base sm:text-lg font-bold text-white">AI Trade Levels</h4>
            <div className="flex flex-wrap items-center gap-3 sm:gap-6 text-xs sm:text-sm">
              {tradeLines.entry && (
                <div className="flex items-center space-x-1">
                  <div className="w-4 h-1 sm:w-6 sm:h-1 bg-emerald-500 rounded-full"></div>
                  <span className="text-emerald-300 font-semibold">Entry: {tradeLines.entry.toFixed(symbol === 'XAUUSD' ? 2 : 5)}</span>
                </div>
              )}
              {tradeLines.stopLoss && (
                <div className="flex items-center space-x-1">
                  <div className="w-4 h-1 sm:w-6 sm:h-1 bg-red-500 rounded-full"></div>
                  <span className="text-red-300 font-semibold">SL: {tradeLines.stopLoss.toFixed(symbol === 'XAUUSD' ? 2 : 5)}</span>
                </div>
              )}
              {tradeLines.takeProfit && (
                <div className="flex items-center space-x-1">
                  <div className="w-4 h-1 sm:w-6 sm:h-1 bg-green-500 rounded-full"></div>
                  <span className="text-green-300 font-semibold">TP: {tradeLines.takeProfit.toFixed(symbol === 'XAUUSD' ? 2 : 5)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
