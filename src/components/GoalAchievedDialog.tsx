import React from 'react';
import { Trophy, TrendingUp, Clock, CheckCircle, X } from 'lucide-react';

interface GoalAchievedDialogProps {
  isOpen: boolean;
  goalAmount: number;
  achievedProfit: number;
  symbol: string;
  timeElapsed: string;
  tradesExecuted: number;
  onStartNewSession: () => void;
  onViewAchievements: () => void;
  onClose: () => void;
}

export const GoalAchievedDialog: React.FC<GoalAchievedDialogProps> = ({
  isOpen,
  goalAmount,
  achievedProfit,
  symbol,
  timeElapsed,
  tradesExecuted,
  onStartNewSession,
  onViewAchievements,
  onClose
}) => {
  if (!isOpen) return null;

  // Safety check for unrealistic profit values (100x multiplier bug)
  let displayProfit = achievedProfit;
  if (Math.abs(achievedProfit) > 10000) {
    console.warn('[GoalAchievedDialog] Unrealistic profit detected:', achievedProfit);
    displayProfit = achievedProfit / 100;
    console.log('[GoalAchievedDialog] Auto-corrected to:', displayProfit);
  }

  const overPerformance = ((displayProfit - goalAmount) / goalAmount) * 100;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
      <div className="relative w-full max-w-lg animate-in zoom-in-95 duration-300 max-h-[90vh] flex flex-col">
        {/* Glow effect */}
        <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500 via-blue-500 to-emerald-500 rounded-2xl opacity-75 blur-xl animate-pulse" />

        {/* Dialog content */}
        <div className="relative bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-2xl border border-emerald-500/50 shadow-2xl overflow-hidden flex flex-col">
          <div className="overflow-y-auto flex-1 pb-safe" style={{ WebkitOverflowScrolling: 'touch', scrollBehavior: 'auto', maxHeight: 'calc(90vh - 2rem)' }}>
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-gray-700/50"
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
              Your trade has been automatically closed to secure your profit
            </p>
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
                <div className="text-xs text-emerald-300 mb-1">Achieved</div>
                <div className="text-2xl font-bold text-emerald-400">
                  ${displayProfit.toFixed(2)}
                </div>
                {overPerformance > 0 && (
                  <div className="text-xs text-emerald-300 mt-1">
                    +{overPerformance.toFixed(1)}% over goal
                  </div>
                )}
              </div>
            </div>

            {/* Additional details */}
            <div className="space-y-3 mb-6">
              <div className="flex items-center justify-between py-3 px-4 bg-gray-800/30 rounded-lg border border-gray-700/50">
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

              <div className="flex items-center justify-between py-3 px-4 bg-gray-800/30 rounded-lg border border-gray-700/50">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-500/20 rounded-lg">
                    <Clock className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Time to Goal</div>
                    <div className="text-sm font-semibold text-white">{timeElapsed}</div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between py-3 px-4 bg-gray-800/30 rounded-lg border border-gray-700/50">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/20 rounded-lg">
                    <CheckCircle className="w-4 h-4 text-blue-400" />
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Trades Executed</div>
                    <div className="text-sm font-semibold text-white">{tradesExecuted}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Success message */}
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl mb-6">
              <p className="text-sm text-emerald-200 text-center leading-relaxed">
                Your goal has been permanently logged as a win! This achievement is saved in your trading history.
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col gap-3 pb-6">
              <button
                onClick={onStartNewSession}
                className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-blue-600 hover:from-emerald-500 hover:to-blue-500 rounded-xl font-semibold text-white transition-all duration-300 shadow-lg hover:shadow-emerald-500/25 hover:scale-105 active:scale-95"
              >
                Start New Goal Session
              </button>

              <button
                onClick={onViewAchievements}
                className="w-full py-3 px-4 bg-gray-700/50 hover:bg-gray-700 rounded-xl font-semibold text-white transition-all duration-300 border border-gray-600/50 hover:border-gray-500"
              >
                View All Achievements
              </button>
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
};
