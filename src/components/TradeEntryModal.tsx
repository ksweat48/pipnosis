import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, AlertTriangle, Target, Clock, Zap, CheckCircle, XCircle } from 'lucide-react';
import { formatPositionPrice } from '../utils/displayFormatters';
import { CONFIDENCE_TIER_LABELS, normalizeTier, type ConfidenceTier } from '../config/confidence-tier';

interface TradeEntryModalProps {
  isOpen: boolean;
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  confidence: number;
  confidenceTier?: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  setupType?: string;
  reasoning?: string;
  expectedProfit?: number;
  riskReward?: number;
  onDismiss: () => void;
  onAccept?: () => void;
  onDecline?: () => void;
  autoExecuted?: boolean;
  tp1?: number;
  tp2?: number;
  tp1Confidence?: number;
}

/**
 * Two-tier price display: large integer part, smaller decimal part below.
 * Prevents overflow for large-number instruments (XAUUSD, US30, BTC, etc.)
 * SSOT: uses formatPositionPrice from displayFormatters for correct decimal places.
 */
function PriceDisplay({ price, symbol, color }: { price: number; symbol: string; color: string }) {
  const formatted = formatPositionPrice(price, symbol);
  const dotIndex = formatted.indexOf('.');
  const intPart = dotIndex >= 0 ? formatted.slice(0, dotIndex) : formatted;
  const decPart = dotIndex >= 0 ? formatted.slice(dotIndex) : '';

  return (
    <div className="leading-none">
      <span className={`text-base font-mono font-bold ${color}`}>{intPart}</span>
      {decPart && (
        <div className={`text-[10px] font-mono font-semibold ${color} opacity-80 mt-0.5`}>{decPart}</div>
      )}
    </div>
  );
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
  confidenceTier,
  priority,
  setupType = 'Market Setup',
  reasoning,
  expectedProfit,
  riskReward,
  onDismiss,
  onAccept,
  onDecline,
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

    setCountdown(30);
    let isMounted = true;

    const timer = setInterval(() => {
      if (!isMounted) return;

      setCountdown((prev) => {
        const newCount = prev - 1;
        if (newCount <= 0) {
          if (isMounted) onDismiss();
          return 0;
        }
        return newCount;
      });
    }, 1000);

    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const getPriorityColor = () => {
    switch (priority) {
      case 'urgent': return 'from-red-500 to-orange-500';
      case 'high': return 'from-emerald-500 to-blue-500';
      case 'medium': return 'from-blue-500 to-cyan-500';
      default: return 'from-gray-500 to-gray-600';
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
      <div className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${colors[priority]}`}>
        <Zap className="w-2.5 h-2.5" />
        {priority.toUpperCase()}
      </div>
    );
  };

  const handleAccept = () => {
    if (onAccept) onAccept();
    onDismiss();
  };

  const handleDecline = () => {
    if (onDecline) onDecline();
    onDismiss();
  };

  const hasDeclineOption = !!onDecline;
  const hasDualTP = !!(tp1 && tp2);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

      <div className="relative w-full max-w-md animate-in zoom-in-95 duration-300">
        <div className={`absolute -inset-px bg-gradient-to-r ${getPriorityColor()} rounded-2xl opacity-60 blur-lg animate-pulse`} />

        <div className="relative bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-2xl border border-gray-700/50 shadow-2xl overflow-hidden max-h-[88dvh] flex flex-col">
          <div className="overflow-y-auto flex-1 overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>

            {/* Header */}
            <div className="relative pt-4 pb-3 px-4">
              <div className={`absolute inset-0 bg-gradient-to-b ${getPriorityColor()} opacity-10`} />

              <div className="relative flex items-center gap-3">
                <div className={`p-2 bg-gradient-to-r ${getPriorityColor()} rounded-xl shadow-md shrink-0`}>
                  <Zap className="w-5 h-5 text-white animate-pulse" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-bold text-white leading-tight">
                      {autoExecuted ? 'Trade Executed' : 'Trade Signal'}
                    </h2>
                    {getPriorityBadge()}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 leading-snug">
                    {autoExecuted
                      ? hasDeclineOption
                        ? 'Accept to let it run or decline to void and close session.'
                        : 'Mirror this on your platform within 30 seconds.'
                      : 'Review this trade signal carefully'}
                  </p>
                </div>
              </div>
            </div>

            {/* Trade Details */}
            <div className="px-4 pb-4 space-y-3">
              {/* Symbol + Direction row */}
              <div className="flex items-center justify-between bg-gray-800/70 rounded-xl px-4 py-3 border border-gray-700/50">
                <div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Symbol</div>
                  <div className="text-xl font-bold text-white tracking-tight">{symbol}</div>
                </div>
                <div className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 ${
                  direction === 'buy'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                    : 'bg-red-500/20 text-red-400 border border-red-500/40'
                }`}>
                  {direction === 'buy'
                    ? <><TrendingUp className="w-4 h-4" />BUY</>
                    : <><TrendingDown className="w-4 h-4" />SELL</>
                  }
                </div>
              </div>

              {/* Price levels */}
              <div className={`grid gap-2 ${hasDualTP ? 'grid-cols-2' : 'grid-cols-3'}`}>
                <div className="bg-gray-900/60 rounded-lg p-2.5 border border-gray-700/30">
                  <div className="text-[10px] text-gray-400 mb-1.5">Entry</div>
                  <PriceDisplay price={entryPrice} symbol={symbol} color="text-white" />
                </div>
                <div className="bg-red-900/20 rounded-lg p-2.5 border border-red-500/30">
                  <div className="text-[10px] text-red-400 mb-1.5 flex items-center gap-0.5">
                    <AlertTriangle className="w-2.5 h-2.5" />SL
                  </div>
                  <PriceDisplay price={stopLoss} symbol={symbol} color="text-red-400" />
                </div>

                {hasDualTP ? (
                  <>
                    <div className="bg-cyan-900/20 rounded-lg p-2.5 border border-cyan-500/30">
                      <div className="text-[10px] text-cyan-400 mb-1.5 flex items-center gap-0.5">
                        <Target className="w-2.5 h-2.5" />TP1
                      </div>
                      <PriceDisplay price={tp1!} symbol={symbol} color="text-cyan-400" />
                      {tp1Confidence && (
                        <div className="text-[9px] text-cyan-300 mt-0.5">{tp1Confidence}%</div>
                      )}
                    </div>
                    <div className="bg-emerald-900/20 rounded-lg p-2.5 border border-emerald-500/30">
                      <div className="text-[10px] text-emerald-400 mb-1.5 flex items-center gap-0.5">
                        <Target className="w-2.5 h-2.5" />TP2
                      </div>
                      <PriceDisplay price={tp2!} symbol={symbol} color="text-emerald-400" />
                    </div>
                  </>
                ) : (
                  <div className="bg-emerald-900/20 rounded-lg p-2.5 border border-emerald-500/30">
                    <div className="text-[10px] text-emerald-400 mb-1.5 flex items-center gap-0.5">
                      <Target className="w-2.5 h-2.5" />TP
                    </div>
                    <PriceDisplay price={takeProfit} symbol={symbol} color="text-emerald-400" />
                  </div>
                )}
              </div>

              {/* Position Info row */}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-gray-800/50 rounded-xl px-3 py-2.5 border border-gray-700/30">
                  <div className="text-[10px] text-gray-400 mb-0.5">Position Size</div>
                  <div className="text-lg font-bold text-white">{lotSize.toFixed(2)}<span className="text-xs text-gray-400 ml-1">lots</span></div>
                </div>
                <div className="bg-gray-800/50 rounded-xl px-3 py-2.5 border border-gray-700/30">
                  <div className="text-[10px] text-gray-400 mb-0.5">Confidence</div>
                  <div className="flex items-baseline gap-1.5">
                    <div className="text-lg font-bold text-white">{confidence}<span className="text-xs text-gray-400">%</span></div>
                    {confidenceTier && (
                      <div className="text-[10px] font-semibold text-gray-300 leading-tight">
                        {CONFIDENCE_TIER_LABELS[normalizeTier(confidenceTier) as ConfidenceTier]}
                      </div>
                    )}
                  </div>
                  <div className="mt-1 w-full bg-gray-700 rounded-full h-1.5">
                    <div
                      className={`h-full rounded-full transition-all ${
                        confidence >= 80 ? 'bg-emerald-500' : confidence >= 70 ? 'bg-blue-500' : confidence >= 60 ? 'bg-cyan-500' : 'bg-yellow-500'
                      }`}
                      style={{ width: `${Math.max(0, Math.min(100, confidence))}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Expected Profit / RR */}
              {(expectedProfit || riskReward) && (
                <div className="grid grid-cols-2 gap-2">
                  {expectedProfit && (
                    <div className="bg-emerald-900/20 rounded-xl px-3 py-2.5 border border-emerald-500/20">
                      <div className="text-[10px] text-emerald-400 mb-0.5">Expected Profit</div>
                      <div className="text-base font-bold text-emerald-400">${expectedProfit.toFixed(2)}</div>
                    </div>
                  )}
                  {riskReward && (
                    <div className="bg-blue-900/20 rounded-xl px-3 py-2.5 border border-blue-500/20">
                      <div className="text-[10px] text-blue-400 mb-0.5">Risk:Reward</div>
                      <div className="text-base font-bold text-blue-400">1:{riskReward.toFixed(1)}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Setup / Reasoning - compact on mobile */}
              {(setupType || reasoning) && (
                <div className="bg-gray-800/30 rounded-xl px-3 py-2.5 border border-gray-700/20">
                  {setupType && (
                    <div className="text-[10px] text-gray-400">
                      Setup: <span className="text-white font-semibold">{setupType}</span>
                    </div>
                  )}
                  {reasoning && (
                    <div className="text-xs text-gray-400 mt-1 line-clamp-3 leading-snug">{reasoning}</div>
                  )}
                </div>
              )}

              {/* Countdown */}
              <div className="bg-blue-900/20 rounded-xl px-3 py-2 border border-blue-500/30 flex items-center justify-center gap-2 text-blue-300">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span className="text-xs font-medium">
                  {hasDeclineOption
                    ? `No response in ${countdown}s — trade continues`
                    : autoExecuted
                      ? `Mirror on your platform: ${countdown}s`
                      : `Auto-dismiss in ${countdown}s`
                  }
                </span>
              </div>

              {/* Action Buttons */}
              {hasDeclineOption ? (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleDecline}
                    className="py-3 px-4 bg-gray-800 hover:bg-red-900/40 border border-gray-600 hover:border-red-500/60 rounded-xl font-bold text-sm text-gray-300 hover:text-red-400 transition-all duration-200 flex items-center justify-center gap-1.5 active:scale-95"
                  >
                    <XCircle className="w-4 h-4" />
                    Decline
                  </button>
                  <button
                    onClick={handleAccept}
                    className="py-3 px-4 bg-gradient-to-r from-emerald-600 to-blue-600 hover:from-emerald-500 hover:to-blue-500 rounded-xl font-bold text-sm text-white transition-all duration-200 shadow-lg hover:shadow-emerald-500/25 active:scale-95 flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Execute
                  </button>
                </div>
              ) : (
                <button
                  onClick={onDismiss}
                  className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-blue-600 hover:from-emerald-500 hover:to-blue-500 rounded-xl font-bold text-sm text-white transition-all duration-200 shadow-lg hover:shadow-emerald-500/25 active:scale-95"
                >
                  Got It
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
