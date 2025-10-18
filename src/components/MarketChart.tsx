import React, { useEffect, useState, useCallback, useRef } from 'react';
import { BarChart3, RefreshCw, Wifi, WifiOff, Database, Wrench, CheckCircle } from 'lucide-react';
import { CandlestickChart } from './CandlestickChart';
import { AIAnalysisPanel } from './AIAnalysisPanel';
import { RealAIAnalysisPanel } from './RealAIAnalysisPanel';
import { DataHealthIndicator } from './DataHealthIndicator';
import { AutoTradingAnalysisPanel } from './AutoTradingAnalysisPanel';
import { ChartAutoTradingIndicator } from './ChartAutoTradingIndicator';
import { FxFlowScalperPanel } from './FxFlowScalperPanel';
import { StrategyPerformanceWidget } from './StrategyPerformanceWidget';
import { AutoTradingPanel } from './AutoTradingPanel';
import { useAutoTradingStatus } from '../hooks/useAutoTradingStatus';
import { CandlestickData, Time, HistogramData } from 'lightweight-charts';
import { marketDataService, MarketDataListener, TickData } from '../services/market-data';
import { Timeframe, CandleData } from '../services/metaapi';
import { getCandleOpenTime, isNewCandlePeriod } from '../services/candle-utils';
import { marketHoursService } from '../services/market-hours';
import { candleStateManager } from '../services/candle-state-manager';
import { AIAnalysisData } from '../types/ai-analysis';
import { generateSampleAIAnalysis } from '../utils/sample-ai-analysis';
import { useChartPreferences } from '../hooks/useChartPreferences';
import { analyzeMarket, AiMarketSummary } from '../lib/aiMarketEngine';
import { saveMarketAnalysis } from '../services/marketAnalysisService';
import { calculateEMAsForChart } from '../lib/emaAnalysis';
import { calculateVWAP } from '../lib/indicators';
import { LineData } from 'lightweight-charts';

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
  const [timeframe, setTimeframe] = useState<Timeframe>('M5');
  const [isConnected, setIsConnected] = useState(false);
  const [dataSource, setDataSource] = useState<'live' | 'cache' | 'none'>('none');
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [bidAskSpread, setBidAskSpread] = useState<number>(0);
  const [isLiveUpdating, setIsLiveUpdating] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [dataHealthStatus, setDataHealthStatus] = useState<{
    completeness: number;
    gaps: number;
    isValidating: boolean;
  }>({ completeness: 100, gaps: 0, isValidating: false });
  const listenerRef = useRef<MarketDataListener | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const pendingUpdateRef = useRef<CandlestickData<Time> | null>(null);
  const pendingVolumeUpdateRef = useRef<HistogramData<Time> | null>(null);
  const lastRenderTimeRef = useRef<number>(0);
  const isUserInteractingRef = useRef<boolean>(false);
  const updateIntervalRef = useRef<number | null>(null);
  const lastTickTimeRef = useRef<number>(0);
  const tickCountRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);

  const availablePairs = ['EURUSD', 'GBPUSD', 'XAUUSD', 'US30'];

  const applyPendingUpdate = useCallback(() => {
    if (!isMountedRef.current) return;

    const pendingUpdate = pendingUpdateRef.current;
    const pendingVolume = pendingVolumeUpdateRef.current;

    if (!pendingUpdate && !pendingVolume) {
      return;
    }

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
    setDataHealthStatus(prev => ({ ...prev, isValidating: true }));

    try {
      Promise.resolve().then(() => candleStateManager.initializeCandleState(symbol, timeframe));

      const quickCandles = await marketDataService.getHistoricalData(symbol, timeframe, 100, true, true);

      if (quickCandles.length === 0) {
        setError('No market data available');
        setDataSource('none');
        setDataHealthStatus({ completeness: 0, gaps: 0, isValidating: false });
        return;
      }

      const cacheKey = `${symbol}_${timeframe}`;
      const chartData = marketDataService.convertToCandlestickData(quickCandles, cacheKey);
      const volumeChartData = marketDataService.convertToVolumeData(quickCandles, cacheKey);
      setCandleData(chartData);
      setVolumeData(volumeChartData);
      setLastUpdate(new Date());
      setDataSource('cache');
      setIsConnected(marketDataService.isConnected());
      setDataHealthStatus({ completeness: 100, gaps: 0, isValidating: false });

      Promise.resolve().then(async () => {
        try {
          setIsLoadingMore(true);
          const fullCandles = await marketDataService.getHistoricalData(symbol, timeframe, 500, true, false);

          if (fullCandles.length > quickCandles.length) {
            const validation = await marketDataService.validateDataCompleteness(symbol, timeframe, fullCandles);
            setDataHealthStatus({
              completeness: validation.completeness,
              gaps: validation.gaps,
              isValidating: false
            });

            if (!validation.isComplete && validation.gaps > 0) {
              console.warn(`⚠️ Data completeness: ${validation.completeness.toFixed(1)}%, ${validation.gaps} gap(s) detected for ${symbol} ${timeframe}`);
            } else {
              console.log(`✅ Data complete for ${symbol} ${timeframe}: ${validation.completeness.toFixed(1)}%`);
            }

            const fullChartData = marketDataService.convertToCandlestickData(fullCandles, cacheKey);
            const fullVolumeData = marketDataService.convertToVolumeData(fullCandles, cacheKey);
            setCandleData(fullChartData);
            setVolumeData(fullVolumeData);
            console.log(`✨ Loaded full ${fullCandles.length} candles for ${symbol} ${timeframe}`);
          }
        } catch (err) {
          console.warn('Background data load failed:', err);
        } finally {
          setIsLoadingMore(false);
        }
      });

      const currentCandle = candleStateManager.getCurrentCandle(symbol, timeframe);
      if (currentCandle && !currentCandle.isComplete && quickCandles.length > 0) {
        const lastHistoricalCandle = quickCandles[quickCandles.length - 1];
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
    console.log(`[MarketChart] Starting subscription for ${symbol} ${timeframe}`);

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

          setCurrentPrice(candle.close);
          setLastUpdate(new Date());
          setDataSource('live');
          setIsLiveUpdating(true);

          console.log(`[MarketChart] Candle update: ${candle.close}`);
        }
      },
      onTick: (tick: TickData) => {
        if (tick.symbol === symbol) {
          const now = Date.now();
          tickCountRef.current++;
          lastTickTimeRef.current = now;

          if (tickCountRef.current % 10 === 0) {
            console.log(`[MarketChart] Tick #${tickCountRef.current}: ${tick.bid}/${tick.ask}`);
          }

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
        }
      },
      onError: (error: Error) => {
        console.error('[MarketChart] Live data error:', error);
        setError(error.message);
        setIsConnected(false);
        setIsLiveUpdating(false);
      }
    };

    listenerRef.current = listener;
    marketDataService.subscribeToSymbol(symbol, timeframe, listener).catch(err => {
      console.error('[MarketChart] Failed to subscribe:', err);
      setError('Failed to connect to live data feed');
    });

    if (updateIntervalRef.current) {
      clearInterval(updateIntervalRef.current);
      updateIntervalRef.current = null;
    }

    updateIntervalRef.current = window.setInterval(() => {
      if (!isMountedRef.current) {
        if (updateIntervalRef.current) {
          clearInterval(updateIntervalRef.current);
          updateIntervalRef.current = null;
        }
        return;
      }

      if (pendingUpdateRef.current || pendingVolumeUpdateRef.current) {
        applyPendingUpdate();
      }
    }, 100);

    console.log(`[MarketChart] Update interval started for ${symbol} ${timeframe}`);
  }, [symbol, timeframe, applyPendingUpdate]);

  useEffect(() => {
    isMountedRef.current = true;

    const initializeService = async () => {
      try {
        await marketDataService.initialize();
        setIsConnected(true);
        setError(null);
        console.log('[MarketChart] Market data service initialized');
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
      console.log('[MarketChart] Component unmounting, cleaning up...');
      isMountedRef.current = false;

      if (listenerRef.current) {
        marketDataService.unsubscribeFromSymbol(symbol, timeframe, listenerRef.current);
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
        updateIntervalRef.current = null;
      }
      candleStateManager.flushAll();
    };
  }, []);

  useEffect(() => {
    loadHistoricalData();
  }, [loadHistoricalData]);

  useEffect(() => {
    if (isConnected && isMountedRef.current) {
      console.log(`[MarketChart] Subscribing to live data for ${symbol} ${timeframe}`);
      tickCountRef.current = 0;
      lastTickTimeRef.current = Date.now();
      subscribeToLiveData();
    }

    return () => {
      console.log(`[MarketChart] Cleaning up subscription for ${symbol} ${timeframe}`);
      if (listenerRef.current) {
        marketDataService.unsubscribeFromSymbol(symbol, timeframe, listenerRef.current);
        listenerRef.current = null;
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
  const [realAiAnalysis, setRealAiAnalysis] = useState<AiMarketSummary | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const { preferences, updatePreferences } = useChartPreferences();
  const [isMarketOpen, setIsMarketOpen] = useState<boolean>(true);
  const [marketStatusMessage, setMarketStatusMessage] = useState<string>('');
  const [emaChartData, setEmaChartData] = useState<{
    ema5?: LineData<Time>[];
    ema9?: LineData<Time>[];
    ema21?: LineData<Time>[];
    ema50?: LineData<Time>[];
    ema200?: LineData<Time>[];
  } | null>(null);
  const [vwapChartData, setVwapChartData] = useState<LineData<Time>[]>([]);
  const { status: autoTradingStatus, symbolStatuses } = useAutoTradingStatus();
  const [nextScanCountdown, setNextScanCountdown] = useState<number>(0);
  const [isFixingData, setIsFixingData] = useState(false);
  const [fixMessage, setFixMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [fixProgress, setFixProgress] = useState<{ status: string; percent: number } | null>(null);

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

      if (candleData.length >= 50) {
        try {
          const candles = candleData.map(c => ({
            time: new Date((c.time as number) * 1000).toISOString(),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: 0
          }));

          const emaData = calculateEMAsForChart(candles);

          if (emaData[5].length > 0 || emaData[21].length > 0 || emaData[200].length > 0) {
            setEmaChartData({
              ema5: emaData[5],
              ema9: emaData[9],
              ema21: emaData[21],
              ema50: emaData[50],
              ema200: emaData[200]
            });
            console.log('[MarketChart] EMA chart data state updated');
          } else {
            console.warn('[MarketChart] No EMA data generated');
          }

          const vwapData: LineData<Time>[] = [];
          for (let i = 0; i < candles.length; i++) {
            const subset = candles.slice(Math.max(0, i - 49), i + 1);
            if (subset.length >= 2) {
              try {
                const vwapValue = calculateVWAP(subset, subset.length);
                if (isFinite(vwapValue) && vwapValue > 0) {
                  vwapData.push({
                    time: (candleData[i].time as number) as Time,
                    value: vwapValue
                  });
                }
              } catch (err) {
                console.error(`[MarketChart] Error calculating VWAP at index ${i}:`, err);
              }
            }
          }
          setVwapChartData(vwapData);
          console.log('[MarketChart] VWAP chart data calculated:', vwapData.length, 'points');
        } catch (err) {
          console.error('[MarketChart] Failed to calculate EMA data:', err);
        }
      } else {
        console.log('[MarketChart] Waiting for more candles before calculating EMAs:', candleData.length, '/ 50 minimum');
      }
    }
  }, [candleData, displayPrice, highPrice, lowPrice, symbol]);

  const performRealAiAnalysis = useCallback(async () => {
    if (candleData.length < 20 || isAnalyzing) {
      return;
    }

    try {
      setIsAnalyzing(true);

      const candles = candleData.map(c => ({
        time: new Date((c.time as number) * 1000).toISOString(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: 0
      }));

      console.log(`🤖 Starting real AI analysis for ${symbol} ${timeframe} with ${candles.length} candles...`);

      const analysis = await analyzeMarket(candles);
      setRealAiAnalysis(analysis);

      console.log(`✅ AI Analysis complete for ${symbol} ${timeframe}`);
      console.log(`   RSI: ${analysis.rsi.value} (${analysis.rsi.status})`);
      console.log(`   VWAP: ${analysis.vwap.value} (${analysis.vwap.position})`);
      console.log(`   Sentiment: ${analysis.sentiment.status} (${analysis.sentiment.confidence}%)`);
      console.log(`   Trade Signal: ${analysis.tradeSignal.status}`);

      saveMarketAnalysis(symbol, timeframe, analysis).catch(err => {
        console.warn('Failed to save analysis to database:', err);
      });

    } catch (err) {
      console.error('❌ AI analysis failed:', err);
      setRealAiAnalysis(null);
    } finally {
      setIsAnalyzing(false);
    }
  }, [candleData, symbol, timeframe, isAnalyzing]);

  useEffect(() => {
    if (candleData.length >= 50 && !isAnalyzing) {
      performRealAiAnalysis();
    }
  }, [candleData.length, symbol, timeframe]);

  useEffect(() => {
    const updateMarketStatus = () => {
      const now = new Date();
      const marketOpen = marketHoursService.isMarketOpen(now);
      const statusMessage = marketHoursService.getMarketStatusMessage(now);

      setIsMarketOpen(marketOpen);
      setMarketStatusMessage(statusMessage);
    };

    updateMarketStatus();
    const interval = setInterval(updateMarketStatus, 60000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (autoTradingStatus.nextScanTime) {
      const interval = setInterval(() => {
        const secondsRemaining = Math.max(0, Math.floor((autoTradingStatus.nextScanTime!.getTime() - Date.now()) / 1000));
        setNextScanCountdown(secondsRemaining);
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [autoTradingStatus.nextScanTime]);

  useEffect(() => {
    if (!isConnected) return;

    const monitorInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastTick = now - lastTickTimeRef.current;

      if (timeSinceLastTick > 60000 && lastTickTimeRef.current > 0) {
        console.warn(`[MarketChart] No ticks received for ${Math.floor(timeSinceLastTick / 1000)}s. Checking connection...`);
        setIsLiveUpdating(false);
      }

      if (updateIntervalRef.current === null && isConnected) {
        console.warn('[MarketChart] Update interval stopped unexpectedly. Restarting...');
        subscribeToLiveData();
      }
    }, 10000);

    return () => clearInterval(monitorInterval);
  }, [isConnected, subscribeToLiveData]);

  const handleManualDataFix = useCallback(async () => {
    if (isFixingData) return;

    setIsFixingData(true);
    setFixMessage(null);
    setFixProgress({ status: 'Checking MetaAPI connection...', percent: 0 });

    try {
      const connectionStatus = marketDataService.getConnectionStatus();
      console.log('📊 Current connection status:', connectionStatus);

      if (!connectionStatus.hasCredentials) {
        setFixProgress(null);
        setFixMessage({
          type: 'error',
          text: 'MetaAPI credentials not configured. Please check your .env file.'
        });
        setIsFixingData(false);
        setTimeout(() => setFixMessage(null), 10000);
        return;
      }

      if (!connectionStatus.isConnected) {
        setFixProgress({ status: 'MetaAPI not connected. Testing connection...', percent: 2 });
        const testResult = await marketDataService.testConnection();

        if (!testResult.success) {
          console.error('❌ Connection test failed:', testResult);
          setFixProgress(null);
          setFixMessage({
            type: 'error',
            text: `Connection test failed: ${testResult.message}`
          });
          setIsFixingData(false);
          setTimeout(() => setFixMessage(null), 15000);
          return;
        }

        console.log('✅ Connection test passed:', testResult);
      }

      setFixProgress({ status: 'Starting multi-timeframe backfill...', percent: 5 });

      const allTimeframes: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
      const totalTimeframes = allTimeframes.length;
      let completedTimeframes = 0;
      let totalCandlesFetched = 0;
      const results: { [key: string]: { success: boolean; candles: number; message?: string } } = {};

      for (const tf of allTimeframes) {
        const basePercent = 5;
        const tfPercent = basePercent + Math.floor((completedTimeframes / totalTimeframes) * 85);

        try {
          const candleLimit = tf === 'M1' ? 500 : tf === 'M5' ? 1000 : tf === 'M15' ? 1000 : 1000;

          const result = await marketDataService.fetchAndFillMissingCandles(
            symbol,
            tf,
            candleLimit,
            (progress) => {
              setFixProgress({
                status: `[${tf}] ${progress.status} (${completedTimeframes + 1}/${totalTimeframes})`,
                percent: tfPercent + Math.floor(progress.percent * 0.85 / totalTimeframes)
              });
            }
          );

          results[tf] = {
            success: result.success,
            candles: result.candlesFetched,
            message: result.message
          };

          if (result.success) {
            totalCandlesFetched += result.candlesFetched;
            console.log(`✅ ${tf}: ${result.candlesFetched} candles fetched`);
          } else {
            console.warn(`⚠️ ${tf}: ${result.message}`);
          }

          completedTimeframes++;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error(`❌ Failed to backfill ${tf}:`, errorMsg);
          results[tf] = { success: false, candles: 0, message: errorMsg };
          completedTimeframes++;
        }
      }

      setFixProgress({ status: 'Reloading current chart...', percent: 95 });

      setCandleData([]);
      setVolumeData([]);
      setDataHealthStatus({ completeness: 0, gaps: 0, isValidating: true });

      await new Promise(resolve => setTimeout(resolve, 800));
      await loadHistoricalData();

      setFixProgress(null);

      const successCount = Object.values(results).filter(r => r.success).length;
      const failedCount = totalTimeframes - successCount;
      const successTimeframes = Object.entries(results)
        .filter(([_, r]) => r.success)
        .map(([tf, _]) => tf)
        .join(', ');

      const failedTimeframes = Object.entries(results)
        .filter(([_, r]) => !r.success)
        .map(([tf, r]) => `${tf} (${r.message || 'unknown error'})`)
        .join(', ');

      if (successCount === totalTimeframes) {
        setFixMessage({
          type: 'success',
          text: `✅ All ${totalTimeframes} timeframes successfully backfilled! Total: ${totalCandlesFetched} candles fetched and saved to database.`
        });
      } else if (successCount > 0) {
        setFixMessage({
          type: 'success',
          text: `Partially successful: ${successCount}/${totalTimeframes} timeframes backfilled (${successTimeframes}). Total: ${totalCandlesFetched} candles saved. Failed: ${failedTimeframes}`
        });
      } else {
        const firstError = Object.values(results)[0]?.message || 'Unknown error';
        setFixMessage({
          type: 'error',
          text: `Failed to backfill all timeframes. First error: ${firstError}. Check console for details.`
        });
      }

      setTimeout(() => {
        setFixMessage(null);
      }, 20000);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Multi-timeframe backfill error:', error);
      setFixProgress(null);
      setFixMessage({
        type: 'error',
        text: `Failed to complete multi-timeframe backfill: ${errorMsg}`
      });

      setTimeout(() => {
        setFixMessage(null);
      }, 10000);
    } finally {
      setIsFixingData(false);
    }
  }, [symbol, timeframe, isFixingData, loadHistoricalData]);

  const shouldShowFixButton = dataHealthStatus.gaps > 0 || dataHealthStatus.completeness < 95;

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
                <div className={`flex items-center space-x-2 px-3 py-1 rounded-lg border ${
                  isMarketOpen
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-red-500/10 border-red-500/30 text-red-400'
                }`}>
                  <div className={`w-2 h-2 rounded-full ${
                    isMarketOpen ? 'bg-emerald-400' : 'bg-red-400'
                  } ${isMarketOpen ? 'animate-pulse' : ''}`}></div>
                  <span className="text-xs font-medium">{marketStatusMessage}</span>
                </div>
                {isConnected ? (
                  <div className="flex items-center space-x-1" title={`Connected - ${tickCountRef.current} ticks received`}>
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
            {(isLoading || isLoadingMore) && <RefreshCw className="h-5 w-5 text-emerald-400 animate-spin ml-3" />}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-white/50 text-xs font-medium mb-1">Current Price</p>
                <p className={`text-2xl sm:text-3xl font-bold font-mono ${priceChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {displayPrice.toFixed(symbol === 'XAUUSD' || symbol === 'US30' ? 2 : 5)}
                </p>
              </div>
              <div className="text-right">
                <div className={`text-lg font-bold ${priceChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(symbol === 'XAUUSD' || symbol === 'US30' ? 2 : 5)}
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
                  <span className="ml-1 text-white/60">{bidAskSpread.toFixed(symbol === 'XAUUSD' || symbol === 'US30' ? 2 : 5)}</span>
                </div>
              )}
              <div>
                <span className="text-white/40">Updated:</span>
                <span className="ml-1 text-white/60">{lastUpdate ? lastUpdate.toLocaleTimeString([], {timeStyle: 'medium'}) : 'Loading...'}</span>
              </div>
              {dataHealthStatus.completeness > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-white/40">Data:</span>
                  <span className={`ml-1 font-medium ${
                    dataHealthStatus.completeness >= 98 ? 'text-green-400' :
                    dataHealthStatus.completeness >= 90 ? 'text-yellow-400' :
                    'text-red-400'
                  }`}>
                    {dataHealthStatus.completeness.toFixed(0)}%
                  </span>
                  {dataHealthStatus.gaps > 0 && (
                    <span className="text-orange-400 text-xs">
                      ({dataHealthStatus.gaps} gap{dataHealthStatus.gaps > 1 ? 's' : ''})
                    </span>
                  )}
                  {dataHealthStatus.isValidating && (
                    <RefreshCw className="h-3 w-3 text-blue-400 animate-spin" />
                  )}
                </div>
              )}
            </div>
            {shouldShowFixButton && (
              <button
                onClick={handleManualDataFix}
                disabled={isFixingData}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all bg-blue-500/20 text-blue-400 border border-blue-500/50 hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Fetch missing candles from MetaAPI and fix data gaps"
              >
                {isFixingData ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>{fixProgress?.status || 'Fixing...'}</span>
                  </>
                ) : (
                  <>
                    <Wrench className="h-4 w-4" />
                    <span>Fix Data</span>
                  </>
                )}
              </button>
            )}
            <DataHealthIndicator />
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {fixProgress && (
        <div className="mb-4 p-4 rounded-xl border bg-blue-500/10 border-blue-500/30">
          <div className="flex items-center gap-3 mb-2">
            <RefreshCw className="h-5 w-5 text-blue-400 animate-spin flex-shrink-0" />
            <p className="text-sm font-medium text-blue-300">{fixProgress.status}</p>
            <span className="ml-auto text-xs text-blue-400 font-mono">{fixProgress.percent}%</span>
          </div>
          <div className="w-full bg-blue-900/30 rounded-full h-2 overflow-hidden">
            <div
              className="bg-gradient-to-r from-blue-500 to-cyan-500 h-full transition-all duration-300 ease-out"
              style={{ width: `${fixProgress.percent}%` }}
            />
          </div>
        </div>
      )}

      {fixMessage && (
        <div className={`mb-4 p-4 rounded-xl border flex items-center gap-3 ${
          fixMessage.type === 'success'
            ? 'bg-green-500/10 border-green-500/30'
            : 'bg-red-500/10 border-red-500/30'
        }`}>
          {fixMessage.type === 'success' ? (
            <CheckCircle className="h-5 w-5 text-green-400 flex-shrink-0" />
          ) : (
            <Database className="h-5 w-5 text-red-400 flex-shrink-0" />
          )}
          <p className={`text-sm font-medium ${
            fixMessage.type === 'success' ? 'text-green-300' : 'text-red-400'
          }`}>
            {fixMessage.text}
          </p>
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
          <div className="relative">
            <CandlestickChart
              key={`${symbol}-${timeframe}`}
              symbol={symbol}
              data={candleData}
              volumeData={preferences.show_volume ? volumeData : undefined}
              aiAnalysis={preferences.show_ai_analysis ? aiAnalysis : undefined}
              emaData={emaChartData || undefined}
              vwapData={vwapChartData.length > 0 ? vwapChartData : undefined}
              tradeLines={tradeLines}
              height={500}
              preferences={preferences}
            />
          </div>
          {preferences.show_ai_analysis && (
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-bold text-white">Analysis</h3>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => updatePreferences({ analysis_view_mode: 'technical' })}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    preferences.analysis_view_mode === 'technical'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                      : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white border border-white/10'
                  }`}
                >
                  Technical
                </button>
                <button
                  onClick={() => updatePreferences({ analysis_view_mode: 'autotrading' })}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    preferences.analysis_view_mode === 'autotrading'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                      : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white border border-white/10'
                  }`}
                >
                  Auto-Trading
                </button>
              </div>
            </div>
          )}
          {preferences.show_ai_analysis && preferences.analysis_view_mode === 'technical' && realAiAnalysis ? (
            <RealAIAnalysisPanel analysis={realAiAnalysis} symbol={symbol} isAnalyzing={isAnalyzing} />
          ) : preferences.show_ai_analysis && preferences.analysis_view_mode === 'technical' && aiAnalysis ? (
            <AIAnalysisPanel analysis={aiAnalysis} symbol={symbol} />
          ) : preferences.show_ai_analysis && preferences.analysis_view_mode === 'autotrading' ? (
            <div className="space-y-6">
              {/* Auto Trading Strategy Panels */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-6">
                  <FxFlowScalperPanel />
                  <AutoTradingPanel />
                </div>
                <StrategyPerformanceWidget />
              </div>

              {/* Multi-Symbol Scanner Analysis */}
              <AutoTradingAnalysisPanel
                symbols={symbolStatuses}
                isActive={autoTradingStatus.isActive}
                tradesRemaining={autoTradingStatus.tradesRemaining}
                tradesTotal={autoTradingStatus.tradesToday + autoTradingStatus.tradesRemaining}
                lastScanTime={autoTradingStatus.lastScanTime || undefined}
                nextScanTime={autoTradingStatus.nextScanTime || undefined}
                currentlyScanning={autoTradingStatus.scanningSymbol || undefined}
              />
            </div>
          ) : null}
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
                  <span className="text-emerald-300 font-semibold">Entry: {tradeLines.entry.toFixed(symbol === 'XAUUSD' || symbol === 'US30' ? 2 : 5)}</span>
                </div>
              )}
              {tradeLines.stopLoss && (
                <div className="flex items-center space-x-1">
                  <div className="w-4 h-1 sm:w-6 sm:h-1 bg-red-500 rounded-full"></div>
                  <span className="text-red-300 font-semibold">SL: {tradeLines.stopLoss.toFixed(symbol === 'XAUUSD' || symbol === 'US30' ? 2 : 5)}</span>
                </div>
              )}
              {tradeLines.takeProfit && (
                <div className="flex items-center space-x-1">
                  <div className="w-4 h-1 sm:w-6 sm:h-1 bg-green-500 rounded-full"></div>
                  <span className="text-green-300 font-semibold">TP: {tradeLines.takeProfit.toFixed(symbol === 'XAUUSD' || symbol === 'US30' ? 2 : 5)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
