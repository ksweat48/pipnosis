import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, AlertTriangle, Target, Clock, Zap } from 'lucide-react';

interface TradeEntryModalProps {
  isOpen: boolean;
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  confidence: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  setupType?: string;
  reasoning?: string;
  expectedProfit?: number;
  riskReward?: number;
  onDismiss: () => void;
  autoExecuted?: boolean;
  // Dual TP system
  tp1?: number;
  tp2?: number;
  tp1Confidence?: number;
}

export const TradeEntryModal: React.FC<TradeEntryModalProps> = ({
  isOpen,
  symbol,
  direction,
  entryPrice,
  stopLoss,
  takeProfit,
  lotSize,
  confidence,
  priority,
  setupType = 'Market Setup',
  reasoning,
  expectedProfit,
  riskReward,
  onDismiss,
  autoExecuted = true,
  tp1,
  tp2,
  tp1Confidence
}) => {
  const [countdown, setCountdown] = useState(30);

  useEffect(() => {
    if (!isOpen) {
      setCountdown(30);
      return;
    }

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          onDismiss();
          return 30;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, onDismiss]);

  if (!isOpen) return null;

  const getPriorityColor = () => {
    switch (priority) {
      case 'urgent':
        return 'from-red-500 to-orange-500';
      case 'high':
        return 'from-emerald-500 to-blue-500';
      case 'medium':
        return 'from-blue-500 to-cyan-500';
      default:
        return 'from-gray-500 to-gray-600';
    }
  };

  const getPriorityBadge = () => {
    const colors = {
      urgent: 'bg-red-500/20 text-red-400 border-red-500/50',
      high: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50',
      medium: 'bg-blue-500/20 text-blue-400 border-blue-500/50',
      low: 'bg-gray-500/20 text-gray-400 border-gray-500/50'
    };

    return (
      <div className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold border ${colors[priority]}`}>
        <Zap className="w-3 h-3" />
        {priority.toUpperCase()} PRIORITY
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200 overflow-y-auto">
      {/* Blocking overlay - prevents all interactions */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

      <div className="relative w-full max-w-2xl my-8 animate-in zoom-in-95 duration-300">
        {/* Glowing border effect */}
        <div className={`absolute -inset-1 bg-gradient-to-r ${getPriorityColor()} rounded-2xl opacity-75 blur-xl animate-pulse`} />

        <div className="relative bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-2xl border border-gray-700/50 shadow-2xl overflow-hidden">
          {/* Header with status */}
          <div className="relative pt-8 pb-6 px-8">
            <div className={`absolute inset-0 bg-gradient-to-b ${getPriorityColor()} opacity-10`} />

            <div className="relative flex items-center justify-center mb-4">
              <div className={`p-4 bg-gradient-to-r ${getPriorityColor()} rounded-2xl shadow-lg`}>
                <Zap className="w-8 h-8 text-white animate-pulse" />
              </div>
            </div>

            <h2 className="text-3xl font-bold text-white text-center mb-2">
              {autoExecuted ? '✅ Trade Executed!' : '📊 Trade Signal'}
            </h2>
            <p className="text-gray-300 text-center mb-3">
              {autoExecuted
                ? 'Trade automatically executed and now monitoring. You have 30 seconds to mirror this trade on your own platform if desired.'
                : 'Review this trade signal carefully'}
            </p>

            <div className="flex items-center justify-center gap-3">
              {getPriorityBadge()}
            </div>
          </div>

          {/* Trade Details */}
          <div className="px-8 pb-8">
            {/* Symbol and Direction */}
            <div className="bg-gray-800/70 rounded-xl p-6 mb-4 border border-gray-700/50">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-sm text-gray-400 mb-1">Symbol</div>
                  <div className="text-3xl font-bold text-white">{symbol}</div>
                </div>
                <div className={`px-6 py-3 rounded-xl text-xl font-bold ${
                  direction === 'buy'
                    ? 'bg-emerald-500/20 text-emerald-400 border-2 border-emerald-500/50'
                    : 'bg-red-500/20 text-red-400 border-2 border-red-500/50'
                }`}>
                  {direction === 'buy' ? (
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-6 h-6" />
                      BUY
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <TrendingDown className="w-6 h-6" />
                      SELL
                    </div>
                  )}
                </div>
              </div>

              {/* Price levels */}
              {tp1 && tp2 ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700/30">
                    <div className="text-xs text-gray-400 mb-1">Entry Price</div>
                    <div className="text-lg font-mono font-bold text-white">{entryPrice.toFixed(5)}</div>
                  </div>
                  <div className="bg-red-900/20 rounded-lg p-3 border border-red-500/30">
                    <div className="text-xs text-red-400 mb-1 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      Stop Loss
                    </div>
                    <div className="text-lg font-mono font-bold text-red-400">{stopLoss.toFixed(5)}</div>
                  </div>
                  <div className="bg-cyan-900/20 rounded-lg p-3 border border-cyan-500/30">
                    <div className="text-xs text-cyan-400 mb-1 flex items-center gap-1">
                      <Target className="w-3 h-3" />
                      TP1 (Conservative)
                    </div>
                    <div className="text-lg font-mono font-bold text-cyan-400">{tp1.toFixed(5)}</div>
                    {tp1Confidence && (
                      <div className="text-xs text-cyan-300 mt-1">{tp1Confidence}% likely</div>
                    )}
                  </div>
                  <div className="bg-emerald-900/20 rounded-lg p-3 border border-emerald-500/30">
                    <div className="text-xs text-emerald-400 mb-1 flex items-center gap-1">
                      <Target className="w-3 h-3" />
                      TP2 (Full Target)
                    </div>
                    <div className="text-lg font-mono font-bold text-emerald-400">{tp2.toFixed(5)}</div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700/30">
                    <div className="text-xs text-gray-400 mb-1">Entry Price</div>
                    <div className="text-lg font-mono font-bold text-white">{entryPrice.toFixed(5)}</div>
                  </div>
                  <div className="bg-red-900/20 rounded-lg p-3 border border-red-500/30">
                    <div className="text-xs text-red-400 mb-1 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      Stop Loss
                    </div>
                    <div className="text-lg font-mono font-bold text-red-400">{stopLoss.toFixed(5)}</div>
                  </div>
                  <div className="bg-emerald-900/20 rounded-lg p-3 border border-emerald-500/30">
                    <div className="text-xs text-emerald-400 mb-1 flex items-center gap-1">
                      <Target className="w-3 h-3" />
                      Take Profit
                    </div>
                    <div className="text-lg font-mono font-bold text-emerald-400">{takeProfit.toFixed(5)}</div>
                  </div>
                </div>
              )}
            </div>

            {/* Position Info */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/30">
                <div className="text-sm text-gray-400 mb-1">Position Size</div>
                <div className="text-2xl font-bold text-white">{lotSize.toFixed(3)} lots</div>
              </div>
              <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/30">
                <div className="text-sm text-gray-400 mb-1">Confidence</div>
                <div className="text-2xl font-bold text-white">{confidence}%</div>
                <div className="mt-1 w-full bg-gray-700 rounded-full h-2">
                  <div
                    className={`h-full rounded-full transition-all ${
                      confidence >= 80 ? 'bg-emerald-500' : confidence >= 70 ? 'bg-blue-500' : 'bg-yellow-500'
                    }`}
                    style={{ width: `${confidence}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Additional Stats */}
            {(expectedProfit || riskReward) && (
              <div className="grid grid-cols-2 gap-4 mb-4">
                {expectedProfit && (
                  <div className="bg-emerald-900/20 rounded-xl p-4 border border-emerald-500/20">
                    <div className="text-sm text-emerald-400 mb-1">Expected Profit</div>
                    <div className="text-xl font-bold text-emerald-400">${expectedProfit.toFixed(2)}</div>
                  </div>
                )}
                {riskReward && (
                  <div className="bg-blue-900/20 rounded-xl p-4 border border-blue-500/20">
                    <div className="text-sm text-blue-400 mb-1">Risk:Reward</div>
                    <div className="text-xl font-bold text-blue-400">1:{riskReward.toFixed(2)}</div>
                  </div>
                )}
              </div>
            )}

            {/* Setup Type and Reasoning */}
            {(setupType || reasoning) && (
              <div className="bg-gray-800/30 rounded-xl p-4 mb-6 border border-gray-700/20">
                {setupType && (
                  <div className="mb-2">
                    <span className="text-xs text-gray-400">Setup: </span>
                    <span className="text-sm font-semibold text-white">{setupType}</span>
                  </div>
                )}
                {reasoning && (
                  <div className="text-sm text-gray-300 leading-relaxed">{reasoning}</div>
                )}
              </div>
            )}

            {/* Auto-dismiss countdown */}
            <div className="bg-blue-900/20 rounded-xl p-4 mb-6 border border-blue-500/30">
              <div className="flex items-center justify-center gap-3 text-blue-300">
                <Clock className="w-4 h-4" />
                <span className="text-sm font-medium">
                  {autoExecuted
                    ? `Time to mirror on your platform: ${countdown} seconds remaining`
                    : `Auto-dismiss in ${countdown} seconds`
                  }
                </span>
              </div>
            </div>

            {/* Action Button */}
            <button
              onClick={onDismiss}
              className="w-full py-4 px-6 bg-gradient-to-r from-emerald-600 to-blue-600 hover:from-emerald-500 hover:to-blue-500 rounded-xl font-bold text-lg text-white transition-all duration-300 shadow-lg hover:shadow-emerald-500/25 hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2"
            >
              Got It!
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
