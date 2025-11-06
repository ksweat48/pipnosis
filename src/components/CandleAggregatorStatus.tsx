import React, { useEffect, useState } from 'react';
import { Activity, Database, TrendingUp, Clock } from 'lucide-react';
import { backgroundCandleAggregator } from '@/services/background-candle-aggregator';
import { Timeframe } from '@/services/chart-preferences';

interface AggregatorStatus {
  isRunning: boolean;
  activeCandleStates: number;
  saveQueueLength: number;
  listenerCount: number;
  symbols: number;
  timeframes: number;
  totalCombinations: number;
}

interface SymbolCandlePrices {
  [timeframe: string]: number | null;
}

export function CandleAggregatorStatus() {
  const [status, setStatus] = useState<AggregatorStatus | null>(null);
  const [symbolPrices, setSymbolPrices] = useState<Map<string, SymbolCandlePrices>>(new Map());
  const [updateCount, setUpdateCount] = useState(0);

  useEffect(() => {
    const updateStatus = () => {
      const currentStatus = backgroundCandleAggregator.getStatus();
      setStatus(currentStatus);
    };

    updateStatus();
    const interval = setInterval(updateStatus, 5000);

    const unsubscribe = backgroundCandleAggregator.onCandleUpdate((symbol, timeframe, candle) => {
      setSymbolPrices(prev => {
        const newMap = new Map(prev);
        const symbolData = newMap.get(symbol) || {};
        symbolData[timeframe] = candle.close;
        newMap.set(symbol, symbolData);
        return newMap;
      });
      setUpdateCount(c => c + 1);
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, []);

  if (!status) {
    return null;
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex items-center gap-2 mb-4">
        <Database className="text-blue-400" size={20} />
        <h3 className="text-white font-semibold">Background Candle Aggregator</h3>
        <div className={`ml-auto flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
          status.isRunning ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
        }`}>
          <div className={`w-2 h-2 rounded-full ${status.isRunning ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
          {status.isRunning ? 'Running' : 'Stopped'}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div className="bg-gray-900/50 rounded-lg p-3">
          <div className="text-gray-400 text-xs mb-1">Active States</div>
          <div className="text-white text-2xl font-bold">{status.activeCandleStates}</div>
          <div className="text-gray-500 text-xs mt-1">of {status.totalCombinations}</div>
        </div>

        <div className="bg-gray-900/50 rounded-lg p-3">
          <div className="text-gray-400 text-xs mb-1">Save Queue</div>
          <div className="text-white text-2xl font-bold">{status.saveQueueLength}</div>
          <div className="text-gray-500 text-xs mt-1">pending saves</div>
        </div>

        <div className="bg-gray-900/50 rounded-lg p-3">
          <div className="text-gray-400 text-xs mb-1">Updates</div>
          <div className="text-emerald-400 text-2xl font-bold">{updateCount}</div>
          <div className="text-gray-500 text-xs mt-1">total received</div>
        </div>

        <div className="bg-gray-900/50 rounded-lg p-3">
          <div className="text-gray-400 text-xs mb-1">Listeners</div>
          <div className="text-blue-400 text-2xl font-bold">{status.listenerCount}</div>
          <div className="text-gray-500 text-xs mt-1">active charts</div>
        </div>
      </div>

      <div className="flex items-center gap-4 text-sm text-gray-400">
        <div className="flex items-center gap-2">
          <TrendingUp size={14} />
          <span>{status.symbols} pairs</span>
        </div>
        <div className="flex items-center gap-2">
          <Clock size={14} />
          <span>{status.timeframes} timeframes</span>
        </div>
        <div className="flex items-center gap-2">
          <Activity size={14} />
          <span>{status.totalCombinations} combinations</span>
        </div>
      </div>

      {symbolPrices.size > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-700">
          <div className="text-gray-400 text-xs mb-2">Latest Prices (All Timeframes)</div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-48 overflow-y-auto">
            {Array.from(symbolPrices.entries()).map(([symbol, prices]) => {
              const latestPrice = prices['M1'] || prices['M5'] || prices['M15'] || Object.values(prices)[0];
              return (
                <div key={symbol} className="bg-gray-900/30 rounded px-2 py-1">
                  <div className="text-white text-xs font-medium">{symbol}</div>
                  {latestPrice && (
                    <div className="text-emerald-400 text-xs font-mono">{latestPrice.toFixed(5)}</div>
                  )}
                  <div className="text-gray-500 text-xs">
                    {Object.keys(prices).length} TFs
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
