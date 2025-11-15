import React, { useState, useEffect } from 'react';
import { learningPipelineHealthCheck, type PipelineStage, type PipelineHealthReport } from '../services/learning-pipeline-health-check';
import { useAuth } from '../hooks/useAuth';
import {
  Activity,
  AlertCircle,
  CheckCircle,
  Clock,
  Zap,
  TrendingUp,
  BarChart2,
  Brain,
  Eye,
  Target,
  Award,
  Lightbulb,
  RefreshCw,
  AlertTriangle
} from 'lucide-react';

export default function LearningPipelineMonitor() {
  const { user } = useAuth();
  const [healthReport, setHealthReport] = useState<PipelineHealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    if (user) {
      loadHealthReport();
    }
  }, [user]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    if (!autoRefresh || !user) return;

    const interval = setInterval(() => {
      loadHealthReport();
    }, 10000);

    return () => clearInterval(interval);
  }, [autoRefresh, user]);

  const loadHealthReport = async () => {
    if (!user) return;

    try {
      const report = await learningPipelineHealthCheck.checkPipelineHealth(user.id);
      setHealthReport(report);
      setLastRefresh(new Date());
    } catch (error) {
      console.error('[Pipeline Monitor] Error loading health report:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStageIcon = (stageId: string) => {
    switch (stageId) {
      case 'trade_capture':
        return <Activity className="w-5 h-5" />;
      case 'trade_analysis':
        return <Brain className="w-5 h-5" />;
      case 'pattern_recognition':
        return <Eye className="w-5 h-5" />;
      case 'session_learning':
        return <Lightbulb className="w-5 h-5" />;
      case 'gpt4o_strategist':
        return <Brain className="w-5 h-5" />;
      case 'gpt4o_interpreter':
        return <Eye className="w-5 h-5" />;
      case 'strategy_discovery':
        return <Target className="w-5 h-5" />;
      case 'skill_progression':
        return <Award className="w-5 h-5" />;
      case 'performance_evolution':
        return <TrendingUp className="w-5 h-5" />;
      case 'market_scenario':
        return <BarChart2 className="w-5 h-5" />;
      default:
        return <Zap className="w-5 h-5" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'text-green-500 bg-green-500/10 border-green-500/20';
      case 'warning':
        return 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20';
      case 'error':
        return 'text-red-500 bg-red-500/10 border-red-500/20';
      case 'idle':
        return 'text-gray-500 bg-gray-500/10 border-gray-500/20';
      default:
        return 'text-gray-500 bg-gray-500/10 border-gray-500/20';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      case 'idle':
        return <Clock className="w-4 h-4 text-gray-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  const formatTimestamp = (timestamp: string | null) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-3">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
          <span className="text-gray-400">Running pipeline diagnostics...</span>
        </div>
      </div>
    );
  }

  if (!healthReport) {
    return (
      <div className="bg-slate-800 border border-red-500/20 rounded-lg p-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-6 h-6 text-red-500 mt-0.5" />
          <div>
            <h3 className="text-lg font-semibold text-white mb-1">Pipeline Health Check Failed</h3>
            <p className="text-gray-400">Unable to load pipeline status. Please check your connection and try again.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-lg ${getStatusColor(healthReport.overallStatus)}`}>
              {getStatusIcon(healthReport.overallStatus)}
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">Learning Pipeline Status</h2>
              <p className="text-sm text-gray-400">Real-time monitoring of AI learning system</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-2xl font-bold text-white">{healthReport.overallHealthScore}%</div>
              <div className="text-xs text-gray-400">Health Score</div>
            </div>
            <button
              onClick={loadHealthReport}
              className="p-2 bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
              title="Refresh now"
            >
              <RefreshCw className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>

        {/* Overall Status Banner */}
        <div className={`p-4 rounded-lg border ${getStatusColor(healthReport.overallStatus)}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {healthReport.overallStatus === 'healthy' && (
                <>
                  <CheckCircle className="w-6 h-6 text-green-500" />
                  <span className="text-white font-semibold">All systems operational</span>
                </>
              )}
              {healthReport.overallStatus === 'warning' && (
                <>
                  <AlertTriangle className="w-6 h-6 text-yellow-500" />
                  <span className="text-white font-semibold">Some stages need attention</span>
                </>
              )}
              {healthReport.overallStatus === 'error' && (
                <>
                  <AlertCircle className="w-6 h-6 text-red-500" />
                  <span className="text-white font-semibold">Pipeline errors detected</span>
                </>
              )}
            </div>
            <div className="text-sm text-gray-400">
              Last updated: {formatTimestamp(lastRefresh.toISOString())}
            </div>
          </div>
        </div>
      </div>

      {/* Data Flow Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400">Trades Today</span>
            <Activity className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-bold text-white">{healthReport.dataFlowSummary.tradesProcessedToday}</div>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400">Insights Today</span>
            <Lightbulb className="w-4 h-4 text-yellow-500" />
          </div>
          <div className="text-2xl font-bold text-white">{healthReport.dataFlowSummary.insightsGeneratedToday}</div>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400">GPT-4o Calls Today</span>
            <Brain className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-2xl font-bold text-white">{healthReport.dataFlowSummary.gpt4oCallsToday}</div>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400">Skill Updates Today</span>
            <Award className="w-4 h-4 text-green-500" />
          </div>
          <div className="text-2xl font-bold text-white">{healthReport.dataFlowSummary.skillUpdatesToday}</div>
        </div>
      </div>

      {/* Alerts */}
      {healthReport.alerts.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-white font-semibold mb-2">Active Alerts</h3>
              <ul className="space-y-1">
                {healthReport.alerts.map((alert, index) => (
                  <li key={index} className="text-sm text-red-300">{alert}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Recommendations */}
      {healthReport.recommendations.length > 0 && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Lightbulb className="w-5 h-5 text-blue-500 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-white font-semibold mb-2">Recommendations</h3>
              <ul className="space-y-1">
                {healthReport.recommendations.map((rec, index) => (
                  <li key={index} className="text-sm text-blue-300">{rec}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Pipeline Stages */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Pipeline Stages</h3>
        <div className="space-y-3">
          {healthReport.stages.map((stage, index) => (
            <div key={stage.id} className="relative">
              {/* Connector Line */}
              {index < healthReport.stages.length - 1 && (
                <div className="absolute left-6 top-12 bottom-0 w-0.5 bg-slate-700" />
              )}

              {/* Stage Card */}
              <div className={`relative bg-slate-900 border rounded-lg p-4 ${getStatusColor(stage.status)}`}>
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className={`p-2 rounded-lg ${getStatusColor(stage.status)}`}>
                    {getStageIcon(stage.id)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <h4 className="text-white font-semibold">{stage.name}</h4>
                      {getStatusIcon(stage.status)}
                    </div>
                    <p className="text-sm text-gray-400 mb-3">{stage.description}</p>

                    {/* Metrics */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <div className="text-xs text-gray-500">Last Activity</div>
                        <div className="text-sm text-white font-medium">{formatTimestamp(stage.lastActivity)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">Today</div>
                        <div className="text-sm text-white font-medium">{stage.processedToday}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">This Week</div>
                        <div className="text-sm text-white font-medium">{stage.processedThisWeek}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">Success Rate</div>
                        <div className="text-sm text-white font-medium">{stage.successRate.toFixed(0)}%</div>
                      </div>
                    </div>

                    {/* Error Messages */}
                    {stage.errorMessages.length > 0 && (
                      <div className="mt-3 p-2 bg-red-500/10 border border-red-500/20 rounded">
                        {stage.errorMessages.map((error, i) => (
                          <div key={i} className="text-xs text-red-300">{error}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Auto-refresh Toggle */}
      <div className="flex items-center justify-center gap-3 text-sm text-gray-400">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="rounded"
          />
          Auto-refresh every 10 seconds
        </label>
      </div>
    </div>
  );
}
