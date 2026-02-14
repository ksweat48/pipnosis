import React, { useState } from 'react';
import { Search, XCircle, AlertTriangle, Info, ArrowRight } from 'lucide-react';
import type { NoTradeRejectionContext } from '../services/goal-session-live-engine';

interface NoTradesFoundDialogProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  isLoading?: boolean;
  rejectionContext?: NoTradeRejectionContext | null;
}

export const NoTradesFoundDialog: React.FC<NoTradesFoundDialogProps> = ({
  isOpen,
  onClose,
  isLoading = false,
  rejectionContext
}) => {
  const [forceClosing, setForceClosing] = useState(false);

  if (!isOpen || forceClosing) return null;

  const hasConstraintSandwich = rejectionContext?.constraintSandwichSymbols &&
    rejectionContext.constraintSandwichSymbols.length > 0;
  const hasWeakConsensus = rejectionContext?.hasWeakConsensus;
  const suggestedStyles = rejectionContext?.suggestedStyles || [];

  const handleCloseClick = () => {
    try {
      onClose();
    } catch (error) {
      console.error('[NoTradesFoundDialog] Error in onClose handler:', error);
      setForceClosing(true);
    }
  };

  const formatStyleName = (style: string): string => {
    switch (style) {
      case 'MICRO_INTRADAY': return 'Micro Intraday';
      case 'INTRADAY': return 'Intraday';
      case 'SCALP': return 'Scalp';
      default: return style;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative max-w-md w-full">
        <div className="absolute -inset-1 bg-gradient-to-r from-amber-500/20 to-orange-500/20 rounded-2xl blur" />

        <div className="relative bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl border border-gray-700 shadow-2xl overflow-hidden">
          <div className="p-6">
            <div className="flex items-start gap-4 mb-5">
              <div className="p-3 rounded-xl bg-gradient-to-br from-amber-600 to-orange-600 shrink-0">
                <Search className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold text-white mb-1">
                  No Trades Found
                </h3>
                <p className="text-sm text-gray-400">
                  Full scan complete - no qualifying setups
                </p>
              </div>
            </div>

            {hasConstraintSandwich ? (
              <div className="space-y-4 mb-6">
                <div className="bg-amber-900/20 border border-amber-700/40 rounded-xl p-4">
                  <div className="flex items-start gap-3 mb-3">
                    <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-amber-200 font-semibold text-sm mb-1">
                        Style Incompatibility Detected
                      </p>
                      {rejectionContext!.constraintSandwichSymbols.map(({ symbol, noiseFloor, slMax }) => (
                        <p key={symbol} className="text-gray-300 text-sm mb-1">
                          Your {formatStyleName(rejectionContext!.currentStyle)} style is not compatible
                          with {symbol}
                          {noiseFloor > 0 && slMax > 0
                            ? ` -- the minimum safe stop distance (${Math.round(noiseFloor)} pips) exceeds ${formatStyleName(rejectionContext!.currentStyle)}'s maximum (${Math.round(slMax)} pips).`
                            : '.'}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>

                {suggestedStyles.length > 0 && (
                  <div className="bg-gray-700/30 border border-gray-600/40 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                      <Info className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-gray-200 text-sm">
                          Consider starting a new session with{' '}
                          <span className="text-sky-300 font-medium">
                            {suggestedStyles.map(formatStyleName).join(' or ')}
                          </span>
                          {' '}style. These styles support the wider stop distances
                          that {rejectionContext!.constraintSandwichSymbols.map(s => s.symbol).join(', ')} requires.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : hasWeakConsensus ? (
              <div className="space-y-4 mb-6">
                <div className="bg-gray-700/30 border border-gray-600/40 rounded-xl p-4">
                  <p className="text-gray-300 text-sm mb-3">
                    Alpha scanned all pairs and found no high-confidence setups.
                    The Omega council had conflicting signals across the evaluated pairs.
                  </p>
                  {suggestedStyles.length > 0 && (
                    <div className="flex items-start gap-3 mt-3 pt-3 border-t border-gray-600/30">
                      <ArrowRight className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                      <p className="text-gray-300 text-sm">
                        A wider timeframe style ({suggestedStyles.map(formatStyleName).join(' or ')}) may find better setups in current market conditions.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-gray-700/30 border border-gray-600/40 rounded-xl p-4 mb-6">
                <p className="text-gray-300 text-sm mb-2">
                  Alpha scanned all pairs and found no quality trade setups.
                  Market conditions may not be favorable right now.
                </p>
                <p className="text-amber-300/90 text-sm font-medium">
                  Try again in about 15 minutes when conditions may improve.
                </p>
              </div>
            )}

            <button
              onClick={handleCloseClick}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-4 bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-500 hover:to-gray-600 disabled:from-gray-800 disabled:to-gray-800 disabled:cursor-not-allowed rounded-xl text-white font-semibold transition-all duration-300 shadow-lg hover:shadow-gray-500/15 hover:scale-[1.01] active:scale-[0.99]"
            >
              <XCircle className="w-5 h-5" />
              <span>Close Session</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
