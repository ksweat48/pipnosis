import React, { useState, useEffect } from 'react';
import { Trophy, TrendingUp, Clock, AlertCircle, X } from 'lucide-react';
import { goalAchievementCoordinator } from '@/services/coordinators/goal-achievement-coordinator';
import { modalQueueManager } from '@/services/modal-queue-manager';

interface GoalAchievedCountdownModalProps {
  isOpen: boolean;
  modalId: string;
  sessionId: string;
  goalAmount: number;
  currentProfit: number;
  symbol?: string;
  onClose: () => void;
}

export const GoalAchievedCountdownModal: React.FC<GoalAchievedCountdownModalProps> = ({
  isOpen,
  modalId,
  sessionId,
  goalAmount,
  currentProfit,
  symbol = 'TRADE',
  onClose
}) => {
  const [secondsRemaining, setSecondsRemaining] = useState(60);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const timer = setInterval(() => {
      setSecondsRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          handleTimeout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, sessionId]);

  const handleTimeout = async () => {
    if (isProcessing) return;

    console.log('[GoalAchievedCountdownModal] Timeout reached - defaulting to continue');
    setIsProcessing(true);

    try {
      await goalAchievementCoordinator.handleGoalCountdownTimeout(sessionId);
      await modalQueueManager.dismissModal(modalId, 'continue');
      onClose();
    } catch (error) {
      console.error('[GoalAchievedCountdownModal] Error handling timeout:', error);
      setIsProcessing(false);
    }
  };

  const handleContinueToTP = async () => {
    if (isProcessing) return;

    console.log('[GoalAchievedCountdownModal] User chose to continue to TP');
    setIsProcessing(true);

    try {
      const result = await goalAchievementCoordinator.handleGoalCountdownAction(
        sessionId,
        'continue_to_tp'
      );

      if (result.success) {
        await modalQueueManager.dismissModal(modalId, 'continue');
        onClose();
      } else {
        console.error('[GoalAchievedCountdownModal] Failed to process action:', result.error);
        setIsProcessing(false);
      }
    } catch (error) {
      console.error('[GoalAchievedCountdownModal] Error processing continue action:', error);
      setIsProcessing(false);
    }
  };

  const handleCloseNow = async () => {
    if (isProcessing) return;

    console.log('[GoalAchievedCountdownModal] User chose to close trade');
    setIsProcessing(true);

    try {
      const result = await goalAchievementCoordinator.handleGoalCountdownAction(
        sessionId,
        'close_now'
      );

      if (result.success) {
        await modalQueueManager.dismissModal(modalId, 'close');
        onClose();
      } else {
        console.error('[GoalAchievedCountdownModal] Failed to process action:', result.error);
        setIsProcessing(false);
      }
    } catch (error) {
      console.error('[GoalAchievedCountdownModal] Error processing close action:', error);
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  const overPerformance = ((currentProfit - goalAmount) / goalAmount) * 100;
  const progressPercent = (60 - secondsRemaining) / 60 * 100;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
      <div className="relative w-full max-w-lg animate-in zoom-in-95 duration-300 max-h-[90vh] flex flex-col">
        {/* Glow effect */}
        <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500 via-blue-500 to-emerald-500 rounded-2xl opacity-75 blur-xl animate-pulse" />

        {/* Dialog content */}
        <div className="relative bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-2xl border border-emerald-500/50 shadow-2xl overflow-hidden flex flex-col">
          <div className="overflow-y-auto flex-1 pb-safe" style={{ WebkitOverflowScrolling: 'touch', scrollBehavior: 'auto', maxHeight: 'calc(90vh - 2rem)' }}>
            {/* Close button (disabled during processing) */}
            <button
              onClick={onClose}
              disabled={isProcessing}
              className="absolute top-4 right-4 p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-gray-700/50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Header with celebration */}
            <div className="relative pt-8 pb-6 px-6 text-center">
              <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/20 to-transparent" />

              <div className="relative inline-block mb-4">
                <div className="absolute inset-0 bg-emerald-500 rounded-full blur-2xl opacity-50 animate-pulse" />
                <div className="relative w-20 h-20 mx-auto bg-gradient-to-br from-emerald-500 to-blue-500 rounded-full flex items-center justify-center shadow-2xl">
                  <Trophy className="w-10 h-10 text-white" />
                </div>
              </div>

              <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 via-blue-400 to-emerald-400 mb-2">
                Goal Achieved!
              </h2>
              <p className="text-gray-400 text-sm">
                Choose your next action within {secondsRemaining} seconds
              </p>
            </div>

            {/* Countdown timer */}
            <div className="px-6 pb-4">
              <div className="relative bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-blue-400" />
                    <span className="text-sm text-gray-400">Time Remaining</span>
                  </div>
                  <span className="text-2xl font-bold text-blue-400">
                    {secondsRemaining}s
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-1000"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Stats grid */}
            <div className="px-6 pb-6">
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
                  <div className="text-xs text-gray-400 mb-1">Target Goal</div>
                  <div className="text-2xl font-bold text-white">
                    ${goalAmount.toFixed(0)}
                  </div>
                </div>

                <div className="bg-gradient-to-br from-emerald-900/50 to-blue-900/50 rounded-xl p-4 border border-emerald-500/50">
                  <div className="text-xs text-emerald-300 mb-1">Current Profit</div>
                  <div className="text-2xl font-bold text-emerald-400">
                    ${currentProfit.toFixed(2)}
                  </div>
                  {overPerformance > 0 && (
                    <div className="text-xs text-emerald-300 mt-1">
                      +{overPerformance.toFixed(1)}% over goal
                    </div>
                  )}
                </div>
              </div>

              {/* Symbol info */}
              <div className="flex items-center justify-between py-3 px-4 bg-gray-800/30 rounded-lg border border-gray-700/50 mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/20 rounded-lg">
                    <TrendingUp className="w-4 h-4 text-blue-400" />
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Symbol</div>
                    <div className="text-sm font-semibold text-white">{symbol}</div>
                  </div>
                </div>
              </div>

              {/* Warning message */}
              <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl mb-6 flex gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-yellow-200 leading-relaxed">
                    If you don't respond within 1 minute, your trade will automatically <strong>continue to Take Profit</strong> unchanged.
                  </p>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-col gap-3 pb-6">
                <button
                  onClick={handleContinueToTP}
                  disabled={isProcessing}
                  className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-500 hover:to-emerald-500 rounded-xl font-semibold text-white transition-all duration-300 shadow-lg hover:shadow-blue-500/25 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  {isProcessing ? 'Processing...' : 'Continue to Take Profit'}
                </button>

                <button
                  onClick={handleCloseNow}
                  disabled={isProcessing}
                  className="w-full py-3 px-4 bg-gray-700/50 hover:bg-gray-700 rounded-xl font-semibold text-white transition-all duration-300 border border-gray-600/50 hover:border-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Close Trade & Session Now
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
