import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';

interface SessionContinuationModalProps {
  isOpen: boolean;
  sessionId: string;
  symbol?: string;
  reason?: string;
  onContinue: () => void;
  onClose: () => void;
  deadlineTimestamp?: string; // ISO timestamp of deadline
  isLoading?: boolean;
}

export const SessionContinuationModal: React.FC<SessionContinuationModalProps> = ({
  isOpen,
  sessionId,
  symbol,
  reason = 'Entry intent timed out',
  onContinue,
  onClose,
  deadlineTimestamp,
  isLoading = false
}) => {
  const [secondsRemaining, setSecondsRemaining] = useState(60);
  const [isExpired, setIsExpired] = useState(false);

  // Calculate seconds remaining from deadline
  useEffect(() => {
    if (!deadlineTimestamp) {
      setSecondsRemaining(60);
      return;
    }

    const calculateRemaining = () => {
      const now = new Date().getTime();
      const deadline = new Date(deadlineTimestamp).getTime();
      const remaining = Math.max(0, Math.floor((deadline - now) / 1000));

      setSecondsRemaining(remaining);

      if (remaining === 0 && !isExpired) {
        setIsExpired(true);
        // Auto-close session when timer expires
        console.log('[SessionContinuationModal] Timer expired, auto-closing session');
        onClose();
      }
    };

    calculateRemaining();
    const interval = setInterval(calculateRemaining, 1000);

    return () => clearInterval(interval);
  }, [deadlineTimestamp, isExpired, onClose]);

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!isOpen || isLoading) return;

    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onContinue();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isOpen, isLoading, onContinue, onClose]);

  if (!isOpen) return null;

  const progressPercent = (secondsRemaining / 60) * 100;
  const isUrgent = secondsRemaining <= 10;
  const isWarning = secondsRemaining <= 30 && secondsRemaining > 10;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative max-w-md w-full">
        {/* Pulsing glow effect when urgent */}
        {isUrgent && (
          <div className="absolute -inset-1 bg-gradient-to-r from-red-500 to-orange-500 rounded-2xl opacity-30 blur animate-pulse" />
        )}
        {isWarning && (
          <div className="absolute -inset-1 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-2xl opacity-20 blur" />
        )}
        {!isUrgent && !isWarning && (
          <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 to-purple-500 rounded-2xl opacity-20 blur" />
        )}

        <div className="relative bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl border border-gray-700 shadow-2xl overflow-hidden">
          <div className="p-6">
            {/* Header */}
            <div className="flex items-start gap-4 mb-6">
              <div className={`p-3 rounded-xl ${
                isUrgent
                  ? 'bg-gradient-to-br from-red-600 to-orange-600'
                  : isWarning
                  ? 'bg-gradient-to-br from-yellow-600 to-orange-600'
                  : 'bg-gradient-to-br from-blue-600 to-purple-600'
              }`}>
                {isUrgent ? (
                  <AlertTriangle className="w-6 h-6 text-white" />
                ) : (
                  <Clock className="w-6 h-6 text-white" />
                )}
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold text-white mb-1">
                  Entry Timed Out
                </h3>
                <p className="text-sm text-gray-400">
                  {symbol ? `${symbol} entry window closed` : 'Continue or close session?'}
                </p>
              </div>
            </div>

            {/* Timer Display */}
            <div className={`rounded-xl p-4 mb-6 border ${
              isUrgent
                ? 'bg-red-900/20 border-red-700/50'
                : isWarning
                ? 'bg-yellow-900/20 border-yellow-700/50'
                : 'bg-blue-900/20 border-blue-700/50'
            }`}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-300">Time Remaining</span>
                <span className={`text-2xl font-bold ${
                  isUrgent
                    ? 'text-red-400'
                    : isWarning
                    ? 'text-yellow-400'
                    : 'text-blue-400'
                }`}>
                  {secondsRemaining}s
                </span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2 mb-2 overflow-hidden">
                <div
                  className={`h-2 rounded-full transition-all duration-1000 ${
                    isUrgent
                      ? 'bg-gradient-to-r from-red-500 to-orange-500'
                      : isWarning
                      ? 'bg-gradient-to-r from-yellow-500 to-orange-500'
                      : 'bg-gradient-to-r from-blue-500 to-purple-500'
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="text-xs text-gray-400">
                Session will auto-close if no response
              </p>
            </div>

            {/* Reason Message */}
            <div className="bg-gray-700/30 rounded-xl p-4 mb-6 border border-gray-600/50">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm text-gray-300 mb-2">
                    {reason === 'INTENT_EXPIRED'
                      ? 'The entry setup took too long to develop'
                      : reason === 'RUNAWAY_DETECTED'
                      ? 'Price moved too far from entry zone'
                      : reason === 'HARD_INVALIDATION_CROSSED'
                      ? 'Stop loss level was violated'
                      : 'Entry conditions no longer valid'}
                  </p>
                  <p className="text-xs text-gray-500">
                    Would you like to scan for a new opportunity?
                  </p>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-3">
              <button
                onClick={onContinue}
                disabled={isLoading || isExpired}
                className="w-full flex items-center justify-center gap-3 px-4 py-4 bg-gradient-to-r from-emerald-600 to-blue-600 hover:from-emerald-500 hover:to-blue-500 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed rounded-xl text-white font-semibold transition-all duration-300 shadow-lg hover:shadow-emerald-500/25 hover:scale-[1.02] active:scale-[0.98]"
              >
                <CheckCircle className="w-5 h-5" />
                <span>Continue Scanning</span>
              </button>

              <button
                onClick={onClose}
                disabled={isLoading || isExpired}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-red-900/30 hover:bg-red-900/50 disabled:bg-gray-800 disabled:cursor-not-allowed rounded-xl text-red-400 font-medium transition-all duration-300 border border-red-800/50 hover:border-red-700"
              >
                <XCircle className="w-5 h-5" />
                <span>Close Session</span>
              </button>
            </div>

            {/* Keyboard Shortcuts Hint */}
            <div className="mt-4 pt-4 border-t border-gray-700">
              <p className="text-xs text-gray-500 text-center">
                Press <kbd className="px-2 py-0.5 bg-gray-700 rounded">Enter</kbd> to continue or{' '}
                <kbd className="px-2 py-0.5 bg-gray-700 rounded">Esc</kbd> to close
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
