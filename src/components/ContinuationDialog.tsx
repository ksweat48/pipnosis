import React from 'react';
import { CheckCircle, StopCircle, TrendingUp, Clock } from 'lucide-react';

interface ContinuationDialogProps {
  isOpen: boolean;
  continuationPrompt: string;
  tradesInSession: number;
  currentProgress: number;
  targetValue: number;
  onContinue: () => void;
  onStop: () => void;
  isLoading?: boolean;
}

export const ContinuationDialog: React.FC<ContinuationDialogProps> = ({
  isOpen,
  continuationPrompt,
  tradesInSession,
  currentProgress,
  targetValue,
  onContinue,
  onStop,
  isLoading = false
}) => {
  if (!isOpen) return null;

  const progressPercent = targetValue > 0 ? (currentProgress / targetValue) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative max-w-lg w-full max-h-[650px] flex flex-col">
        <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-2xl opacity-20 blur" />

        <div className="relative bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl border border-gray-700 shadow-2xl overflow-hidden flex flex-col">
          <div className="overflow-y-auto flex-1 p-6" style={{ WebkitOverflowScrolling: 'touch', scrollBehavior: 'auto' }}>
          <div className="flex items-start gap-4 mb-6">
            <div className="p-3 bg-gradient-to-br from-emerald-600 to-blue-600 rounded-xl">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold text-white mb-1">
                Trade #{tradesInSession} Complete
              </h3>
              <p className="text-sm text-gray-400">What would you like to do next?</p>
            </div>
          </div>

          <div className="bg-gray-700/30 rounded-xl p-4 mb-6 border border-gray-600/50">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-400">Session Progress</span>
              <span className="text-sm font-semibold text-white">
                ${currentProgress.toFixed(2)} / ${targetValue.toFixed(2)}
              </span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2 mb-2">
              <div
                className="h-2 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(progressPercent, 100)}%` }}
              />
            </div>
            <div className="text-xs text-gray-500 text-right">
              {progressPercent.toFixed(1)}% Complete
            </div>
          </div>

          <div className="bg-blue-900/20 border border-blue-700/50 rounded-xl p-4 mb-6">
            <div className="flex items-start gap-2">
              <Clock className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-gray-300 whitespace-pre-line">
                {continuationPrompt}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <button
              onClick={onContinue}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-3 px-4 py-4 bg-gradient-to-r from-emerald-600 to-blue-600 hover:from-emerald-500 hover:to-blue-500 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed rounded-xl text-white font-semibold transition-all duration-300 shadow-lg hover:shadow-emerald-500/25 hover:scale-[1.02] active:scale-[0.98]"
            >
              <CheckCircle className="w-5 h-5" />
              <span>Continue Scanning for Next Trade</span>
            </button>

            <button
              onClick={onStop}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-red-900/30 hover:bg-red-900/50 disabled:bg-gray-800 disabled:cursor-not-allowed rounded-xl text-red-400 font-medium transition-all duration-300 border border-red-800/50 hover:border-red-700"
            >
              <StopCircle className="w-5 h-5" />
              <span>Close Session</span>
            </button>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-700">
            <p className="text-xs text-gray-500 text-center">
              Single-trade mode keeps you in control of your risk
            </p>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
};
