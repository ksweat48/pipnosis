import React, { useEffect, useRef, useState } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';

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

export const MarketChart: React.FC<MarketChartProps> = ({
  symbol,
  onSymbolChange,
  tradeLines,
  className = ""
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const availablePairs = ['EURUSD', 'GBPUSD', 'XAUUSD'];

  useEffect(() => {
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      setLastUpdate(new Date());
    }, 1000);
  }, [symbol]);

  const generateMockPrice = (symbol: string) => {
    const basePrices = { 'EURUSD': 1.1425, 'GBPUSD': 1.2735, 'XAUUSD': 2045.50 };
    const basePrice = basePrices[symbol as keyof typeof basePrices] || 1.1425;
    const isGold = symbol === 'XAUUSD';
    const variation = isGold ? (Math.random() - 0.5) * 20 : (Math.random() - 0.5) * 0.02;
    return basePrice + variation;
  };

  const currentPrice = generateMockPrice(symbol);

  return (
    <div className={`bg-slate-800 rounded-xl border border-slate-700 ${className}`}>
      <div className="p-4 sm:p-6 border-b border-slate-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-emerald-500/20 rounded-lg">
              <BarChart3 className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Live Market Chart</h3>
              <p className="text-sm text-slate-400">Real-time price action</p>
            </div>
            {isLoading && <RefreshCw className="h-4 w-4 text-emerald-400 animate-spin" />}
          </div>
          
          <div className="flex items-center space-x-3">
            <select
              value={symbol}
              onChange={(e) => onSymbolChange(e.target.value)}
              className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {availablePairs.map(pair => (
                <option key={pair} value={pair}>{pair}</option>
              ))}
            </select>
            
            <div className="text-xs text-slate-400 text-right">
              <div>M15 Timeframe</div>
              <div>{lastUpdate ? lastUpdate.toLocaleTimeString() : 'Loading...'}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="relative bg-slate-900 h-96 flex items-center justify-center">
        {isLoading ? (
          <div className="text-center">
            <RefreshCw className="h-8 w-8 text-emerald-400 animate-spin mx-auto mb-2" />
            <p className="text-slate-400 text-sm">Loading {symbol} chart...</p>
          </div>
        ) : (
          <div className="text-center">
            <div className="text-4xl font-bold text-white mb-2">
              {currentPrice.toFixed(symbol === 'XAUUSD' ? 2 : 5)}
            </div>
            <div className="text-slate-400 mb-4">{symbol} Current Price</div>
            <div className="w-full max-w-md h-32 bg-gradient-to-r from-emerald-500/20 to-green-500/20 rounded-lg flex items-center justify-center">
              <BarChart3 className="h-16 w-16 text-emerald-400 opacity-50" />
            </div>
          </div>
        )}
      </div>

      {tradeLines && Object.keys(tradeLines).length > 0 && (
        <div className="p-4 sm:p-6 border-t border-slate-700 bg-slate-900/50">
          <div className="flex flex-col space-y-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
            <h4 className="text-sm font-medium text-white">AI Trade Levels</h4>
            <div className="flex flex-wrap items-center gap-4 text-xs">
              {tradeLines.entry && (
                <div className="flex items-center space-x-1">
                  <div className="w-4 h-0.5 bg-emerald-500 rounded"></div>
                  <span className="text-emerald-300 font-medium">Entry: {tradeLines.entry.toFixed(symbol === 'XAUUSD' ? 2 : 5)}</span>
                </div>
              )}
              {tradeLines.stopLoss && (
                <div className="flex items-center space-x-1">
                  <div className="w-4 h-0.5 bg-red-500 rounded"></div>
                  <span className="text-red-300 font-medium">SL: {tradeLines.stopLoss.toFixed(symbol === 'XAUUSD' ? 2 : 5)}</span>
                </div>
              )}
              {tradeLines.takeProfit && (
                <div className="flex items-center space-x-1">
                  <div className="w-4 h-0.5 bg-green-500 rounded"></div>
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