import React, { useEffect, useState, useCallback, useRef } from 'react';
import { BarChart3, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { CandlestickChart } from './CandlestickChart';
import { CandlestickData, Time } from 'lightweight-charts';
import { marketDataServiceAlpaca, CandleData, TickData } from '../services/market-data-alpaca';
import { alpacaAPI } from '../services/alpaca-api';

interface AlpacaMarketChartProps {
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  className?: string;
}

type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1';

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: 'M1', label: '1 Min' },
  { value: 'M5', label: '5 Min' },
  { value: 'M15', label: '15 Min' },
  { value: 'M30', label: '30 Min' },
  { value: 'H1', label: '1 Hour' },
  { value: 'H4', label: '4 Hour' },
  { value: 'D1', label: 'Daily' },
];

const POPULAR_SYMBOLS = [
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'GOOGL', name: 'Google' },
  { symbol: 'AMZN', name: 'Amazon' },
  { symbol: 'TSLA', name: 'Tesla' },
  { symbol: 'META', name: 'Meta' },
  { symbol: 'NVDA', name: 'NVIDIA' },
  { symbol: 'JPM', name: 'JPMorgan' }
];

export const AlpacaMarketChart: React.FC<AlpacaMarketChartProps> = ({
  symbol,
  onSymbolChange,
  className = ""
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candleData, setCandleData] = useState<CandlestickData<Time>[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe>('M5');
  const [isConnected, setIsConnected] = useState(false);
  const [currentPrice, setCurrentPrice] = useState<number>(0);

  const loadHistoricalData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      console.log(`[AlpacaChart] Loading data for ${symbol} ${timeframe}`);

      const candles = await marketDataServiceAlpaca.getHistoricalData(
        symbol,
        timeframe,
        200
      );

      if (candles.length === 0) {
        setError('No market data available for this symbol');
        return;
      }

      const chartCandles: CandlestickData<Time>[] = candles.map((candle: CandleData) => ({
        time: Math.floor(candle.time.getTime() / 1000) as Time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));

      setCandleData(chartCandles);
      setCurrentPrice(candles[candles.length - 1]?.close || 0);

      console.log(`[AlpacaChart] Loaded ${chartCandles.length} candles`);
    } catch (err) {
      console.error('[AlpacaChart] Error loading data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load market data');
    } finally {
      setIsLoading(false);
    }
  }, [symbol, timeframe]);

  useEffect(() => {
    loadHistoricalData();
  }, [loadHistoricalData]);

  useEffect(() => {
    const listener = {
      id: `chart-${symbol}`,
      onTick: (tick: TickData) => {
        const mid = (tick.bid + tick.ask) / 2;
        setCurrentPrice(mid);
        setIsConnected(true);
      }
    };

    marketDataServiceAlpaca.addListener(listener);
    marketDataServiceAlpaca.connect(symbol);

    return () => {
      marketDataServiceAlpaca.removeListener(listener.id);
    };
  }, [symbol]);

  const handleTimeframeChange = (newTimeframe: Timeframe) => {
    setTimeframe(newTimeframe);
  };

  const handleRefresh = () => {
    loadHistoricalData();
  };

  return (
    <div className={`flex flex-col space-y-4 ${className}`}>
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-4">
            <BarChart3 className="w-6 h-6 text-blue-400" />
            <select
              value={symbol}
              onChange={(e) => onSymbolChange(e.target.value)}
              className="bg-gray-700 text-white px-3 py-2 rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {POPULAR_SYMBOLS.map((s) => (
                <option key={s.symbol} value={s.symbol}>
                  {s.symbol} - {s.name}
                </option>
              ))}
            </select>

            <div className="flex items-center space-x-2">
              {isConnected ? (
                <>
                  <Wifi className="w-4 h-4 text-green-400" />
                  <span className="text-green-400 text-sm">Live</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-4 h-4 text-yellow-400" />
                  <span className="text-yellow-400 text-sm">Historical</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {currentPrice > 0 && (
              <div className="text-right mr-4">
                <div className="text-2xl font-bold text-white">
                  ${currentPrice.toFixed(2)}
                </div>
                <div className="text-xs text-gray-400">Current Price</div>
              </div>
            )}

            <button
              onClick={handleRefresh}
              disabled={isLoading}
              className="p-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors"
              title="Refresh data"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div className="flex space-x-2 mb-4 overflow-x-auto">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => handleTimeframeChange(tf.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                timeframe === tf.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-4">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {isLoading && candleData.length === 0 ? (
          <div className="flex items-center justify-center h-96 bg-gray-900 rounded-lg">
            <div className="text-center">
              <RefreshCw className="w-8 h-8 animate-spin text-blue-400 mx-auto mb-2" />
              <p className="text-gray-400">Loading market data...</p>
            </div>
          </div>
        ) : candleData.length > 0 ? (
          <CandlestickChart
            data={candleData}
            volumeData={[]}
            height={500}
            showEMA={false}
            showVWAP={false}
          />
        ) : (
          <div className="flex items-center justify-center h-96 bg-gray-900 rounded-lg">
            <p className="text-gray-400">No data available</p>
          </div>
        )}

        <div className="mt-4 text-xs text-gray-500 text-center">
          Powered by Alpaca Markets • Paper Trading Data
        </div>
      </div>
    </div>
  );
};
