import React, { useEffect, useState, useCallback, useRef } from 'react';
import { BarChart3, RefreshCw, Wifi, WifiOff, Database } from 'lucide-react';
import { CandlestickChart } from './CandlestickChart';
import { AIAnalysisPanel } from './AIAnalysisPanel';
import { ChartSettings } from './ChartSettings';
import { DataHealthIndicator } from './DataHealthIndicator';
import { CandlestickData, Time, HistogramData } from 'lightweight-charts';
import { marketDataService, MarketDataListener, TickData } from '../services/market-data';
import { Timeframe, CandleData } from '../services/metaapi';
import { getCandleOpenTime, isNewCandlePeriod } from '../services/candle-utils';
import { candleStateManager } from '../services/candle-state-manager';
import { AIAnalysisData } from '../types/ai-analysis';
import { generateSampleAIAnalysis } from '../utils/sample-ai-analysis';
import { useChartPreferences } from '../hooks/useChartPreferences';

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

const TIMEFRAMES: { value: Timeframe; label: string; shortLabel: string }[] = [
  { value: 'M1', label: '1 Min', shortLabel: '1m' },
  { value: 'M5', label: '5 Min', shortLabel: '5m' },
  { value: 'M15', label: '15 Min', shortLabel: '15m' },
  { value: 'M30', label: '30 Min', shortLabel: '30m' },
  { value: 'H1', label: '1 Hour', shortLabel: '1h' },
  { value: 'H4', label: '4 Hour', shortLabel: '4h' },
  { value: 'D1', label: 'Daily', shortLabel: '1D' },
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
  const [volumeData, setVolumeData] = useState<HistogramData<Time>[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe>('M15');
  const [isConnected, setIsConnected] = useState(false);
  const [dataSource, setDataSource] = useState<'live' | 'cache' | 'none'>('none');
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [bidAskSpread, setBidAskSpread] = useState<number>(0);
  const [isLiveUpdating, setIsLiveUpdating] = useState(false);
  const listenerRef = useRef<MarketDataListener | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const pendingUpdateRef = useRef<CandlestickData<Time> | null>(null);
  const pendingVolumeUpdateRef = useRef<HistogramData<Time> | null>(null);
  const lastRenderTimeRef = useRef<number>(0);
  const isUserInteractingRef = useRef<boolean>(false);
  const updateIntervalRef = useRef<number | null>(null);

  const availablePairs = ['EURUSD', 'GBPUSD', 'XAUUSD'];

  const applyPendingUpdate = useCallback(() => {
    const pendingUpdate = pendingUpdateRef.current;
    const pendingVolume = pendingVolumeUpdateRef.current;
    pendingUpdateRef.current = null;
    pendingVolumeUpdateRef.current = null;

    if (pendingUpdate && pendingUpdate.time !== undefined && pendingUpdate.time !== null) {
      setCandleData(prev => {
        if (prev.length === 0) {
          return [pendingUpdate];
        }

        const lastCandle = prev[prev.length - 1];
        if (!lastCandle || lastCandle.time === undefined || lastCandle.time === null) {
          return [pendingUpdate];
        }

        const pendingTime = pendingUpdate.time as number;
        const lastTime = lastCandle.time as number;

        if (pendingTime > lastTime) {
          return [...prev, pendingUpdate].slice(-500);
        } else {
          const updated = [...prev];
          updated[updated.length - 1] = pendingUpdate;
          return updated;
        }
      });
    }

    if (pendingVolume && pendingVolume.time !== undefined && pendingVolume.time !== null) {
      setVolumeData(prev => {
        if (prev.length === 0) {
          return [pendingVolume];
        }

        const lastVolume = prev[prev.length - 1];
        if (!lastVolume || lastVolume.time === undefined || lastVolume.time === null) {
          return [pendingVolume];
        }

        const pendingTime = pendingVolume.time as number;
        const lastTime = lastVolume.time as number;

        if (pendingTime > lastTime) {
          return [...prev, pendingVolume].slice(-500);
        } else {
          const updated = [...prev];
          updated[updated.length - 1] = pendingVolume;
          return updated;
        }
      });
    }
  }, []);

  const scheduleRender = useCallback(() => {
    if (animationFrameRef.current) return;

    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      applyPendingUpdate();
    });
  }, [applyPendingUpdate]);

  const loadHistoricalData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      await candleStateManager.initializeCandleState(symbol, timeframe);

      const candles = await marketDataService.getHistoricalData(symbol, timeframe, 500);

      if (candles.length === 0) {
        setError('No market data available');
        setDataSource('none');
        return;
      }

      const chartData = marketDataService.convertToCandlestickData(candles);
      const volumeChartData = marketDataService.convertToVolumeData(candles);
      setCandleData(chartData);
      setVolumeData(volumeChartData);
      setLastUpdate(new Date());
      setDataSource('cache');
      setIsConnected(marketDataService.isConnected());

      const currentCandle = candleStateManager.getCurrentCandle(symbol, timeframe);
      if (currentCandle && !currentCandle.isComplete && candles.length > 0) {
        const lastHistoricalCandle = candles[candles.length - 1];
        const lastHistoricalTime = lastHistoricalCandle ? lastHistoricalCandle.time.getTime() : 0;
        const currentCandleTime = currentCandle.timestamp.getTime();

        if (currentCandleTime > lastHistoricalTime) {
          const liveCandle: CandlestickData<Time> = {
            time: Math.floor(currentCandle.timestamp.getTime() / 1000) as Time,
            open: currentCandle.open,
            high: currentCandle.high,
            low: currentCandle.low,
            close: currentCandle.close
          };
          const liveVolume: HistogramData<Time> = {
            time: Math.floor(currentCandle.timestamp.getTime() / 1000) as Time,
            value: 0,
            color: currentCandle.close >= currentCandle.open ? '#10b98180' : '#ef444480'
          };
          setCandleData(prev => [...prev, liveCandle]);
          setVolumeData(prev => [...prev, liveVolume]);
          console.log('Restored incomplete candle from state manager');
        }
      }
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
          const candleState = candleStateManager.updateCandleWithCandleData(candle);

          const chartCandle: CandlestickData<Time> = {
            time: Math.floor(candleState.timestamp.getTime() / 1000) as Time,
            open: candleState.open,
            high: candleState.high,
            low: candleState.low,
            close: candleState.close
          };

          const chartVolume: HistogramData<Time> = {
            time: Math.floor(candleState.timestamp.getTime() / 1000) as Time,
            value: candle.volume,
            color: candleState.close >= candleState.open ? '#10b98180' : '#ef444480'
          };

          pendingUpdateRef.current = chartCandle;
          pendingVolumeUpdateRef.current = chartVolume;
          scheduleRender();

          setCurrentPrice(candle.close);
          setLastUpdate(new Date());
          setDataSource('live');
          setIsLiveUpdating(true);
        }
      },
      onTick: (tick: TickData) => {
        if (tick.symbol === symbol) {
          const midPrice = (tick.bid + tick.ask) / 2;
          const spread = tick.ask - tick.bid;
          setCurrentPrice(midPrice);
          setBidAskSpread(spread);
          setLastUpdate(new Date());
          setIsLiveUpdating(true);

          const candleState = candleStateManager.updateCandleWithTick(
            symbol,
            timeframe,
            midPrice,
            tick.time
          );

          const chartCandle: CandlestickData<Time> = {
            time: Math.floor(candleState.timestamp.getTime() / 1000) as Time,
            open: candleState.open,
            high: candleState.high,
            low: candleState.low,
            close: candleState.close
          };

          pendingUpdateRef.current = chartCandle;
          scheduleRender();
        }
      },
      onError: (error: Error) => {
        console.error('Live data error:', error);
        setError(error.message);
        setIsConnected(false);
        setIsLiveUpdating(false);
      }
    };

    listenerRef.current = listener;
    marketDataService.subscribeToSymbol(symbol, timeframe, listener).catch(err => {
      console.error('Failed to subscribe:', err);
      setError('Failed to connect to live data feed');
    });

    if (updateIntervalRef.current) {
      clearInterval(updateIntervalRef.current);
    }

    updateIntervalRef.current = window.setInterval(() => {
      if (pendingUpdateRef.current) {
        applyPendingUpdate();
      }
    }, 100);
  }, [symbol, timeframe, scheduleRender, applyPendingUpdate]);

  useEffect(() => {
    const initializeService = async () => {
      try {
        await marketDataService.initialize();
        setIsConnected(true);
        setError(null);
      } catch (err) {
        setIsConnected(false);
        const errorMsg = err instanceof Error ? err.message : 'Failed to connect to MetaApi';
        if (errorMsg.includes('credentials not configured') || errorMsg.includes('demo mode')) {
          console.log('📊 Running in demo mode with cached data');
        } else if (errorMsg.includes('Network connection failed')) {
          setError('Network connection failed. Using cached data only.');
        } else if (errorMsg.includes('Invalid') || errorMsg.includes('credentials')) {
          setError('Invalid MetaApi credentials. Using cached data only.');
        }
      }
    };

    initializeService();

    return () => {
      if (listenerRef.current) {
        marketDataService.unsubscribeFromSymbol(symbol, timeframe, listenerRef.current);
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
      }
      candleStateManager.flushAll();
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
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
        updateIntervalRef.current = null;
      }
    };
  }, [symbol, timeframe, isConnected, subscribeToLiveData]);

  const displayPrice = currentPrice || (candleData.length > 0 ? candleData[candleData.length - 1].close : 0);
  const [openPrice, setOpenPrice] = useState<number>(0);
  const [highPrice, setHighPrice] = useState<number>(0);
  const [lowPrice, setLowPrice] = useState<number>(0);
  const [priceChange, setPriceChange] = useState<number>(0);
  const [priceChangePercent, setPriceChangePercent] = useState<number>(0);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysisData | undefined>(undefined);
  const { preferences, updatePreferences } = useChartPreferences();

  useEffect(() => {
    if (candleData.length > 0) {
      const latestCandle = candleData[candleData.length - 1];
      const firstCandle = candleData[0];
      setOpenPrice(latestCandle.open);
      setHighPrice(latestCandle.high);
      setLowPrice(latestCandle.low);
      const change = displayPrice - firstCandle.open;
      const changePercent = (change / firstCandle.open) * 100;
      setPriceChange(change);
      setPriceChangePercent(changePercent);

      const analysis = generateSampleAIAnalysis(displayPrice, highPrice, lowPrice, symbol);
      setAiAnalysis(analysis);
    }
  }, [candleData, displayPrice, highPrice, lowPrice, symbol]);

  return (
    <div className={`${className}`}>
      <div className="glass-card p-4 sm:p-6 mb-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center justify-between lg:justify-start">
            <div className="flex items-center space-x-3">
              <select
                value={symbol}
                onChange={(e) => onSymbolChange(e.target.value)}
                className="bg-white/5 backdrop-blur-sm border border-white/20 rounded-lg px-3 py-2 text-base sm:text-lg text-white font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              >
                {availablePairs.map(pair => (
                  <option key={pair} value={pair} className="bg-slate-900">{pair}</option>
                ))}
              </select>
              <div className="flex items-center space-x-2">
                {isConnected ? (
                  <div className="flex items-center space-x-1">
                    <Wifi className="h-4 w-4 text-emerald-400" />
                    {isLiveUpdating && (
                      <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
                    )}
                  </div>
                ) : (
                  <WifiOff className="h-4 w-4 text-red-400" />
                )}
              </div>
            </div>
            {isLoading && <RefreshCw className="h-5 w-5 text-emerald-400 animate-spin ml-3" />}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-white/50 text-xs font-medium mb-1">Current Price</p>
                <p className={`text-2xl sm:text-3xl font-bold font-mono ${priceChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {displayPrice.toFixed(symbol === 'XAUUSD' ? 2 : 5)}
                </p>
              </div>
              <div className="text-right">
                <div className={`text-lg font-bold ${priceChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(symbol === 'XAUUSD' ? 2 : 5)}
                </div>
                <div className={`text-sm ${priceChangePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {priceChangePercent >= 0 ? '+' : ''}{priceChangePercent.toFixed(2)}%
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/10">
          <div className="flex flex-wrap items-center gap-2">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf.value}
                onClick={() => setTimeframe(tf.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  timeframe === tf.value
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                    : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white border border-white/10'
                }`}
              >
                {tf.shortLabel}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-4 text-xs text-white/50">
              {bidAskSpread > 0 && (
                <div>
                  <span className="text-white/40">Spread:</span>
                  <span className="ml-1 text-white/60">{bidAskSpread.toFixed(symbol === 'XAUUSD' ? 2 : 5)}</span>
                </div>
              )}
              <div>
                <span className="text-white/40">Updated:</span>
                <span className="ml-1 text-white/60">{lastUpdate ? lastUpdate.toLocaleTimeString([], {timeStyle: 'medium'}) : 'Loading...'}</span>
              </div>
            </div>
            <DataHealthIndicator />
            <ChartSettings preferences={preferences} onUpdate={updatePreferences} />
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
          <CandlestickChart
            key={`${symbol}-${timeframe}`}
            symbol={symbol}
            data={candleData}
            volumeData={preferences.show_volume ? volumeData : undefined}
            aiAnalysis={preferences.show_ai_analysis ? aiAnalysis : undefined}
            tradeLines={tradeLines}
            height={500}
            preferences={preferences}
          />
          {preferences.show_ai_analysis && <AIAnalysisPanel analysis={aiAnalysis} symbol={symbol} />}
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
