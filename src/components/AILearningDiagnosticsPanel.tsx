import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { aiLearningHealthCheck, LearningHealthStatus, LearningDataSummary } from '../services/ai-learning-health-check';
import {
  Activity,
  AlertCircle,
  CheckCircle,
  TrendingUp,
  Database,
  Brain,
  BarChart3,
  Target,
  Sparkles,
  RefreshCw,
  XCircle,
  AlertTriangle,
  BookOpen,
  Zap
} from 'lucide-react';

export default function AILearningDiagnosticsPanel() {
  const { user } = useAuth();
  const [health, setHealth] = useState<LearningHealthStatus | null>(null);
  const [summary, setSummary] = useState<LearningDataSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  useEffect(() => {
    if (user) {
      runHealthCheck();
    }
  }, [user]);

  const runHealthCheck = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const [healthData, summaryData] = await Promise.all([
        aiLearningHealthCheck.checkSystemHealth(user.id),
        aiLearningHealthCheck.getLearningDataSummary(user.id)
      ]);

      setHealth(healthData);
      setSummary(summaryData);
    } catch (error) {
      console.error('[AI Learning Diagnostics] Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const runFullDiagnostic = async () => {
    if (!user) return;

    setTesting(true);
    try {
      const result = await aiLearningHealthCheck.runDiagnosticTest(user.id);
      setTestResult(result);

      // Update health and summary from test results
      if (result.details) {
        setHealth(result.details.health);
        setSummary(result.details.summary);
      }
    } catch (error) {
      console.error('[AI Learning Diagnostics] Test failed:', error);
      setTestResult({
        success: false,
        message: 'Test failed: ' + (error as Error).message,
        details: {}
      });
    } finally {
      setTesting(false);
    }
  };

  if (loading && !health) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!health) {
    return (
      <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-6 text-center">
        <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-white mb-2">Unable to Load Diagnostics</h3>
        <p className="text-gray-400 mb-4">Could not connect to AI learning system</p>
        <button
          onClick={runHealthCheck}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold"
        >
          Retry
        </button>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'text-green-400';
      case 'warning': return 'text-yellow-400';
      case 'error': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy': return <CheckCircle className="w-8 h-8 text-green-400" />;
      case 'warning': return <AlertTriangle className="w-8 h-8 text-yellow-400" />;
      case 'error': return <XCircle className="w-8 h-8 text-red-400" />;
      default: return <AlertCircle className="w-8 h-8 text-gray-400" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-br from-blue-900/30 to-purple-900/30 backdrop-blur-sm border-2 border-blue-500/30 rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="w-8 h-8 text-blue-400" />
            <div>
              <h2 className="text-2xl font-bold text-white">AI Learning System Diagnostics</h2>
              <p className="text-gray-400">Real-time health monitoring and verification</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={runHealthCheck}
              disabled={loading}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md font-semibold transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={runFullDiagnostic}
              disabled={testing}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <Zap className={`w-4 h-4 ${testing ? 'animate-pulse' : ''}`} />
              {testing ? 'Testing...' : 'Run Full Test'}
            </button>
          </div>
        </div>
      </div>

      {/* Overall Status */}
      <div className={`bg-gradient-to-br ${
        health.overall === 'healthy' ? 'from-green-900/20 to-emerald-900/20 border-green-500/30' :
        health.overall === 'warning' ? 'from-yellow-900/20 to-orange-900/20 border-yellow-500/30' :
        'from-red-900/20 to-orange-900/20 border-red-500/30'
      } backdrop-blur-sm border-2 rounded-lg shadow-md p-6`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {getStatusIcon(health.overall)}
            <div>
              <h3 className="text-2xl font-bold text-white mb-1">
                System Status: <span className={getStatusColor(health.overall)}>{health.overall.toUpperCase()}</span>
              </h3>
              <p className="text-gray-400">
                {health.issues.length === 0 ? 'All systems operational' : `${health.issues.length} issue(s) detected`}
              </p>
            </div>
          </div>
          {health.stats.lastLearningDate && (
            <div className="text-right">
              <div className="text-sm text-gray-400">Last Learning Activity</div>
              <div className="text-lg font-semibold text-white">
                {new Date(health.stats.lastLearningDate).toLocaleString()}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* System Checks Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatusCard
          icon={<Database className="w-6 h-6 text-blue-500" />}
          label="Tables Exist"
          status={health.checks.tablesExist}
        />
        <StatusCard
          icon={<Brain className="w-6 h-6 text-purple-500" />}
          label="Learning Insights"
          status={health.checks.hasLearningInsights}
          count={health.stats.totalInsights}
        />
        <StatusCard
          icon={<BarChart3 className="w-6 h-6 text-green-500" />}
          label="Trade Analysis"
          status={health.checks.hasTradeAnalysis}
          count={health.stats.totalTradeAnalyses}
        />
        <StatusCard
          icon={<TrendingUp className="w-6 h-6 text-yellow-500" />}
          label="Performance Tracking"
          status={health.checks.hasPerformanceEvolution}
          count={health.stats.totalPerformanceRecords}
        />
        <StatusCard
          icon={<Target className="w-6 h-6 text-red-500" />}
          label="Skill Progression"
          status={health.checks.hasSkillProgression}
          value={health.stats.skillLevel}
        />
        <StatusCard
          icon={<Sparkles className="w-6 h-6 text-cyan-500" />}
          label="Recent Activity"
          status={health.checks.recentLearningActivity}
          value={`${health.stats.insightsLast24h} today`}
        />
      </div>

      {/* Stats Summary */}
      {summary && (
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-6">
          <h3 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-400" />
            Learning Data Summary
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <StatBox label="Total Insights" value={summary.insights.total} color="text-blue-400" />
            <StatBox label="Trade Analyses" value={summary.tradeAnalyses.total} color="text-green-400" />
            <StatBox label="Session Learnings" value={summary.sessionLearnings.total} color="text-purple-400" />
            <StatBox label="Performance Records" value={summary.performanceEvolution.total} color="text-yellow-400" />
          </div>

          {summary.skillProgression && (
            <div className="mt-6 p-4 bg-blue-900/20 border border-blue-500/30 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <span className="text-white font-semibold">Current Skill Level</span>
                <span className="text-2xl font-bold text-blue-400">{summary.skillProgression.currentLevel}</span>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Progress to Next Level</span>
                  <span className="text-white font-semibold">{summary.skillProgression.progressPercent.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all"
                    style={{ width: `${Math.min(100, summary.skillProgression.progressPercent)}%` }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4 mt-3 text-sm">
                  <div>
                    <span className="text-gray-400">Total Trades:</span>
                    <span className="text-white font-semibold ml-2">{summary.skillProgression.totalTrades}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Win Rate:</span>
                    <span className="text-white font-semibold ml-2">{summary.skillProgression.winRate.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {summary.tradeAnalyses.byOutcome && (
            <div className="mt-4 p-4 bg-gray-900/50 rounded-lg">
              <div className="text-sm font-semibold text-white mb-2">Trade Outcome Distribution</div>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-400">{summary.tradeAnalyses.byOutcome.wins}</div>
                  <div className="text-xs text-gray-400">Wins</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-400">{summary.tradeAnalyses.byOutcome.losses}</div>
                  <div className="text-xs text-gray-400">Losses</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-400">{summary.tradeAnalyses.byOutcome.breakeven}</div>
                  <div className="text-xs text-gray-400">Breakeven</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Issues */}
      {health.issues.length > 0 && (
        <div className="bg-red-900/20 border border-red-500/50 rounded-lg shadow-md p-6">
          <h3 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-400" />
            Issues Detected ({health.issues.length})
          </h3>
          <ul className="space-y-2">
            {health.issues.map((issue, index) => (
              <li key={index} className="flex items-start gap-3 text-gray-300">
                <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <span>{issue}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recommendations */}
      {health.recommendations.length > 0 && (
        <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg shadow-md p-6">
          <h3 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-400" />
            Recommendations ({health.recommendations.length})
          </h3>
          <ul className="space-y-2">
            {health.recommendations.map((rec, index) => (
              <li key={index} className="flex items-start gap-3 text-gray-300">
                <CheckCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Test Results */}
      {testResult && (
        <div className={`${testResult.success ? 'bg-green-900/20 border-green-500/50' : 'bg-red-900/20 border-red-500/50'} border rounded-lg shadow-md p-6`}>
          <h3 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            {testResult.success ? <CheckCircle className="w-5 h-5 text-green-400" /> : <XCircle className="w-5 h-5 text-red-400" />}
            Full Diagnostic Test Results
          </h3>
          <p className={`mb-4 ${testResult.success ? 'text-green-300' : 'text-red-300'}`}>{testResult.message}</p>

          {testResult.details.triggers && (
            <div className="mt-4 p-4 bg-gray-900/50 rounded-lg">
              <h4 className="text-sm font-semibold text-white mb-2">Database Triggers Verification</h4>
              {testResult.details.triggers.triggersFound.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs text-green-400 font-semibold mb-1">Active Triggers:</div>
                  {testResult.details.triggers.triggersFound.map((t: string, i: number) => (
                    <div key={i} className="text-sm text-gray-300 ml-2">{t}</div>
                  ))}
                </div>
              )}
              {testResult.details.triggers.triggersMissing.length > 0 && (
                <div>
                  <div className="text-xs text-red-400 font-semibold mb-1">Missing/Inactive:</div>
                  {testResult.details.triggers.triggersMissing.map((t: string, i: number) => (
                    <div key={i} className="text-sm text-gray-300 ml-2">{t}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusCard({ icon, label, status, count, value }: {
  icon: React.ReactNode;
  label: string;
  status: boolean;
  count?: number;
  value?: string;
}) {
  return (
    <div className={`p-4 rounded-lg border ${status ? 'bg-green-900/20 border-green-500/30' : 'bg-red-900/20 border-red-500/30'}`}>
      <div className="flex items-center justify-between mb-2">
        {icon}
        {status ? (
          <CheckCircle className="w-5 h-5 text-green-400" />
        ) : (
          <XCircle className="w-5 h-5 text-red-400" />
        )}
      </div>
      <div className="text-sm text-gray-400 mb-1">{label}</div>
      {count !== undefined && (
        <div className="text-2xl font-bold text-white">{count}</div>
      )}
      {value && (
        <div className="text-lg font-semibold text-white">{value}</div>
      )}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center">
      <div className={`text-3xl font-bold ${color} mb-1`}>{value}</div>
      <div className="text-sm text-gray-400">{label}</div>
    </div>
  );
}
