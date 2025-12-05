import React, { useState, useEffect } from 'react';
import { Play, Pause, Square, Clock, TrendingUp, TrendingDown } from 'lucide-react';
import { sessionManagementService, type TradingSession } from '@/services/session-management-service';
import { sessionReportGenerator, type SessionReport } from '@/services/session-report-generator';
import { SPCProgressBar } from './SPCProgressBar';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';

export function SessionDashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const { confirm } = useConfirmDialog();
  const [activeSession, setActiveSession] = useState<TradingSession | null>(null);
  const [recentSessions, setRecentSessions] = useState<TradingSession[]>([]);
  const [latestReport, setLatestReport] = useState<SessionReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [sessionNotes, setSessionNotes] = useState('');

  useEffect(() => {
    if (user?.id) {
      loadActiveSession();
      loadRecentSessions();
      loadLatestReport();
    }
  }, [user?.id]);

  const loadActiveSession = async () => {
    if (!user?.id) return;
    const session = await sessionManagementService.getActiveSession(user.id);
    setActiveSession(session);
  };

  const loadRecentSessions = async () => {
    if (!user?.id) return;
    const sessions = await sessionManagementService.getRecentSessions(user.id, 5);
    setRecentSessions(sessions);
  };

  const loadLatestReport = async () => {
    if (!user?.id) return;
    const reports = await sessionReportGenerator.getRecentReports(user.id, 1);
    if (reports.length > 0) {
      setLatestReport(reports[0]);
    }
  };

  const handleStartSession = async () => {
    if (!user?.id) return;
    setLoading(true);

    const result = await sessionManagementService.startSession(
      user.id,
      sessionName || undefined,
      sessionNotes || undefined
    );

    if (result.success) {
      await loadActiveSession();
      setSessionName('');
      setSessionNotes('');
      toast.success('Session Started', 'Your trading session has begun');
    } else {
      toast.error('Failed to Start', result.error || 'Could not start session');
    }

    setLoading(false);
  };

  const handlePauseSession = async () => {
    if (!user?.id || !activeSession) return;
    setLoading(true);

    const result = await sessionManagementService.pauseSession(user.id, activeSession.id);

    if (result.success) {
      await loadActiveSession();
    }

    setLoading(false);
  };

  const handleResumeSession = async () => {
    if (!user?.id || !activeSession) return;
    setLoading(true);

    const result = await sessionManagementService.resumeSession(user.id, activeSession.id);

    if (result.success) {
      await loadActiveSession();
    }

    setLoading(false);
  };

  const handleEndSession = async () => {
    if (!user?.id || !activeSession) return;

    const confirmed = await confirm({
      title: 'End Trading Session',
      message: 'Are you sure you want to end this session? A session report will be generated.',
      confirmText: 'End Session',
      cancelText: 'Continue Trading',
      variant: 'warning'
    });

    if (!confirmed) return;

    setLoading(true);

    // End session
    const result = await sessionManagementService.endSession(user.id, activeSession.id);

    if (result.success) {
      // Generate report
      const reportResult = await sessionReportGenerator.generateSessionReport(user.id, activeSession.id);

      if (reportResult.success && reportResult.report) {
        setLatestReport(reportResult.report);
        toast.success('Session Ended', 'Your session report has been generated');
      }

      await loadActiveSession();
      await loadRecentSessions();
    } else {
      toast.error('Failed to End', result.error || 'Could not end session');
    }

    setLoading(false);
  };

  const formatDuration = (start: string, end?: string | null) => {
    const startTime = new Date(start).getTime();
    const endTime = end ? new Date(end).getTime() : Date.now();
    const durationMs = endTime - startTime;

    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

    return `${hours}h ${minutes}m`;
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Active Session Card */}
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-6">
        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-blue-400" />
          Trading Session
        </h2>

        {activeSession ? (
          <div className="space-y-4">
            {/* Session Info */}
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">
                    {activeSession.session_name || 'Active Session'}
                  </h3>
                  <p className="text-sm text-gray-400">
                    Started {new Date(activeSession.session_start).toLocaleString()}
                  </p>
                </div>
                <div className={`px-3 py-1 rounded-full text-xs font-semibold ${
                  activeSession.session_status === 'active'
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-yellow-500/20 text-yellow-400'
                }`}>
                  {activeSession.session_status.toUpperCase()}
                </div>
              </div>

              {/* Session Metrics */}
              <div className="grid grid-cols-4 gap-4 mt-4">
                <div className="bg-gray-900 rounded p-3">
                  <div className="text-xs text-gray-400 mb-1">Trades</div>
                  <div className="text-xl font-bold text-white">{activeSession.total_trades}</div>
                </div>
                <div className="bg-gray-900 rounded p-3">
                  <div className="text-xs text-gray-400 mb-1">Win Rate</div>
                  <div className="text-xl font-bold text-white">{activeSession.win_rate.toFixed(1)}%</div>
                </div>
                <div className="bg-gray-900 rounded p-3">
                  <div className="text-xs text-gray-400 mb-1">P/L</div>
                  <div className={`text-xl font-bold ${
                    parseFloat(activeSession.total_pnl) >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    ${activeSession.total_pnl}
                  </div>
                </div>
                <div className="bg-gray-900 rounded p-3">
                  <div className="text-xs text-gray-400 mb-1">Duration</div>
                  <div className="text-xl font-bold text-white">
                    {formatDuration(activeSession.session_start, activeSession.session_end)}
                  </div>
                </div>
              </div>
            </div>

            {/* Control Buttons */}
            <div className="flex gap-3">
              {activeSession.session_status === 'active' ? (
                <button
                  onClick={handlePauseSession}
                  disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  <Pause className="w-4 h-4" />
                  Pause Session
                </button>
              ) : (
                <button
                  onClick={handleResumeSession}
                  disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  <Play className="w-4 h-4" />
                  Resume Session
                </button>
              )}

              <button
                onClick={handleEndSession}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                <Square className="w-4 h-4" />
                End Session
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-gray-400">No active session. Start a new trading session to begin tracking.</p>

            <div className="space-y-3">
              <input
                type="text"
                placeholder="Session name (optional)"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />

              <textarea
                placeholder="Session notes (optional)"
                value={sessionNotes}
                onChange={(e) => setSessionNotes(e.target.value)}
                rows={3}
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />

              <button
                onClick={handleStartSession}
                disabled={loading}
                className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 font-semibold"
              >
                <Play className="w-5 h-5" />
                Start New Session
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Latest Session Report */}
      {latestReport && (
        <div className="bg-gray-900 rounded-lg border border-gray-800 p-6">
          <h2 className="text-xl font-bold text-white mb-4">Latest Session Report</h2>

          {/* Progress Bar */}
          <SPCProgressBar
            segments={latestReport.progressBarData}
            cumulativeSPC={latestReport.cumulativeSPCAfter}
            targetSPC={latestReport.cumulativeSPCAfter + (latestReport.progressToNextTierPercent > 0 ? 10 : 0)}
            progressPercent={latestReport.progressToNextTierPercent}
            nextTier={latestReport.currentTier}
          />

          {/* Report Content */}
          <div className="mt-6 prose prose-invert max-w-none">
            <div className="whitespace-pre-wrap text-sm text-gray-300">
              {latestReport.reportContent}
            </div>
          </div>
        </div>
      )}

      {/* Recent Sessions */}
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-6">
        <h2 className="text-xl font-bold text-white mb-4">Recent Sessions</h2>

        <div className="space-y-3">
          {recentSessions.map((session) => (
            <div
              key={session.id}
              className="bg-gray-800 rounded-lg p-4 hover:bg-gray-750 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-white">
                      {session.session_name || 'Session'}
                    </h3>
                    <span className={`text-xs px-2 py-1 rounded ${
                      session.session_status === 'ended'
                        ? 'bg-gray-700 text-gray-300'
                        : 'bg-green-500/20 text-green-400'
                    }`}>
                      {session.session_status}
                    </span>
                    {session.session_grade && (
                      <span className="text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-400">
                        Grade: {session.session_grade}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-400 mt-1">
                    {new Date(session.session_start).toLocaleDateString()} • {session.total_trades} trades
                  </p>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-xs text-gray-400">SPC</div>
                    <div className={`text-lg font-bold ${
                      parseFloat(session.session_spc) >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {parseFloat(session.session_spc) >= 0 ? '+' : ''}
                      {parseFloat(session.session_spc).toFixed(2)}
                    </div>
                  </div>

                  {parseFloat(session.session_spc) >= 0 ? (
                    <TrendingUp className="w-5 h-5 text-green-400" />
                  ) : (
                    <TrendingDown className="w-5 h-5 text-red-400" />
                  )}
                </div>
              </div>
            </div>
          ))}

          {recentSessions.length === 0 && (
            <p className="text-gray-500 text-center py-8">No sessions yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
