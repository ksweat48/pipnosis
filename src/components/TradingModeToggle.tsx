import React, { useState } from 'react';
import { Bot, Hand } from 'lucide-react';
import { ManualTradePanel } from './ManualTradePanel';
import { AITradingConsole } from './AITradingConsole';

interface TradingModeToggleProps {
  symbol: string;
  onTradeExecuted?: () => void;
}

export function TradingModeToggle({ symbol, onTradeExecuted }: TradingModeToggleProps) {
  const [activeMode, setActiveMode] = useState<'manual' | 'ai'>('manual');

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 shadow-lg overflow-hidden">
      <div className="flex items-center justify-center p-2 bg-gray-800/50 border-b border-gray-700">
        <div className="inline-flex rounded-lg bg-gray-900 p-1 gap-1">
          <button
            onClick={() => setActiveMode('manual')}
            className={`
              flex items-center space-x-2 px-6 py-2.5 rounded-md font-medium transition-all duration-200
              ${activeMode === 'manual'
                ? 'bg-gradient-to-r from-green-600 to-emerald-600 text-white shadow-lg shadow-green-500/30'
                : 'bg-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }
            `}
          >
            <Hand className="w-4 h-4" />
            <span>Manual Trading</span>
          </button>

          <button
            onClick={() => setActiveMode('ai')}
            className={`
              flex items-center space-x-2 px-6 py-2.5 rounded-md font-medium transition-all duration-200
              ${activeMode === 'ai'
                ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-lg shadow-blue-500/30'
                : 'bg-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }
            `}
          >
            <Bot className="w-4 h-4" />
            <span>AI Trading</span>
          </button>
        </div>
      </div>

      <div className="transition-all duration-300 ease-in-out">
        {activeMode === 'manual' ? (
          <div className="animate-fadeIn">
            <ManualTradePanel
              symbol={symbol}
              onTradeExecuted={onTradeExecuted}
            />
          </div>
        ) : (
          <div className="animate-fadeIn p-4">
            <AITradingConsole />
          </div>
        )}
      </div>
    </div>
  );
}
