import React, { useEffect, useState } from 'react';
import { AlertCircle, TrendingUp, Target, PauseCircle, RotateCcw, Clock, X } from 'lucide-react';
import {
  detectTrueCloseReason,
  getCloseReasonText,
  getCloseReasonColor,
  CloseReason
} from '@/utils/close-reason-detector';

interface TradeClosedActionDialogProps {
  isOpen: boolean;
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  exitPrice: number;
  profitLoss: number;
  closeReason: string;
  stopLoss: number;
  takeProfit: number;
  currentProgress: number;
  targetValue: number;
  tradesInSession: number;
  isGoalAchieved: boolean;
  onStartNewSession: () => void;
  onContinueSession?: () => void;
  onCloseForNow: () => void;
  isLoading?: boolean;
  timestamp?: string;
  tp1Pnl?: number | null;
  tp2Pnl?: number | null;
}

const GOAL_ACHIEVED_TIMEOUT = 60 * 1000;
const SYSTEM_CLOSE_TIMEOUT = 60 * 1000;
const NORMAL_TIMEOUT = 5 * 60 * 1000;

export const TradeClosedActionDialog: React.FC<TradeClosedActionDialogProps> = ({
  isOpen,
  symbol = 'UNKNOWN',
  direction = 'buy',
  entryPrice = 0,
  exitPrice = 0,
  profitLoss = 0,
  closeReason = 'manual',
  stopLoss = 0,
  takeProfit = 0,
  currentProgress = 0,
  targetValue = 100,
  tradesInSession = 0,
  isGoalAchieved = false,
  onStartNewSession,
  onCloseForNow,
  isLoading = false,
  timestamp,
  tp1Pnl,
  tp2Pnl
}) => {
  // Safety check: validate required props
  if (!isOpen) return null;

  // Validate numeric values to prevent NaN/Infinity errors
  const safeEntryPrice = isFinite(entryPrice) ? entryPrice : 0;
  const safeExitPrice = isFinite(exitPrice) ? exitPrice : 0;
  const safeProfitLoss = isFinite(profitLoss) ? profitLoss : 0;
  const safeCurrentProgress = isFinite(currentProgress) ? currentProgress : 0;
  const safeTargetValue = isFinite(targetValue) && targetValue > 0 ? targetValue : 100;
  const safeTradesInSession = isFinite(tradesInSession) && tradesInSession >= 0 ? tradesInSession : 0;

  const smartCloseResult = detectTrueCloseReason({
    exitPrice: safeExitPrice,
    stopLoss,
    takeProfit,
    symbol,
    databaseCloseReason: closeReason
  });

  const displayReason = smartCloseResult.displayReason;
  const isSystemClosure = ['stop_loss', 'take_profit', 'take_profit_1', 'take_profit_2'].includes(displayReason);
  const timeoutDuration = isGoalAchieved ? GOAL_ACHIEVED_TIMEOUT
    : isSystemClosure ? SYSTEM_CLOSE_TIMEOUT
    : NORMAL_TIMEOUT;
  const [timeRemaining, setTimeRemaining] = useState(timeoutDuration);
  const isPendingModal = !!timestamp;

  // Reset timer when dialog opens
  useEffect(() => {
    if (isOpen) {
      setTimeRemaining(timeoutDuration);
    }
  }, [isOpen, timeoutDuration]);

  // Countdown timer (skip if this is a pending modal)
  useEffect(() => {
    if (!isOpen || isPendingModal) return;

    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1000) {
          clearInterval(interval);
          // SSOT COMPLIANCE: Always auto-close on timeout (safe default)
          // User must explicitly choose to continue
          onCloseForNow();
          return 0;
        }
        return prev - 1000;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen, isPendingModal, onCloseForNow]);

  // Helper to format time elapsed for pending modals
  const formatTimeElapsed = (ts: string): string => {
    const then = new Date(ts).getTime();
    const now = Date.now();
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays > 0) {
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    }
    if (diffHours > 0) {
      return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    }
    if (diffMins > 0) {
      return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    }
    return 'Just now';
  };

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseForNow();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onCloseForNow]);

  if (!isOpen) return null;

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Safety check: validate P&L is realistic
  // If PnL is > $1000, it's likely a calculation error (100x multiplier bug)
  const isUnrealisticPnL = Math.abs(safeProfitLoss) > 1000;
  let displayProfitLoss = safeProfitLoss;
  let showWarning = false;

  if (isUnrealisticPnL) {
    console.error('[TradeClosedActionDialog] Unrealistic P&L detected:', {
      profitLoss: safeProfitLoss,
      symbol,
      entryPrice: safeEntryPrice,
      exitPrice: safeExitPrice,
      warning: 'P&L exceeds $1,000 - possible calculation error (100x multiplier bug)'
    });

    // Attempt to fix by dividing by 100 if it looks like 100x error
    const correctedPnL = safeProfitLoss / 100;
    if (Math.abs(correctedPnL) >= 1 && Math.abs(correctedPnL) <= 500) {
      console.log('[TradeClosedActionDialog] Auto-correcting PnL from', safeProfitLoss, 'to', correctedPnL);
      displayProfitLoss = correctedPnL;
      showWarning = true;
    }
  }

  const isProfit = displayProfitLoss > 0;
  const isLoss = displayProfitLoss < 0;
  const progressPercent = safeTargetValue > 0 ? (safeCurrentProgress / safeTargetValue) * 100 : 0;
  const remaining = safeTargetValue - safeCurrentProgress;

  const reasonText = getCloseReasonText(displayReason);
  const reasonColor = getCloseReasonColor(displayReason);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
      {/* Blocking overlay - prevents all interactions */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

      <div className="relative w-full max-w-lg animate-in zoom-in-95 duration-300 max-h-[90vh] flex flex-col">
        <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-2xl opacity-50 blur-xl" />

        <div className="relative bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-2xl border border-gray-700/50 shadow-2xl overflow-hidden flex flex-col">
          {/* Scrollable content area */}
          <div className="overflow-y-auto flex-1 pb-safe" style={{ WebkitOverflowScrolling: 'touch', scrollBehavior: 'auto', maxHeight: 'calc(90vh - 2rem)' }}>
            {/* Header */}
            <div className="relative pt-6 pb-4 px-6">
            <div className={`absolute inset-0 bg-gradient-to-b ${reasonColor} opacity-10`} />

            <button
              onClick={onCloseForNow}
              disabled={isLoading}
              className="absolute top-4 right-4 p-2 rounded-lg bg-gray-800/50 hover:bg-gray-700/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed z-10"
              title="Close session"
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>

            <div className="relative flex items-center justify-center mb-3">
              <div className={`p-3 bg-gradient-to-r ${reasonColor} rounded-xl shadow-lg`}>
                {displayReason === 'stop_loss' && <AlertCircle className="w-6 h-6 text-white" />}
                {(displayReason === 'take_profit' || displayReason === 'take_profit_1' || displayReason === 'take_profit_2') && <TrendingUp className="w-6 h-6 text-white" />}
                {(displayReason === 'goal_achieved' || displayReason === 'goal_met') && <Target className="w-6 h-6 text-white" />}
                {displayReason === 'manual' && <PauseCircle className="w-6 h-6 text-white" />}
                {!['stop_loss', 'take_profit', 'take_profit_1', 'take_profit_2', 'goal_achieved', 'goal_met', 'manual'].includes(displayReason) && <PauseCircle className="w-6 h-6 text-white" />}
              </div>
            </div>

            <h2 className="text-2xl font-bold text-white text-center mb-1">
              {reasonText}
            </h2>
            {smartCloseResult.isOverride && smartCloseResult.confidence === 'high' && (
              <p className="text-xs text-yellow-400 text-center mb-1">
                (Price-based detection)
              </p>
            )}
            <p className="text-gray-400 text-sm text-center mb-2">
              {isSystemClosure ? 'Your session has ended.' : 'What would you like to do next?'}
            </p>

            {/* Countdown Timer or Timestamp */}
            {isPendingModal ? (
              <div className="flex items-center justify-center gap-2 text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg py-2 px-3">
                <Clock className="w-4 h-4 text-amber-400" />
                <span className="text-amber-300 font-medium">
                  Trade closed {formatTimeElapsed(timestamp)}
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 text-xs">
                <Clock className="w-3 h-3 text-gray-500" />
                <span className="text-gray-500">
                  Auto-close in <span className="font-semibold text-gray-400">{formatTime(timeRemaining)}</span>
                </span>
              </div>
            )}
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
                  <div className="text-sm font-mono text-gray-300">{safeEntryPrice.toFixed(5)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400">Exit Price</div>
                  <div className="text-sm font-mono text-gray-300">{safeExitPrice.toFixed(5)}</div>
                </div>
              </div>

              <div className="pt-3 border-t border-gray-700">
                {tp1Pnl != null && tp2Pnl != null ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-400">Leg 1 (TP1)</div>
                      <div className={`text-sm font-semibold ${tp1Pnl >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
                        {tp1Pnl >= 0 ? '+' : ''}{tp1Pnl >= 0 ? '$' : '-$'}{Math.abs(tp1Pnl).toFixed(2)}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-400">Leg 2 (TP2)</div>
                      <div className={`text-sm font-semibold ${tp2Pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {tp2Pnl >= 0 ? '+' : ''}{tp2Pnl >= 0 ? '$' : '-$'}{Math.abs(tp2Pnl).toFixed(2)}
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-1.5 border-t border-gray-700/60">
                      <div className="text-xs text-gray-400">Total Result</div>
                      <div className={`text-xl font-bold ${
                        isProfit ? 'text-emerald-400' : isLoss ? 'text-red-400' : 'text-gray-400'
                      }`}>
                        {isProfit ? '+' : ''}{displayProfitLoss >= 0 ? '$' : '-$'}{Math.abs(displayProfitLoss).toFixed(2)}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-gray-400">Result</div>
                    <div className={`text-xl font-bold ${
                      isProfit ? 'text-emerald-400' : isLoss ? 'text-red-400' : 'text-gray-400'
                    }`}>
                      {isProfit ? '+' : ''}{displayProfitLoss >= 0 ? '$' : '-$'}{Math.abs(displayProfitLoss).toFixed(2)}
                    </div>
                  </div>
                )}
                {showWarning && (
                  <div className="mt-2 text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded px-2 py-1">
                    Value auto-corrected from display error
                  </div>
                )}
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
                  <div className="font-semibold text-white">${safeCurrentProgress.toFixed(0)}</div>
                </div>
                <div>
                  <div className="text-gray-500">Remaining</div>
                  <div className="font-semibold text-white">${remaining.toFixed(0)}</div>
                </div>
                <div>
                  <div className="text-gray-500">Target</div>
                  <div className="font-semibold text-white">${safeTargetValue.toFixed(0)}</div>
                </div>
              </div>

              <div className="mt-2 text-xs text-gray-400">
                {safeTradesInSession} trade{safeTradesInSession !== 1 ? 's' : ''} executed in this session
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-3 pb-6">
              {isSystemClosure && !isGoalAchieved ? (
                <>
                  <div>
                    <button
                      onClick={onStartNewSession}
                      disabled={isLoading}
                      className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-blue-600 hover:from-emerald-500 hover:to-blue-500 rounded-xl font-semibold text-white transition-all duration-300 shadow-lg hover:shadow-emerald-500/25 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      <RotateCcw className="w-5 h-5" />
                      Start New Session
                    </button>
                    <p className="text-xs text-gray-500 mt-2 text-center">
                      Begin a fresh trading session with a new goal
                    </p>
                  </div>
                  <div>
                    <button
                      onClick={onCloseForNow}
                      disabled={isLoading}
                      className="w-full py-3 px-4 bg-gray-700/50 hover:bg-gray-700 rounded-xl font-semibold text-white transition-all duration-300 border border-gray-600/50 hover:border-gray-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      <PauseCircle className="w-4 h-4" />
                      Close Session
                    </button>
                    <p className="text-xs text-gray-500 mt-2 text-center">
                      Done for now. Start a new session later.
                    </p>
                  </div>
                </>
              ) : isGoalAchieved ? (
                <>
                  <div>
                    <button
                      onClick={onCloseForNow}
                      disabled={isLoading}
                      className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-blue-600 hover:from-emerald-500 hover:to-blue-500 rounded-xl font-semibold text-white transition-all duration-300 shadow-lg hover:shadow-emerald-500/25 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      <PauseCircle className="w-5 h-5" />
                      Close Session
                    </button>
                    <p className="text-xs text-gray-500 mt-2 text-center">
                      Permanently close this session. Start a new one when ready.
                    </p>
                  </div>
                  <button
                    onClick={onStartNewSession}
                    disabled={isLoading}
                    className="w-full py-2 px-4 text-emerald-400 hover:text-emerald-300 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Start New Session Immediately
                  </button>
                </>
              ) : (
                <>
                  <div>
                    <button
                      onClick={onCloseForNow}
                      disabled={isLoading}
                      className="w-full py-3 px-4 bg-gray-700/50 hover:bg-gray-700 rounded-xl font-semibold text-white transition-all duration-300 border border-gray-600/50 hover:border-gray-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      <PauseCircle className="w-4 h-4" />
                      Close Session
                    </button>
                    <p className="text-xs text-gray-500 mt-2 text-center">
                      Permanently close this session (cannot be resumed).
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
};
