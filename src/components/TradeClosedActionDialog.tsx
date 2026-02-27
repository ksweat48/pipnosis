import React, { useEffect, useState } from 'react';
import { AlertCircle, TrendingUp, Target, PauseCircle, RotateCcw, Clock, X } from 'lucide-react';
import {
  detectTrueCloseReason,
  getCloseReasonText,
  getCloseReasonColor
} from '@/utils/close-reason-detector';
import { formatPositionPrice } from '@/utils/displayFormatters';

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

/**
 * Two-tier price display: large integer part, smaller decimal part on new line.
 * SSOT: uses formatPositionPrice from displayFormatters for symbol-correct decimals.
 * Prevents overflow for large-number pairs (XAUUSD, US30, BTC, etc.)
 */
function PriceDisplay({ price, symbol }: { price: number; symbol: string }) {
  const formatted = formatPositionPrice(price, symbol);
  const dotIndex = formatted.indexOf('.');
  const intPart = dotIndex >= 0 ? formatted.slice(0, dotIndex) : formatted;
  const decPart = dotIndex >= 0 ? formatted.slice(dotIndex) : '';

  return (
    <div className="leading-none">
      <span className="text-sm font-mono font-semibold text-gray-200">{intPart}</span>
      {decPart && (
        <div className="text-[10px] font-mono text-gray-400 mt-0.5">{decPart}</div>
      )}
    </div>
  );
}

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
  if (!isOpen) return null;

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

  useEffect(() => {
    if (isOpen) setTimeRemaining(timeoutDuration);
  }, [isOpen, timeoutDuration]);

  useEffect(() => {
    if (!isOpen || isPendingModal) return;

    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1000) {
          clearInterval(interval);
          onCloseForNow();
          return 0;
        }
        return prev - 1000;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen, isPendingModal, onCloseForNow]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseForNow();
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

  const formatTimeElapsed = (ts: string): string => {
    const diffMs = Date.now() - new Date(ts).getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays > 0) return `${diffDays}d ago`;
    if (diffHours > 0) return `${diffHours}h ago`;
    if (diffMins > 0) return `${diffMins}m ago`;
    return 'Just now';
  };

  const isUnrealisticPnL = Math.abs(safeProfitLoss) > 1000;
  let displayProfitLoss = safeProfitLoss;
  let showWarning = false;

  if (isUnrealisticPnL) {
    console.error('[TradeClosedActionDialog] Unrealistic P&L detected:', { profitLoss: safeProfitLoss, symbol });
    const correctedPnL = safeProfitLoss / 100;
    if (Math.abs(correctedPnL) >= 1 && Math.abs(correctedPnL) <= 500) {
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

  const getReasonIcon = () => {
    if (displayReason === 'stop_loss') return <AlertCircle className="w-5 h-5 text-white" />;
    if (['take_profit', 'take_profit_1', 'take_profit_2'].includes(displayReason)) return <TrendingUp className="w-5 h-5 text-white" />;
    if (['goal_achieved', 'goal_met'].includes(displayReason)) return <Target className="w-5 h-5 text-white" />;
    return <PauseCircle className="w-5 h-5 text-white" />;
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

      <div className="relative w-full max-w-md animate-in zoom-in-95 duration-300">
        <div className="absolute -inset-px bg-gradient-to-r from-blue-500 to-cyan-500 rounded-2xl opacity-40 blur-lg" />

        <div className="relative bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-2xl border border-gray-700/50 shadow-2xl overflow-hidden max-h-[88dvh] flex flex-col">
          <div className="overflow-y-auto flex-1 overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>

            {/* Header */}
            <div className="relative pt-4 pb-3 px-4">
              <div className={`absolute inset-0 bg-gradient-to-b ${reasonColor} opacity-10`} />

              <button
                onClick={onCloseForNow}
                disabled={isLoading}
                className="absolute top-3 right-3 p-1.5 rounded-lg bg-gray-800/60 hover:bg-gray-700/60 transition-colors disabled:opacity-50 z-10"
              >
                <X className="w-4 h-4 text-gray-400" />
              </button>

              <div className="relative flex items-center gap-3 pr-8">
                <div className={`p-2.5 bg-gradient-to-r ${reasonColor} rounded-xl shadow-md shrink-0`}>
                  {getReasonIcon()}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-bold text-white leading-tight">{reasonText}</h2>
                  {smartCloseResult.isOverride && smartCloseResult.confidence === 'high' && (
                    <span className="text-[10px] text-yellow-400">Price-based detection</span>
                  )}
                  <p className="text-xs text-gray-400 mt-0.5">
                    {isSystemClosure ? 'Your session has ended.' : 'What would you like to do next?'}
                  </p>
                </div>
              </div>

              {/* Countdown / Timestamp */}
              <div className="mt-3">
                {isPendingModal ? (
                  <div className="flex items-center justify-center gap-1.5 text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg py-1.5 px-3">
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-amber-300 font-medium">Trade closed {formatTimeElapsed(timestamp)}</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-1.5 text-xs text-gray-500">
                    <Clock className="w-3 h-3" />
                    <span>Auto-close in <span className="font-semibold text-gray-400">{formatTime(timeRemaining)}</span></span>
                  </div>
                )}
              </div>
            </div>

            {/* Body */}
            <div className="px-4 pb-4 space-y-3">
              {/* Trade Summary card */}
              <div className="bg-gray-800/50 rounded-xl p-3 border border-gray-700/50">
                <div className="flex items-center justify-between mb-2.5">
                  <div>
                    <div className="text-[10px] text-gray-400 uppercase tracking-wide">Symbol</div>
                    <div className="text-base font-bold text-white">{symbol}</div>
                  </div>
                  <div className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                    direction === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                  }`}>
                    {direction.toUpperCase()}
                  </div>
                </div>

                {/* Entry / Exit prices - two-tier display */}
                <div className="grid grid-cols-2 gap-2 mb-2.5">
                  <div className="bg-gray-900/40 rounded-lg p-2 border border-gray-700/30">
                    <div className="text-[10px] text-gray-400 mb-1">Entry</div>
                    <PriceDisplay price={safeEntryPrice} symbol={symbol} />
                  </div>
                  <div className="bg-gray-900/40 rounded-lg p-2 border border-gray-700/30">
                    <div className="text-[10px] text-gray-400 mb-1">Exit</div>
                    <PriceDisplay price={safeExitPrice} symbol={symbol} />
                  </div>
                </div>

                {/* P&L */}
                <div className="pt-2.5 border-t border-gray-700/60">
                  {tp1Pnl != null && tp2Pnl != null ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="text-[10px] text-gray-400">Leg 1 (TP1)</div>
                        <div className={`text-xs font-semibold ${tp1Pnl >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
                          {tp1Pnl >= 0 ? '+' : ''}${Math.abs(tp1Pnl).toFixed(2)}
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-[10px] text-gray-400">Leg 2 (TP2)</div>
                        <div className={`text-xs font-semibold ${tp2Pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {tp2Pnl >= 0 ? '+' : ''}${Math.abs(tp2Pnl).toFixed(2)}
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-1.5 border-t border-gray-700/50">
                        <div className="text-[10px] text-gray-400">Total</div>
                        <div className={`text-lg font-bold ${isProfit ? 'text-emerald-400' : isLoss ? 'text-red-400' : 'text-gray-400'}`}>
                          {isProfit ? '+' : ''}${Math.abs(displayProfitLoss).toFixed(2)}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] text-gray-400">Result</div>
                      <div className={`text-lg font-bold ${isProfit ? 'text-emerald-400' : isLoss ? 'text-red-400' : 'text-gray-400'}`}>
                        {isProfit ? '+' : ''}${Math.abs(displayProfitLoss).toFixed(2)}
                      </div>
                    </div>
                  )}
                  {showWarning && (
                    <div className="mt-1.5 text-[10px] text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded px-2 py-1">
                      Value auto-corrected from display error
                    </div>
                  )}
                </div>
              </div>

              {/* Session Progress */}
              <div className="bg-gray-800/30 rounded-xl p-3 border border-gray-700/30">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-[10px] text-gray-400">Session Progress</div>
                  <div className="text-[10px] font-semibold text-white">{progressPercent.toFixed(1)}%</div>
                </div>

                <div className="relative w-full bg-gray-700 rounded-full h-1.5 mb-2.5">
                  <div
                    className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(progressPercent, 100)}%` }}
                  />
                </div>

                <div className="grid grid-cols-3 gap-1 text-[10px]">
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

                <div className="mt-1.5 text-[10px] text-gray-500">
                  {safeTradesInSession} trade{safeTradesInSession !== 1 ? 's' : ''} in session
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2">
                {isSystemClosure && !isGoalAchieved ? (
                  <>
                    <button
                      onClick={onStartNewSession}
                      disabled={isLoading}
                      className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-blue-600 hover:from-emerald-500 hover:to-blue-500 rounded-xl font-semibold text-sm text-white transition-all duration-200 shadow-lg hover:shadow-emerald-500/25 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Start New Session
                    </button>
                    <button
                      onClick={onCloseForNow}
                      disabled={isLoading}
                      className="w-full py-3 px-4 bg-gray-700/50 hover:bg-gray-700 rounded-xl font-semibold text-sm text-white transition-all duration-200 border border-gray-600/50 hover:border-gray-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      <PauseCircle className="w-4 h-4" />
                      Close Session
                    </button>
                  </>
                ) : isGoalAchieved ? (
                  <>
                    <button
                      onClick={onCloseForNow}
                      disabled={isLoading}
                      className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-blue-600 hover:from-emerald-500 hover:to-blue-500 rounded-xl font-semibold text-sm text-white transition-all duration-200 shadow-lg hover:shadow-emerald-500/25 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      <PauseCircle className="w-4 h-4" />
                      Close Session
                    </button>
                    <button
                      onClick={onStartNewSession}
                      disabled={isLoading}
                      className="w-full py-2 px-4 text-emerald-400 hover:text-emerald-300 transition-colors text-xs disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Start New Session Immediately
                    </button>
                  </>
                ) : (
                  <button
                    onClick={onCloseForNow}
                    disabled={isLoading}
                    className="w-full py-3 px-4 bg-gray-700/50 hover:bg-gray-700 rounded-xl font-semibold text-sm text-white transition-all duration-200 border border-gray-600/50 hover:border-gray-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <PauseCircle className="w-4 h-4" />
                    Close Session
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
