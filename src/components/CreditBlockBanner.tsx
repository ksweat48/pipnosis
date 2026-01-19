import React, { useState } from 'react';
import { AlertTriangle, CreditCard, RefreshCw, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { creditValidationService } from '@/services/credit-validation-service';
import { useNavigate } from 'react-router-dom';

interface CreditBlockBannerProps {
  sessionId: string;
  symbol?: string;
  creditCost?: number;
  onRetrySuccess?: () => void;
}

export function CreditBlockBanner({
  sessionId,
  symbol,
  creditCost = 10,
  onRetrySuccess
}: CreditBlockBannerProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isRetrying, setIsRetrying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);

  const handleRetry = async () => {
    if (!user?.id) return;

    setIsRetrying(true);
    setErrorMessage(null);

    try {
      const result = await creditValidationService.retryPendingDeduction(user.id, sessionId);

      if (result.success) {
        if (onRetrySuccess) {
          onRetrySuccess();
        }
        setIsDismissed(true);
      } else {
        setErrorMessage(result.error || 'Failed to deduct credits. Please try again.');
      }
    } catch (error) {
      console.error('[CreditBlockBanner] Error retrying deduction:', error);
      setErrorMessage('An unexpected error occurred. Please try again.');
    } finally {
      setIsRetrying(false);
    }
  };

  const handleBuyCredits = () => {
    navigate('/credits');
  };

  if (isDismissed) {
    return null;
  }

  return (
    <div className="relative group animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="absolute -inset-0.5 bg-gradient-to-r from-red-500 to-orange-500 rounded-xl opacity-50 blur animate-pulse" />

      <div className="relative bg-gradient-to-br from-red-900/90 to-orange-900/90 backdrop-blur-xl border-2 border-red-500/50 rounded-xl p-4 shadow-2xl">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 mt-0.5">
            <div className="relative">
              <div className="absolute inset-0 bg-red-500 rounded-full blur opacity-50 animate-pulse" />
              <div className="relative w-12 h-12 rounded-full bg-gradient-to-br from-red-600 to-orange-600 flex items-center justify-center shadow-lg">
                <AlertTriangle size={24} className="text-white" />
              </div>
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
              Session Blocked - Insufficient Credits
            </h3>
            <p className="text-gray-200 mb-3">
              Your trading session is paused because a signal requires {creditCost} credits
              {symbol && ` for ${symbol}`}, but your balance is insufficient.
            </p>

            {errorMessage && (
              <div className="mb-3 p-3 bg-red-800/50 border border-red-500/30 rounded-lg">
                <p className="text-red-200 text-sm flex items-center gap-2">
                  <AlertTriangle size={16} className="flex-shrink-0" />
                  {errorMessage}
                </p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleRetry}
                disabled={isRetrying}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 disabled:from-gray-600 disabled:to-gray-600 text-white font-semibold rounded-lg transition-all shadow-lg hover:shadow-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRetrying ? (
                  <>
                    <RefreshCw size={18} className="animate-spin" />
                    <span>Retrying...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw size={18} />
                    <span>Retry Deduction</span>
                  </>
                )}
              </button>

              <button
                onClick={handleBuyCredits}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-semibold rounded-lg transition-all shadow-lg hover:shadow-blue-500/25"
              >
                <CreditCard size={18} />
                <span>Buy Credits</span>
              </button>
            </div>

            <p className="mt-3 text-xs text-gray-300 flex items-center gap-1">
              <AlertTriangle size={12} />
              Your session will remain paused until credits are resolved
            </p>
          </div>

          <button
            onClick={() => setIsDismissed(true)}
            className="flex-shrink-0 p-2 hover:bg-white/10 rounded-lg transition-colors"
            aria-label="Dismiss"
          >
            <X size={20} className="text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}
