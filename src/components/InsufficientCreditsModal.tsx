/**
 * INSUFFICIENT CREDITS MODAL — SSOT Credit Gate UI
 *
 * GOVERNANCE: This is the single source of truth for all credit-insufficient
 * blocking UI across the platform. Any place that needs to tell the user they
 * do not have enough credits to proceed MUST use this component.
 *
 * Responsibilities:
 * - Show current credit balance vs minimum required
 * - Provide a direct navigation path to the Credits purchase page
 * - Never shown to admin users (caller responsibility to check isAdmin)
 *
 * CCIP Compliance: Component is purely presentational. No side effects,
 * no database mutations. All credit logic lives in credit-validation-service.ts.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CreditCard, X, Coins } from 'lucide-react';
import { TOKENOMICS } from '../config/tokenomics-constants';

interface InsufficientCreditsModalProps {
  isOpen: boolean;
  currentBalance: number;
  requiredBalance?: number;
  onDismiss: () => void;
}

export const InsufficientCreditsModal: React.FC<InsufficientCreditsModalProps> = ({
  isOpen,
  currentBalance,
  requiredBalance = TOKENOMICS.CREDITS.MIN_BALANCE_FOR_SESSION,
  onDismiss,
}) => {
  const navigate = useNavigate();

  if (!isOpen) return null;

  const handleBuyCredits = () => {
    onDismiss();
    navigate('/credits');
  };

  const shortage = Math.max(0, requiredBalance - currentBalance);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onDismiss}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-md bg-gray-900 border border-gray-700/80 rounded-2xl shadow-2xl overflow-hidden max-h-[90dvh] flex flex-col">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 via-orange-500 to-red-500" />

        <div className="flex-1 overflow-y-auto p-6 pt-7" style={{ WebkitOverflowScrolling: 'touch', minHeight: 0 }}>
          <div className="flex items-start justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white leading-tight">Insufficient Credits</h2>
                <p className="text-xs text-gray-400 mt-0.5">Top up to start a session</p>
              </div>
            </div>
            <button
              onClick={onDismiss}
              className="p-1.5 hover:bg-gray-700/60 rounded-lg transition-colors text-gray-400 hover:text-white flex-shrink-0"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4 mb-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Coins className="w-4 h-4 text-gray-500" />
                <span>Your balance</span>
              </div>
              <span className={`text-sm font-bold ${currentBalance <= 0 ? 'text-red-400' : 'text-amber-400'}`}>
                {currentBalance} credits
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Required to start</span>
              <span className="text-sm font-bold text-white">{requiredBalance} credits</span>
            </div>

            {shortage > 0 && (
              <>
                <div className="h-px bg-gray-700/60" />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">You need</span>
                  <span className="text-sm font-bold text-red-400">+{shortage} more credits</span>
                </div>
              </>
            )}
          </div>

          <p className="text-sm text-gray-400 leading-relaxed">
            Each trading session requires a minimum of{' '}
            <span className="text-white font-medium">{requiredBalance} credits</span> to start.
            Credits are used to execute trade signals. Purchase more to continue trading.
          </p>
        </div>

        <div className="flex-shrink-0 px-6 pb-6 pt-4 space-y-3 border-t border-gray-700/50 bg-gray-900">
          <button
            onClick={handleBuyCredits}
            className="w-full flex items-center justify-center gap-2.5 px-4 py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-sm font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-emerald-900/30 hover:shadow-emerald-900/50 hover:scale-[1.02] active:scale-[0.98]"
          >
            <CreditCard className="w-4 h-4" />
            Buy Credits Now
          </button>

          <button
            onClick={onDismiss}
            className="w-full px-4 py-3 text-sm text-gray-400 hover:text-white hover:bg-gray-800/60 rounded-xl transition-all duration-200"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};
