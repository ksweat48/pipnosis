import React, { useEffect, useState } from 'react';
import { forexApi, ForexPrice, ForexCandle, Timeframe } from '../services/forex-api';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';

interface SimpleForexChartProps {
  symbol?: string;
  timeframe?: Timeframe;
}

export const SimpleForexChart: React.FC<SimpleForexChartProps> = ({
  symbol = 'EURUSD',
  timeframe = 'M15'
}) => {
  const [price, setPrice] = useState<ForexPrice | null>(null);
  const [candles, setCandles] = useState<ForexCandle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    let stopPolling: (() => void) | null = null;

    const initialize = async () => {
      try {
        setLoading(true);
        setError(null);

        const [initialPrice, initialCandles] = await Promise.all([
          forexApi.getCurrentPrice(symbol),
          forexApi.getCandles(symbol, timeframe, 50)
        ]);

        setPrice(initialPrice);
        setCandles(initialCandles);
        setIsLive(true);

        stopPolling = forexApi.startPricePolling(symbol, (newPrice) => {
          setPrice(newPrice);
        }, 2000);

        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
        setLoading(false);
        setIsLive(false);
      }
    };

    initialize();

    return () => {
      if (stopPolling) {
        stopPolling();
      }
    };
  }, [symbol, timeframe]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 bg-gray-800 rounded-lg">
        <Activity className="w-6 h-6 text-blue-400 animate-spin mr-2" />
        <span className="text-gray-300">Loading forex data...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 bg-red-900/20 border border-red-500 rounded-lg">
        <p className="text-red-400">Error: {error}</p>
        <p className="text-gray-400 text-sm mt-2">
          Make sure METAAPI_TOKEN, METAAPI_ACCOUNT_ID, and METAAPI_REGION are set in your .env file
        </p>
      </div>
    );
  }

  const lastCandle = candles[candles.length - 1];
  const prevCandle = candles[candles.length - 2];
  const priceChange = lastCandle && prevCandle ? lastCandle.close - prevCandle.close : 0;
  const priceChangePercent = prevCandle ? (priceChange / prevCandle.close) * 100 : 0;
  const isUp = priceChange >= 0;

  return (
    <div className="bg-gray-800 rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-white">{symbol}</h3>
          <p className="text-sm text-gray-400">{timeframe} Timeframe</p>
        </div>
        <div className="flex items-center gap-2">
          {isLive && (
            <div className="flex items-center gap-1 text-green-400 text-sm">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              <span>Live</span>
            </div>
          )}
        </div>
      </div>

      {price && (
        <div className="bg-gray-900 rounded-lg p-4 space-y-3">
          <div className="flex items-baseline gap-3">
            <div className="text-3xl font-bold text-white">
              {price.bid.toFixed(5)}
            </div>
            <div className={`flex items-center gap-1 ${isUp ? 'text-green-400' : 'text-red-400'}`}>
              {isUp ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
              <span className="text-lg font-semibold">
                {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(5)} ({priceChangePercent.toFixed(2)}%)
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-gray-400">Bid</p>
              <p className="text-white font-semibold">{price.bid.toFixed(5)}</p>
            </div>
            <div>
              <p className="text-gray-400">Ask</p>
              <p className="text-white font-semibold">{price.ask.toFixed(5)}</p>
            </div>
            <div>
              <p className="text-gray-400">Spread</p>
              <p className="text-white font-semibold">{price.spread?.toFixed(5) || '0.00000'}</p>
            </div>
          </div>

          <div className="text-xs text-gray-500">
            Last updated: {new Date(price.timestamp).toLocaleTimeString()}
          </div>
        </div>
      )}

      {candles.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-300 mb-2">Recent Candles</h4>
          <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="text-left py-2">Time</th>
                  <th className="text-right py-2">Open</th>
                  <th className="text-right py-2">High</th>
                  <th className="text-right py-2">Low</th>
                  <th className="text-right py-2">Close</th>
                </tr>
              </thead>
              <tbody>
                {candles.slice(-10).reverse().map((candle, idx) => {
                  const candleChange = candle.close - candle.open;
                  const isBullish = candleChange >= 0;
                  return (
                    <tr key={idx} className="border-b border-gray-800">
                      <td className="py-2 text-gray-300">
                        {new Date(candle.open_time).toLocaleTimeString()}
                      </td>
                      <td className="text-right text-white">{candle.open.toFixed(5)}</td>
                      <td className="text-right text-green-400">{candle.high.toFixed(5)}</td>
                      <td className="text-right text-red-400">{candle.low.toFixed(5)}</td>
                      <td className={`text-right font-semibold ${isBullish ? 'text-green-400' : 'text-red-400'}`}>
                        {candle.close.toFixed(5)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Showing last 10 of {candles.length} candles
          </p>
        </div>
      )}
    </div>
  );
};
