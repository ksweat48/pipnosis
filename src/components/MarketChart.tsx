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
          
          <div className="text-right">
            <div className="text-xs sm:text-sm text-white/50 font-medium">M15</div>
            <div className="text-xs text-white/40">{lastUpdate ? lastUpdate.toLocaleTimeString([], {timeStyle: 'short'}) : 'Loading...'}</div>
          </div>
        </div>
      </div>
      <div className="relative bg-gradient-to-br from-slate-900/50 to-slate-800/50 backdrop-blur-sm rounded-2xl border border-white/10 h-64 sm:h-80 lg:h-96 flex items-center justify-center overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/5 to-green-500/5"></div>
        <div className="absolute inset-0" style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.05) 1px, transparent 0)',
          backgroundSize: '20px 20px'
        }}></div>
        
        {isLoading ? (
          <div className="text-center relative z-10">
            <div className="relative mb-6">
              <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/20 to-green-500/20 rounded-full blur-xl"></div>
              <RefreshCw className="relative h-8 w-8 sm:h-12 sm:w-12 text-emerald-400 animate-spin mx-auto" />
            </div>
            <p className="text-white/70 text-base sm:text-lg font-medium">Loading {symbol} chart...</p>
          </div>

        ) : (
          <div className="text-center relative z-10">
            <div className="text-3xl sm:text-4xl lg:text-6xl font-bold text-white mb-2 sm:mb-4 tracking-tight">
              {currentPrice.toFixed(symbol === 'XAUUSD' ? 2 : 5)}
            </div>
            <div className="text-white/60 mb-4 sm:mb-8 text-sm sm:text-base lg:text-lg font-medium">{symbol} Current Price</div>
            <div className="w-full max-w-lg h-24 sm:h-32 lg:h-40 bg-gradient-to-r from-emerald-500/10 to-green-500/10 rounded-2xl flex items-center justify-center border border-emerald-500/20">
              <BarChart3 className="h-12 w-12 sm:h-16 sm:w-16 lg:h-20 lg:w-20 text-emerald-400/50" />
            </div>
          </div>
        )}
      </div>

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