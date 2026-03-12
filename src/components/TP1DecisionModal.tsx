import React, { useState, useEffect, useRef } from 'react';
import { TrendingUp, Shield, ArrowRight, Clock, X, CheckCircle } from 'lucide-react';

export interface TP1DecisionData {
  tradeId: string;
  sessionId: string;
  symbol: string;
  direction: 'buy' | 'sell';
  tp1Price: number;
  tp2Price: number | null;
  currentProfit: number;
  goalAmount: number;
}

interface TP1DecisionModalProps {
  isOpen: boolean;
  data: TP1DecisionData | null;
  onContinueToTP2: () => void;
  onCloseSession: () => void;
}

const COUNTDOWN_SECONDS = 30;

export const TP1DecisionModal: React.FC<TP1DecisionModalProps> = ({
  isOpen,
  data,
  onContinueToTP2,
  onCloseSession,
}) => {
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [isProcessing, setIsProcessing] = useState(false);
  const hasAutoActedRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasDualTP = data?.tp2Price != null;

  useEffect(() => {
    if (!isOpen) {
      setCountdown(COUNTDOWN_SECONDS);
      setIsProcessing(false);
      hasAutoActedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    hasAutoActedRef.current = false;
    setCountdown(COUNTDOWN_SECONDS);

    if (!hasDualTP) return;

    intervalRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isOpen, hasDualTP]);

  useEffect(() => {
    if (!hasDualTP) return;
    if (countdown === 0 && isOpen && !hasAutoActedRef.current && !isProcessing) {
      hasAutoActedRef.current = true;
      onContinueToTP2();
    }
  }, [countdown, isOpen, isProcessing, onContinueToTP2, hasDualTP]);

  if (!isOpen || !data) return null;

  const progressPercent = (countdown / COUNTDOWN_SECONDS) * 100;
  const isUrgent = countdown <= 10;
  const isWarning = countdown > 10 && countdown <= 20;

  const handleContinue = () => {
    if (isProcessing) return;
    if (intervalRef.current) clearInterval(intervalRef.current);
    hasAutoActedRef.current = true;
    setIsProcessing(true);
    onContinueToTP2();
  };

  const handleClose = () => {
    if (isProcessing) return;
    if (intervalRef.current) clearInterval(intervalRef.current);
    hasAutoActedRef.current = true;
    setIsProcessing(true);
    onCloseSession();
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      style={{
        paddingTop: 'max(5rem, env(safe-area-inset-top))',
        paddingBottom: 'max(6rem, env(safe-area-inset-bottom))',
        paddingLeft: 'max(1rem, env(safe-area-inset-left))',
        paddingRight: 'max(1rem, env(safe-area-inset-right))',
      }}
    >
      <div className="relative w-full max-w-md animate-in zoom-in-95 duration-300">
        <div className={`absolute -inset-px bg-gradient-to-r ${hasDualTP ? 'from-amber-500 to-emerald-500' : 'from-emerald-500 to-teal-500'} rounded-2xl opacity-50 blur-lg`} />

        <div
          className="relative bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-2xl border border-emerald-500/40 shadow-2xl overflow-hidden flex flex-col"
          style={{ maxHeight: 'calc(100dvh - 11rem)' }}
        >
          <div className="overflow-y-auto flex-1" style={{ WebkitOverflowScrolling: 'touch' }}>

            <div className="relative pt-5 pb-4 px-5">
              <div className={`absolute inset-0 bg-gradient-to-b ${hasDualTP ? 'from-amber-500/15' : 'from-emerald-500/15'} to-transparent`} />

              <button
                onClick={handleClose}
                disabled={isProcessing}
                className="absolute top-3 right-3 p-1.5 rounded-lg bg-gray-800/60 hover:bg-gray-700/60 transition-colors disabled:opacity-40 z-10"
              >
                <X className="w-4 h-4 text-gray-400" />
              </button>

              <div className="relative flex items-center gap-3 pr-8">
                <div className={`p-2.5 bg-gradient-to-br ${hasDualTP ? 'from-amber-500 to-orange-500' : 'from-emerald-500 to-teal-500'} rounded-xl shadow-md shrink-0`}>
                  {hasDualTP ? (
                    <TrendingUp className="w-5 h-5 text-white" />
                  ) : (
                    <CheckCircle className="w-5 h-5 text-white" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`text-xs font-bold uppercase tracking-wider ${hasDualTP ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {hasDualTP ? 'TP1 Hit' : 'Target Reached'}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${data.direction === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                      {data.direction.toUpperCase()}
                    </span>
                  </div>
                  <h2 className="text-base font-bold text-white leading-tight">
                    {data.symbol} — {hasDualTP ? 'Take Profit 1 Reached' : 'Take Profit Reached'}
                  </h2>
                </div>
              </div>
            </div>

            <div className="px-5 pb-5 space-y-3">

              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-700/50">
                  <div className="text-[10px] text-gray-400 mb-1">Current Profit</div>
                  <div className={`text-lg font-bold ${data.currentProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {data.currentProfit >= 0 ? '+' : ''}${Math.abs(data.currentProfit).toFixed(2)}
                  </div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-700/50">
                  <div className="text-[10px] text-gray-400 mb-1">Goal Target</div>
                  <div className="text-lg font-bold text-white">${data.goalAmount.toFixed(0)}</div>
                </div>
              </div>

              <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-xl p-3 flex items-start gap-2.5">
                <Shield className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-xs text-emerald-200 leading-relaxed">
                  {hasDualTP ? (
                    <>
                      Stop loss has been automatically moved to breakeven. Your capital is protected.
                      <span className="block mt-1 text-emerald-300 font-medium">
                        TP2 target: {data.tp2Price!.toFixed(data.symbol.includes('JPY') ? 3 : 5)}
                      </span>
                    </>
                  ) : (
                    'Your scalp target has been reached. The trade will close at this level.'
                  )}
                </p>
              </div>

              {hasDualTP && (
                <div className="bg-gray-800/50 rounded-xl p-3 border border-gray-700/40">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <Clock className={`w-3.5 h-3.5 ${isUrgent ? 'text-red-400' : isWarning ? 'text-orange-400' : 'text-amber-400'}`} />
                      <span className="text-xs text-gray-400">Auto-continuing to TP2 in</span>
                    </div>
                    <span className={`font-mono font-bold tabular-nums transition-colors ${isUrgent ? 'text-red-400 text-lg' : isWarning ? 'text-orange-400 text-base' : 'text-amber-300 text-base'}`}>
                      {countdown}s
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-1000 ease-linear ${isUrgent ? 'bg-gradient-to-r from-red-500 to-red-400' : isWarning ? 'bg-gradient-to-r from-orange-500 to-amber-400' : 'bg-gradient-to-r from-amber-500 to-emerald-500'}`}
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2 pt-1">
                {hasDualTP && (
                  <button
                    onClick={handleContinue}
                    disabled={isProcessing}
                    className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 rounded-xl font-semibold text-sm text-white transition-all duration-200 shadow-lg hover:shadow-emerald-500/25 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <ArrowRight className="w-4 h-4" />
                    {isProcessing ? 'Processing...' : 'Continue to TP2'}
                  </button>
                )}
                <button
                  onClick={handleClose}
                  disabled={isProcessing}
                  className={`w-full py-3 px-4 rounded-xl font-semibold text-sm text-white transition-all duration-200 border disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
                    hasDualTP
                      ? 'bg-gray-700/50 hover:bg-gray-700 border-gray-600/50 hover:border-gray-500'
                      : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 border-transparent shadow-lg hover:shadow-emerald-500/25 active:scale-95'
                  }`}
                >
                  {isProcessing ? 'Processing...' : hasDualTP ? 'Close Session Now' : 'Close Trade'}
                </button>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
