import React, { useEffect, useState } from 'react';
import { AlertCircle, TrendingUp, TrendingDown, Target, PlayCircle, PauseCircle, RotateCcw, Clock } from 'lucide-react';

interface TradeClosedActionDialogProps {
  isOpen: boolean;
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  exitPrice: number;
  profitLoss: number;
  closeReason: 'stop_loss' | 'take_profit' | 'manual' | 'goal_met';
  currentProgress: number;
  targetValue: number;
  tradesInSession: number;
  onStartNewSession: () => void;
  onContinueSession: () => void;
  onCloseForNow: () => void;
  isLoading?: boolean;
}

const TIMEOUT_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

export const TradeClosedActionDialog: React.FC<TradeClosedActionDialogProps> = ({
  isOpen,
  symbol,
  direction,
  entryPrice,
  exitPrice,
  profitLoss,
  closeReason,
  currentProgress,
  targetValue,
  tradesInSession,
  onStartNewSession,
  onContinueSession,
  onCloseForNow,
  isLoading = false
}) => {
  const [timeRemaining, setTimeRemaining] = useState(TIMEOUT_DURATION);

  // Reset timer when dialog opens
  useEffect(() => {
    if (isOpen) {
      setTimeRemaining(TIMEOUT_DURATION);
    }
  }, [isOpen]);

  // Countdown timer
  useEffect(() => {
    if (!isOpen) return;

    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1000) {
          clearInterval(interval);
          onContinueSession(); // Auto-continue session
          return 0;
        }
        return prev - 1000;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen, onContinueSession]);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onContinueSession(); // Default action on escape
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onContinueSession]);

  if (!isOpen) return null;

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const isProfit = profitLoss > 0;
  const isLoss = profitLoss < 0;
  const progressPercent = (currentProgress / targetValue) * 100;
  const remaining = targetValue - currentProgress;

  const getReasonText = () => {
    switch (closeReason) {
      case 'stop_loss':
        return 'Stop Loss Hit';
      case 'take_profit':
        return 'Take Profit Hit';
      case 'manual':
        return 'Manually Closed';
      case 'goal_met':
        return 'Goal Achieved';
      default:
        return 'Trade Closed';
    }
  };

  const getReasonColor = () => {
    switch (closeReason) {
      case 'stop_loss':
        return 'from-red-500 to-orange-500';
      case 'take_profit':
      case 'goal_met':
        return 'from-emerald-500 to-blue-500';
      default:
        return 'from-gray-500 to-gray-600';
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      {/* Blocking overlay - prevents all interactions */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

      <div className="relative w-full max-w-lg animate-in zoom-in-95 duration-300">
        <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-2xl opacity-50 blur-xl" />

        <div className="relative bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-2xl border border-gray-700/50 shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="relative pt-6 pb-4 px-6">
            <div className={`absolute inset-0 bg-gradient-to-b ${getReasonColor()} opacity-10`} />

            <div className="relative flex items-center justify-center mb-3">
              <div className={`p-3 bg-gradient-to-r ${getReasonColor()} rounded-xl shadow-lg`}>
                {closeReason === 'stop_loss' && <AlertCircle className="w-6 h-6 text-white" />}
                {closeReason === 'take_profit' && <TrendingUp className="w-6 h-6 text-white" />}
                {closeReason === 'goal_met' && <Target className="w-6 h-6 text-white" />}
                {closeReason === 'manual' && <PauseCircle className="w-6 h-6 text-white" />}
              </div>
            </div>

            <h2 className="text-2xl font-bold text-white text-center mb-1">
              {getReasonText()}
            </h2>
            <p className="text-gray-400 text-sm text-center mb-2">
              What would you like to do next?
            </p>

            {/* Countdown Timer */}
            <div className="flex items-center justify-center gap-2 text-xs">
              <Clock className="w-3 h-3 text-gray-500" />
              <span className="text-gray-500">
                Auto-continue in <span className="font-semibold text-gray-400">{formatTime(timeRemaining)}</span>
              </span>
            </div>
          </div>

          {/* Trade Summary */}
          <div className="px-6 pb-6">
            <div className="bg-gray-800/50 rounded-xl p-4 mb-4 border border-gray-700/50">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-xs text-gray-400">Symbol</div>
                  <div className="text-lg font-bold text-white">{symbol}</div>
                </div>
                <div className={`px-3 py-1 rounded-full text-xs font-semibold ${
                  direction === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                }`}>
                  {direction.toUpperCase()}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <div className="text-xs text-gray-400">Entry Price</div>
                  <div className="text-sm font-mono text-gray-300">{entryPrice.toFixed(5)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400">Exit Price</div>
                  <div className="text-sm font-mono text-gray-300">{exitPrice.toFixed(5)}</div>
                </div>
              </div>

              <div className="pt-3 border-t border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-gray-400">Result</div>
                  <div className={`text-xl font-bold ${
                    isProfit ? 'text-emerald-400' : isLoss ? 'text-red-400' : 'text-gray-400'
                  }`}>
                    {isProfit ? '+' : ''}{profitLoss >= 0 ? '$' : '-$'}{Math.abs(profitLoss).toFixed(2)}
                  </div>
                </div>
              </div>
            </div>

            {/* Session Progress */}
            <div className="bg-gray-800/30 rounded-xl p-4 mb-6 border border-gray-700/30">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-gray-400">Session Progress</div>
                <div className="text-xs font-semibold text-white">{progressPercent.toFixed(1)}%</div>
              </div>

              <div className="relative w-full bg-gray-700 rounded-full h-2 mb-3">
                <div
                  className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(progressPercent, 100)}%` }}
                />
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-gray-500">Current</div>
                  <div className="font-semibold text-white">${currentProgress.toFixed(0)}</div>
                </div>
                <div>
                  <div className="text-gray-500">Remaining</div>
                  <div className="font-semibold text-white">${remaining.toFixed(0)}</div>
                </div>
                <div>
                  <div className="text-gray-500">Target</div>
                  <div className="font-semibold text-white">${targetValue.toFixed(0)}</div>
                </div>
              </div>

              <div className="mt-2 text-xs text-gray-400">
                {tradesInSession} trade{tradesInSession !== 1 ? 's' : ''} executed in this session
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-3">
              <button
                onClick={onContinueSession}
                disabled={isLoading}
                className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-blue-600 hover:from-emerald-500 hover:to-blue-500 rounded-xl font-semibold text-white transition-all duration-300 shadow-lg hover:shadow-emerald-500/25 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <PlayCircle className="w-5 h-5" />
                Continue Current Session
              </button>

              <button
                onClick={onStartNewSession}
                disabled={isLoading}
                className="w-full py-3 px-4 bg-gray-700/50 hover:bg-gray-700 rounded-xl font-semibold text-white transition-all duration-300 border border-gray-600/50 hover:border-gray-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-5 h-5" />
                Start Fresh Session
              </button>

              <button
                onClick={onCloseForNow}
                disabled={isLoading}
                className="w-full py-2 px-4 text-gray-400 hover:text-white transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <PauseCircle className="w-4 h-4" />
                Close for Now
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
