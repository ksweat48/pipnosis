import React, { useState, useEffect } from 'react';
import { X, RefreshCw, AlertTriangle } from 'lucide-react';
import { adminUserService, UserDetails } from '../../services/admin-user-service';
import { useToast } from '../../hooks/useToast';

interface ResetSessionDialogProps {
  userId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export const ResetSessionDialog: React.FC<ResetSessionDialogProps> = ({
  userId,
  onClose,
  onSuccess,
}) => {
  const [sessions, setSessions] = useState<UserDetails['goal_sessions']['sessions']>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    const loadSessions = async () => {
      try {
        setLoadingSessions(true);
        const details = await adminUserService.getUserDetails(userId);
        const stuckSessions = details.goal_sessions.sessions.filter(
          (s) => s.status === 'awaiting_user_action'
        );
        setSessions(stuckSessions);
      } catch (error) {
        showToast('Failed to load user sessions', 'error');
        console.error(error);
        onClose();
      } finally {
        setLoadingSessions(false);
      }
    };

    loadSessions();
  }, [userId, showToast, onClose]);

  const handleReset = async () => {
    if (!selectedSessionId) return;

    try {
      setLoading(true);
      const result = await adminUserService.resetStuckSession(userId, selectedSessionId);

      if (result.success) {
        showToast(
          `Session reset successfully. Progress recalculated to $${result.recalculated_progress?.toFixed(2) || '0.00'}`,
          'success'
        );
        onSuccess();
      } else {
        showToast(result.error || 'Failed to reset session', 'error');
      }
    } catch (error) {
      showToast('Failed to reset session', 'error');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const selectedSession = sessions.find((s) => s.id === selectedSessionId);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90dvh] flex flex-col" style={{ WebkitOverflowScrolling: 'touch', scrollBehavior: 'auto' }}>
        <div className="border-b border-gray-700 p-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <RefreshCw size={24} className="text-amber-400" />
            Reset Stuck Session
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700 rounded transition-colors"
          >
            <X size={24} className="text-gray-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4" style={{ minHeight: 0 }}>
          {loadingSessions ? (
            <div className="text-center py-8 text-gray-400">Loading sessions...</div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-8">
              <AlertTriangle size={48} className="mx-auto text-gray-600 mb-4" />
              <div className="text-gray-400">No stuck sessions found for this user</div>
            </div>
          ) : !showConfirm ? (
            <>
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={20} className="text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-gray-300">
                    Select a stuck session below to reset it back to scanning status. The progress will be recalculated from all closed trades.
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-sm font-medium text-gray-400 mb-2">
                  Stuck Sessions ({sessions.length}):
                </div>
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`bg-gray-900 rounded-lg p-4 cursor-pointer transition-all ${
                      selectedSessionId === session.id
                        ? 'ring-2 ring-amber-500'
                        : 'hover:bg-gray-750'
                    }`}
                    onClick={() => setSelectedSessionId(session.id)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="text-white font-medium">
                          Goal: {formatCurrency(session.target_value)}
                        </div>
                        <div className="text-sm text-gray-400">
                          Progress: {formatCurrency(session.current_progress)} (
                          {((session.current_progress / session.target_value) * 100).toFixed(1)}%)
                        </div>
                      </div>
                      <span className="px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded">
                        {session.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500">
                      Created: {formatDate(session.created_at)}
                    </div>
                    <div className="text-xs text-gray-500 font-mono mt-1">
                      ID: {session.id}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-red-400 font-semibold mb-1">Confirm Session Reset</div>
                    <div className="text-sm text-gray-300">
                      This will reset the session status to "scanning" and recalculate the progress from all closed trades. This action cannot be undone.
                    </div>
                  </div>
                </div>
              </div>

              {selectedSession && (
                <div className="bg-gray-900 rounded-lg p-4">
                  <div className="text-sm text-gray-400 mb-2">Session to reset:</div>
                  <div className="text-white font-medium mb-1">
                    Goal: {formatCurrency(selectedSession.target_value)}
                  </div>
                  <div className="text-sm text-gray-400 mb-1">
                    Current Progress: {formatCurrency(selectedSession.current_progress)}
                  </div>
                  <div className="text-xs text-gray-500 font-mono">
                    ID: {selectedSession.id}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex-shrink-0 border-t border-gray-700 p-4">
          {loadingSessions ? null : sessions.length === 0 ? (
            <button
              onClick={onClose}
              className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
            >
              Close
            </button>
          ) : !showConfirm ? (
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => setShowConfirm(true)}
                className="flex-1 px-4 py-2 bg-amber-500 text-black font-semibold rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!selectedSessionId}
              >
                Reset Selected Session
              </button>
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
                disabled={loading}
              >
                Back
              </button>
              <button
                onClick={handleReset}
                className="flex-1 px-4 py-2 bg-red-500 text-white font-semibold rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={loading}
              >
                {loading ? 'Resetting...' : 'Confirm Reset'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
