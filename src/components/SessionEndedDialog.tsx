import React from 'react';
import { Clock, XCircle, AlertTriangle, Play, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface SessionEndedDialogProps {
  isOpen: boolean;
  closeReason: 'timeout' | 'safety_net' | 'user_stopped' | string;
  durationMinutes: number;
  tradesInSession: number;
  currentProgress: number;
  targetValue: number;
  message: string;
  onDismiss: () => void;
  onStartNewSession: () => void;
}

export const SessionEndedDialog: React.FC<SessionEndedDialogProps> = ({
  isOpen,
  closeReason,
  durationMinutes,
  tradesInSession,
  currentProgress,
  targetValue,
  message,
  onDismiss,
  onStartNewSession
}) => {
  const navigate = useNavigate();

  if (!isOpen) return null;

  const getIcon = () => {
    switch (closeReason) {
      case 'timeout':
        return <Clock className="w-6 h-6 text-white" />;
      case 'safety_net':
        return <AlertTriangle className="w-6 h-6 text-white" />;
      case 'user_stopped':
        return <XCircle className="w-6 h-6 text-white" />;
      default:
        return <Clock className="w-6 h-6 text-white" />;
    }
  };

  const getTitle = () => {
    switch (closeReason) {
      case 'timeout':
        return 'Session Closed - No Response';
      case 'safety_net':
        return 'Session Auto-Closed';
      case 'user_stopped':
        return 'Session Closed';
      default:
        return 'Session Ended';
    }
  };

  const getGradient = () => {
    switch (closeReason) {
      case 'timeout':
        return 'from-amber-600 to-orange-600';
      case 'safety_net':
        return 'from-red-600 to-orange-600';
      case 'user_stopped':
        return 'from-gray-600 to-gray-700';
      default:
        return 'from-blue-600 to-gray-600';
    }
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 1) return 'Less than a minute';
    if (minutes < 60) return `${Math.round(minutes)} minute${Math.round(minutes) !== 1 ? 's' : ''}`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}m`;
  };

  const progressPercent = targetValue > 0 ? (currentProgress / targetValue) * 100 : 0;

  const handleStartNew = () => {
    onDismiss();
    onStartNewSession();
    navigate('/trade');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative max-w-lg w-full max-h-[650px] flex flex-col">
        <div className={`absolute -inset-1 bg-gradient-to-r ${getGradient()} rounded-2xl opacity-30 blur`} />

        <div className="relative bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl border border-gray-700 shadow-2xl overflow-hidden flex flex-col">
          <div className="overflow-y-auto flex-1 p-6" style={{ WebkitOverflowScrolling: 'touch', scrollBehavior: 'auto' }}>
            <div className="flex items-start gap-4 mb-6">
              <div className={`p-3 bg-gradient-to-br ${getGradient()} rounded-xl`}>
                {getIcon()}
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold text-white mb-1">
                  {getTitle()}
                </h3>
                <p className="text-sm text-gray-400">
                  Your session ended while you were away
                </p>
              </div>
              <button
                onClick={onDismiss}
                className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="bg-gray-700/30 rounded-xl p-4 mb-4 border border-gray-600/50">
              <p className="text-sm text-gray-300 leading-relaxed">
                {message}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-gray-700/30 rounded-xl p-3 border border-gray-600/50">
                <div className="text-xs text-gray-400 mb-1">Duration</div>
                <div className="text-lg font-semibold text-white">
                  {formatDuration(durationMinutes)}
                </div>
              </div>
              <div className="bg-gray-700/30 rounded-xl p-3 border border-gray-600/50">
                <div className="text-xs text-gray-400 mb-1">Trades</div>
                <div className="text-lg font-semibold text-white">
                  {tradesInSession}
                </div>
              </div>
            </div>

            {targetValue > 0 && (
              <div className="bg-gray-700/30 rounded-xl p-4 mb-6 border border-gray-600/50">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-gray-400">Session Progress</span>
                  <span className="text-sm font-semibold text-white">
                    ${currentProgress.toFixed(2)} / ${targetValue.toFixed(2)}
                  </span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2 mb-2">
                  <div
                    className={`h-2 bg-gradient-to-r ${
                      currentProgress >= targetValue
                        ? 'from-emerald-500 to-green-500'
                        : 'from-blue-500 to-cyan-500'
                    } rounded-full transition-all duration-500`}
                    style={{ width: `${Math.min(progressPercent, 100)}%` }}
                  />
                </div>
                <div className="text-xs text-gray-500 text-right">
                  {progressPercent.toFixed(1)}% Complete
                </div>
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={handleStartNew}
                className="w-full flex items-center justify-center gap-3 px-4 py-4 bg-gradient-to-r from-emerald-600 to-blue-600 hover:from-emerald-500 hover:to-blue-500 rounded-xl text-white font-semibold transition-all duration-300 shadow-lg hover:shadow-emerald-500/25 hover:scale-[1.02] active:scale-[0.98]"
              >
                <Play className="w-5 h-5" />
                <span>Start New Session</span>
              </button>

              <button
                onClick={onDismiss}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-gray-700/50 hover:bg-gray-700 rounded-xl text-gray-300 font-medium transition-all duration-300 border border-gray-600/50"
              >
                <span>Dismiss</span>
              </button>
            </div>

            <div className="mt-4 pt-4 border-t border-gray-700">
              <p className="text-xs text-gray-500 text-center">
                Sessions auto-close after 60 seconds of no response to protect your time
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
