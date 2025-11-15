/**
 * Session Milestone Tracker Component
 *
 * Displays progress toward the next 100-session milestone and shows
 * history of completed milestone analyses.
 */

import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { TrendingUp, Target, Clock, CheckCircle, AlertCircle, Brain } from 'lucide-react';

interface MilestoneStatus {
  totalSessions: number;
  sessionsSinceMilestone: number;
  lastMilestone: number;
  nextMilestoneAt: number;
  progressPercentage: number;
  lastSessionAt: string | null;
  lastMilestoneAnalyzedAt: string | null;
}

interface MilestoneLog {
  id: string;
  milestoneNumber: number;
  totalSessionsAnalyzed: number;
  batchWinRate: number;
  batchProfitFactor: number;
  batchTotalPnl: number;
  analysisStatus: string;
  createdAt: string;
  gpt4oAnalysisCompletedAt: string | null;
}

export function SessionMilestoneTracker() {
  const { user } = useAuth();
  const [status, setStatus] = useState<MilestoneStatus | null>(null);
  const [recentMilestones, setRecentMilestones] = useState<MilestoneLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.id) {
      loadMilestoneData();

      // Refresh every 30 seconds
      const interval = setInterval(loadMilestoneData, 30000);
      return () => clearInterval(interval);
    }
  }, [user?.id]);

  const loadMilestoneData = async () => {
    if (!user?.id) return;

    try {
      // Get counter status
      const { data: counterData, error: counterError } = await supabase
        .rpc('get_session_counter_status', { p_user_id: user.id });

      if (counterError) {
        console.error('Error fetching milestone status:', counterError);
      } else if (counterData) {
        setStatus({
          totalSessions: counterData.total_sessions || 0,
          sessionsSinceMilestone: counterData.sessions_since_milestone || 0,
          lastMilestone: counterData.last_milestone || 0,
          nextMilestoneAt: counterData.next_milestone_at || 100,
          progressPercentage: counterData.progress_percentage || 0,
          lastSessionAt: counterData.last_session_at,
          lastMilestoneAnalyzedAt: counterData.last_milestone_analyzed_at
        });
      }

      // Get recent milestones
      const { data: milestonesData, error: milestonesError } = await supabase
        .from('session_milestone_log')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5);

      if (milestonesError) {
        console.error('Error fetching milestone history:', milestonesError);
      } else if (milestonesData) {
        setRecentMilestones(milestonesData.map((m: any) => ({
          id: m.id,
          milestoneNumber: m.milestone_number,
          totalSessionsAnalyzed: m.total_sessions_analyzed,
          batchWinRate: m.batch_win_rate,
          batchProfitFactor: m.batch_profit_factor,
          batchTotalPnl: m.batch_total_pnl,
          analysisStatus: m.analysis_status,
          createdAt: m.created_at,
          gpt4oAnalysisCompletedAt: m.gpt4o_analysis_completed_at
        })));
      }
    } catch (error) {
      console.error('Error loading milestone data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-700 rounded w-1/3 mb-4"></div>
          <div className="h-24 bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }

  if (!status) {
    return null;
  }

  const sessionsRemaining = 100 - status.sessionsSinceMilestone;
  const isNearMilestone = sessionsRemaining <= 10;

  return (
    <div className="space-y-4">
      {/* Progress Card */}
      <div className="bg-gradient-to-br from-blue-900/40 to-purple-900/40 rounded-lg p-6 border border-blue-500/30">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-blue-400" />
            <h3 className="text-lg font-semibold text-white">
              100-Session Milestone Progress
            </h3>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Clock className="w-4 h-4" />
            <span>Next: Session {status.nextMilestoneAt}</span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mb-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-300">
              {status.sessionsSinceMilestone} / 100 sessions
            </span>
            <span className={`font-semibold ${isNearMilestone ? 'text-yellow-400' : 'text-blue-400'}`}>
              {status.progressPercentage.toFixed(1)}%
            </span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all duration-500 ${
                isNearMilestone
                  ? 'bg-gradient-to-r from-yellow-500 to-orange-500'
                  : 'bg-gradient-to-r from-blue-500 to-purple-500'
              }`}
              style={{ width: `${status.progressPercentage}%` }}
            ></div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="bg-gray-800/50 rounded p-3">
            <div className="text-2xl font-bold text-blue-400">{status.totalSessions}</div>
            <div className="text-xs text-gray-400">Total Sessions</div>
          </div>
          <div className="bg-gray-800/50 rounded p-3">
            <div className="text-2xl font-bold text-purple-400">{sessionsRemaining}</div>
            <div className="text-xs text-gray-400">Until Analysis</div>
          </div>
          <div className="bg-gray-800/50 rounded p-3">
            <div className="text-2xl font-bold text-green-400">{status.lastMilestone}</div>
            <div className="text-xs text-gray-400">Last Milestone</div>
          </div>
        </div>

        {/* Near Milestone Alert */}
        {isNearMilestone && (
          <div className="mt-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
            <div className="flex items-center gap-2 text-yellow-400">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm font-medium">
                Approaching milestone! GPT-4o strategic analysis will trigger in {sessionsRemaining} sessions.
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Milestone History */}
      {recentMilestones.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center gap-2 mb-4">
            <Brain className="w-5 h-5 text-purple-400" />
            <h3 className="text-lg font-semibold text-white">Recent Milestone Analyses</h3>
          </div>

          <div className="space-y-3">
            {recentMilestones.map((milestone) => (
              <div
                key={milestone.id}
                className="bg-gray-700/50 rounded-lg p-4 border border-gray-600"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-blue-400">
                      Milestone {milestone.milestoneNumber}
                    </span>
                    <StatusBadge status={milestone.analysisStatus} />
                  </div>
                  <span className="text-xs text-gray-400">
                    {new Date(milestone.createdAt).toLocaleDateString()}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-3 text-sm">
                  <div>
                    <div className="text-gray-400 text-xs">Sessions</div>
                    <div className="text-white font-semibold">
                      {milestone.totalSessionsAnalyzed}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-400 text-xs">Win Rate</div>
                    <div className="text-green-400 font-semibold">
                      {milestone.batchWinRate?.toFixed(1) || '0.0'}%
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-400 text-xs">Profit Factor</div>
                    <div className="text-blue-400 font-semibold">
                      {milestone.batchProfitFactor?.toFixed(2) || '0.00'}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-400 text-xs">Total P&L</div>
                    <div
                      className={`font-semibold ${
                        (milestone.batchTotalPnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}
                    >
                      ${milestone.batchTotalPnl?.toFixed(2) || '0.00'}
                    </div>
                  </div>
                </div>

                {milestone.gpt4oAnalysisCompletedAt && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-gray-400">
                    <CheckCircle className="w-3 h-3 text-green-400" />
                    <span>
                      GPT-4o analysis completed {' '}
                      {new Date(milestone.gpt4oAnalysisCompletedAt).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info Card */}
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
        <div className="flex items-start gap-3">
          <TrendingUp className="w-5 h-5 text-blue-400 mt-0.5" />
          <div className="text-sm text-gray-300">
            <p className="font-medium text-white mb-1">About 100-Session Milestones</p>
            <p>
              Every 100 completed backtest sessions, GPT-4o analyzes your cumulative performance
              and provides strategic recommendations for the next 100 sessions. This helps identify
              long-term trends and systematic improvements.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const configs = {
    pending: { color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30', text: 'Pending' },
    analyzing: { color: 'text-blue-400 bg-blue-500/10 border-blue-500/30', text: 'Analyzing...' },
    completed: { color: 'text-green-400 bg-green-500/10 border-green-500/30', text: 'Completed' },
    failed: { color: 'text-red-400 bg-red-500/10 border-red-500/30', text: 'Failed' }
  };

  const config = configs[status as keyof typeof configs] || configs.pending;

  return (
    <span className={`text-xs px-2 py-0.5 rounded border ${config.color}`}>
      {config.text}
    </span>
  );
}
