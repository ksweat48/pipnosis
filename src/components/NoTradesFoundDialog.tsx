import React, { useState, useEffect } from 'react';
import { Search, XCircle, Clock, AlertTriangle, X } from 'lucide-react';

interface NoTradesFoundDialogProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  isLoading?: boolean;
}

export const NoTradesFoundDialog: React.FC<NoTradesFoundDialogProps> = ({
  isOpen,
  onClose,
  sessionId,
  isLoading = false
}) => {
  const [countdown, setCountdown] = useState(60);
  const [forceClosing, setForceClosing] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setCountdown(60);
      return;
    }

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          console.log('[NoTradesFoundDialog] Countdown reached 0 - auto-closing session');
          try {
            onClose();
          } catch (error) {
            console.error('[NoTradesFoundDialog] Error in onClose:', error);
            setForceClosing(true);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const forceCloseTimer = setTimeout(() => {
      console.warn('[NoTradesFoundDialog] EMERGENCY: Force closing stuck modal after 90s');
      setForceClosing(true);
    }, 90000);

    return () => clearTimeout(forceCloseTimer);
  }, [isOpen]);

  if (!isOpen || forceClosing) return null;

  const isUrgent = countdown <= 10;
  const progressPercentage = (countdown / 60) * 100;

  const handleCloseClick = () => {
    console.log('[NoTradesFoundDialog] User clicked Close Session');
    try {
      onClose();
    } catch (error) {
      console.error('[NoTradesFoundDialog] Error in onClose handler:', error);
      setForceClosing(true);
    }
  };

  const handleForceClose = () => {
    console.warn('[NoTradesFoundDialog] User force-closed modal via X button');
    setForceClosing(true);
    try {
      onClose();
    } catch (error) {
      console.error('[NoTradesFoundDialog] Error calling onClose during force close:', error);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative max-w-md w-full">
        <div className="absolute -inset-1 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-2xl opacity-20 blur animate-pulse" />

        <div className="relative bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl border border-gray-700 shadow-2xl overflow-hidden">
          <button
            onClick={handleForceClose}
            className="absolute top-4 right-4 z-10 p-2 rounded-full bg-gray-700/50 hover:bg-gray-600/50 transition-colors"
            title="Close"
          >
            <X className="w-5 h-5 text-gray-400 hover:text-white" />
          </button>

          <div className="p-6">
            <div className="flex items-start gap-4 mb-6">
              <div className={`p-3 rounded-xl ${isUrgent ? 'bg-gradient-to-br from-red-600 to-orange-600 animate-pulse' : 'bg-gradient-to-br from-yellow-600 to-orange-600'}`}>
                <Search className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold text-white mb-1">
                  No Trades Found
                </h3>
                <p className="text-sm text-gray-400">
                  Scan cycle completed
                </p>
              </div>
            </div>

            <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-xl p-4 mb-6">
              <p className="text-gray-300 text-sm mb-3">
                No quality trade setups were found. Market conditions may not be favorable right now.
              </p>
              <p className="text-yellow-300/90 text-sm font-medium">
                Try again in about 15 minutes.
              </p>
            </div>

            <div className={`rounded-xl p-4 mb-6 border ${isUrgent ? 'bg-red-900/30 border-red-700/50' : 'bg-gray-700/30 border-gray-600/50'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Clock className={`w-5 h-5 ${isUrgent ? 'text-red-400' : 'text-gray-400'}`} />
                  <span className={`text-sm font-medium ${isUrgent ? 'text-red-300' : 'text-gray-300'}`}>
                    Auto-close in:
                  </span>
                </div>
                <span className={`text-2xl font-bold font-mono ${isUrgent ? 'text-red-400 animate-pulse' : 'text-white'}`}>
                  {countdown}s
                </span>
              </div>

              <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-2 rounded-full transition-all duration-1000 ${
                    isUrgent
                      ? 'bg-gradient-to-r from-red-500 to-orange-500'
                      : 'bg-gradient-to-r from-yellow-500 to-orange-500'
                  }`}
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>

              {isUrgent && (
                <div className="flex items-center gap-2 mt-3 text-red-400 text-xs">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Session will close automatically</span>
                </div>
              )}
            </div>

            <button
              onClick={handleCloseClick}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-3 px-4 py-4 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed rounded-xl text-white font-semibold transition-all duration-300 shadow-lg hover:shadow-red-500/25 hover:scale-[1.02] active:scale-[0.98]"
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
