import React, { useState, useEffect } from 'react';
import {
  TrendingUp, TrendingDown, CheckCircle, XCircle, Clock, Play, Pause,
  Lightbulb, Target, BarChart3, Activity
} from 'lucide-react';
import { sessionIntelligenceService, ImprovementHypothesis } from '../services/session-intelligence-service';
import { useAuth } from '../hooks/useAuth';

export function LearningImpactTracker() {
  const { user } = useAuth();
  const [improvements, setImprovements] = useState<ImprovementHypothesis[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');

  useEffect(() => {
    if (user) {
      loadImprovements();
    }
  }, [user, filterStatus]);

  const loadImprovements = async () => {
    if (!user) return;

    setLoading(true);
    const filter = filterStatus === 'all' ? undefined : filterStatus;
    const data = await sessionIntelligenceService.fetchImprovements(user.id, filter);
    setImprovements(data);
    setLoading(false);
  };

  const statusCounts = {
    proposed: improvements.filter(i => i.status === 'proposed').length,
    testing: improvements.filter(i => i.status === 'testing').length,
    validated: improvements.filter(i => i.status === 'validated').length,
    rejected: improvements.filter(i => i.status === 'rejected').length,
  };

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="ml-3 text-gray-300">Loading improvement tracking...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xl font-bold text-white">Learning Impact Tracker</h3>
            <p className="text-sm text-gray-400 mt-1">
              Track improvement hypotheses from proposal to validation
            </p>
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex gap-2">
          <FilterTab
            label="All"
            count={improvements.length}
            active={filterStatus === 'all'}
            onClick={() => setFilterStatus('all')}
          />
          <FilterTab
            label="Proposed"
            count={statusCounts.proposed}
            active={filterStatus === 'proposed'}
            onClick={() => setFilterStatus('proposed')}
            color="blue"
          />
          <FilterTab
            label="Testing"
            count={statusCounts.testing}
            active={filterStatus === 'testing'}
            onClick={() => setFilterStatus('testing')}
            color="yellow"
          />
          <FilterTab
            label="Validated"
            count={statusCounts.validated}
            active={filterStatus === 'validated'}
            onClick={() => setFilterStatus('validated')}
            color="green"
          />
          <FilterTab
            label="Rejected"
            count={statusCounts.rejected}
            active={filterStatus === 'rejected'}
            onClick={() => setFilterStatus('rejected')}
            color="red"
          />
        </div>
      </div>

      {/* Improvements List */}
      <div className="p-6">
        {improvements.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            <Lightbulb className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-lg font-medium">No improvements yet</p>
            <p className="text-sm mt-1">
              LLM will generate improvement hypotheses after analyzing your sessions
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {improvements.map((improvement) => (
              <ImprovementCard key={improvement.id} improvement={improvement} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterTab({ label, count, active, onClick, color = 'gray' }: any) {
  const colorClasses = {
    gray: 'bg-gray-700 text-gray-300',
    blue: 'bg-blue-900/30 text-blue-400 border-blue-500/30',
    yellow: 'bg-yellow-900/30 text-yellow-400 border-yellow-500/30',
    green: 'bg-green-900/30 text-green-400 border-green-500/30',
    red: 'bg-red-900/30 text-red-400 border-red-500/30',
  };

  return (
    <button
      onClick={onClick}
      className={`
        px-4 py-2 rounded-lg text-sm font-medium transition-colors border
        ${active
          ? `${colorClasses[color]} border`
          : 'bg-gray-750 text-gray-400 border-gray-600 hover:bg-gray-700'
        }
      `}
    >
      {label}
      <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-gray-800">
        {count}
      </span>
    </button>
  );
}

function ImprovementCard({ improvement }: { improvement: ImprovementHypothesis }) {
  const [expanded, setExpanded] = useState(false);

  const statusConfig = {
    proposed: {
      icon: Lightbulb,
      color: 'blue',
      bg: 'bg-blue-900/20',
      border: 'border-blue-500/30',
      text: 'text-blue-400',
    },
    testing: {
      icon: Activity,
      color: 'yellow',
      bg: 'bg-yellow-900/20',
      border: 'border-yellow-500/30',
      text: 'text-yellow-400',
    },
    validated: {
      icon: CheckCircle,
      color: 'green',
      bg: 'bg-green-900/20',
      border: 'border-green-500/30',
      text: 'text-green-400',
    },
    rejected: {
      icon: XCircle,
      color: 'red',
      bg: 'bg-red-900/20',
      border: 'border-red-500/30',
      text: 'text-red-400',
    },
    paused: {
      icon: Pause,
      color: 'gray',
      bg: 'bg-gray-700/20',
      border: 'border-gray-500/30',
      text: 'text-gray-400',
    },
  };

  const config = statusConfig[improvement.status] || statusConfig.proposed;
  const Icon = config.icon;

  const hasMetrics = improvement.status === 'testing' || improvement.status === 'validated' || improvement.status === 'rejected';
  const isEffective = improvement.effectivenessScore > 0;

  return (
    <div className={`border rounded-lg ${config.bg} ${config.border}`}>
      {/* Card Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-start justify-between hover:bg-gray-800/30 transition-colors"
      >
        <div className="flex items-start gap-3 flex-1">
          {/* Status Icon */}
          <div className={`mt-1 ${config.text}`}>
            <Icon className="w-5 h-5" />
          </div>

          {/* Hypothesis */}
          <div className="flex-1 text-left">
            <p className="text-white font-medium">{improvement.hypothesis}</p>
            <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
              <span className={`px-2 py-1 rounded ${config.bg} ${config.text} font-medium`}>
                {improvement.status.toUpperCase()}
              </span>
              <span>{formatHypothesisType(improvement.hypothesisType)}</span>
              {improvement.sessionsTested > 0 && (
                <span>Tested in {improvement.sessionsTested} session{improvement.sessionsTested !== 1 ? 's' : ''}</span>
              )}
              {improvement.appliedDate && (
                <span>Applied {new Date(improvement.appliedDate).toLocaleDateString()}</span>
              )}
            </div>
          </div>
        </div>

        {/* Effectiveness Score */}
        {hasMetrics && (
          <div className="ml-4 text-right">
            <div className={`text-2xl font-bold ${
              isEffective ? 'text-green-400' : 'text-red-400'
            }`}>
              {isEffective ? '+' : ''}{improvement.effectivenessScore.toFixed(0)}
            </div>
            <div className="text-xs text-gray-400">Effectiveness</div>
          </div>
        )}
      </button>

      {/* Expanded Details */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-700">
          {/* LLM Reasoning */}
          {improvement.llmReasoning && (
            <div className="pt-4">
              <h4 className="text-sm text-gray-400 mb-2">LLM Reasoning</h4>
              <p className="text-white text-sm bg-gray-800 p-3 rounded">
                {improvement.llmReasoning}
              </p>
            </div>
          )}

          {/* Before/After Metrics */}
          {hasMetrics && (
            <div>
              <h4 className="text-sm text-gray-400 mb-3">Performance Impact</h4>
              <div className="grid grid-cols-3 gap-4">
                <MetricComparison
                  label="Win Rate"
                  before={improvement.beforeWinRate}
                  after={improvement.afterWinRate}
                  delta={improvement.winRateDelta}
                  suffix="%"
                  higherIsBetter
                />
                <MetricComparison
                  label="Profit Factor"
                  before={improvement.beforeProfitFactor}
                  after={improvement.afterProfitFactor}
                  delta={improvement.profitFactorDelta}
                  higherIsBetter
                />
                <MetricComparison
                  label="P&L"
                  before={improvement.beforePnl}
                  after={improvement.afterPnl}
                  delta={improvement.pnlDelta}
                  prefix="$"
                  higherIsBetter
                />
              </div>
            </div>
          )}

          {/* Effectiveness Breakdown */}
          {improvement.status === 'validated' && (
            <div className={`p-3 rounded ${config.bg} border ${config.border}`}>
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-4 h-4 text-green-400" />
                <span className="text-green-400 font-medium text-sm">Validated Improvement</span>
              </div>
              <p className="text-gray-300 text-sm">
                This improvement has been proven effective and is recommended for continued use.
                {improvement.tradesAffected > 0 && ` Applied to ${improvement.tradesAffected} trades.`}
              </p>
            </div>
          )}

          {improvement.status === 'rejected' && (
            <div className={`p-3 rounded ${config.bg} border ${config.border}`}>
              <div className="flex items-center gap-2 mb-2">
                <XCircle className="w-4 h-4 text-red-400" />
                <span className="text-red-400 font-medium text-sm">Rejected Improvement</span>
              </div>
              <p className="text-gray-300 text-sm">
                This improvement was tested and found to decrease performance. It has been disabled.
              </p>
            </div>
          )}

          {improvement.status === 'testing' && (
            <div className={`p-3 rounded ${config.bg} border ${config.border}`}>
              <div className="flex items-center gap-2 mb-2">
                <Play className="w-4 h-4 text-yellow-400" />
                <span className="text-yellow-400 font-medium text-sm">Currently Testing</span>
              </div>
              <p className="text-gray-300 text-sm">
                This improvement is currently being tested across multiple sessions.
                {improvement.sessionsTested > 0 && ` Progress: ${improvement.sessionsTested} session${improvement.sessionsTested !== 1 ? 's' : ''} completed.`}
              </p>
            </div>
          )}

          {/* Trading Activity */}
          {improvement.tradesAffected > 0 && (
            <div className="text-sm text-gray-400">
              <BarChart3 className="w-4 h-4 inline mr-1" />
              Applied to <span className="text-white font-medium">{improvement.tradesAffected}</span> trades
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MetricComparison({ label, before, after, delta, suffix = '', prefix = '', higherIsBetter = true }: any) {
  const improved = higherIsBetter ? delta > 0 : delta < 0;
  const deltaColor = improved ? 'text-green-400' : 'text-red-400';
  const DeltaIcon = improved ? TrendingUp : TrendingDown;

  return (
    <div className="bg-gray-800 rounded p-3">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-gray-500 text-sm line-through">
          {prefix}{before.toFixed(1)}{suffix}
        </span>
        <span className="text-white font-bold">
          {prefix}{after.toFixed(1)}{suffix}
        </span>
      </div>
      <div className={`flex items-center gap-1 text-xs mt-1 ${deltaColor}`}>
        <DeltaIcon className="w-3 h-3" />
        {delta >= 0 ? '+' : ''}{delta.toFixed(1)}{suffix}
      </div>
    </div>
  );
}

function formatHypothesisType(type: string): string {
  return type
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
