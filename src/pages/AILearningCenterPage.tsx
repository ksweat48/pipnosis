import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  Brain, Layers, Shield, Activity, TrendingUp, Target, Award,
  RefreshCw, Download, Filter
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { kpiAggregator } from '../services/kpi-aggregator';
import { KPIMetricCard } from '../components/KPIMetricCard';
import { LLMLayerFunnel } from '../components/LLMLayerFunnel';
import { NavigationMenu } from '../components/NavigationMenu';

type TabId = 'overview' | 'llm-layers' | 'avoid-patterns' | 'learning-loop' | 'strategy-evolution' | 'smart-goal' | 'mastery';

function AILearningCenterPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month'>('today');

  const [llmLayerKPIs, setLLMLayerKPIs] = useState<any[]>([]);
  const [avoidPatternKPIs, setAvoidPatternKPIs] = useState<any[]>([]);
  const [learningKPIs, setLearningKPIs] = useState<any>(null);
  const [strategyKPIs, setStrategyKPIs] = useState<any[]>([]);
  const [smartGoalKPIs, setSmartGoalKPIs] = useState<any>(null);
  const [masteryKPIs, setMasteryKPIs] = useState<any>(null);
  const [anomalies, setAnomalies] = useState<any[]>([]);

  useEffect(() => {
    if (user) {
      loadAllKPIs();
    }
  }, [user, dateRange]);

  useEffect(() => {
    if (!user) return;

    // Auto-refresh KPIs every 60 seconds when auto-backtest is running
    const refreshInterval = setInterval(async () => {
      const { data: autoBacktestState } = await supabase
        .from('auto_backtest_global_state')
        .select('is_running')
        .eq('user_id', user.id)
        .maybeSingle();

      if (autoBacktestState?.is_running) {
        console.log('[Learning Center] Auto-backtest active - refreshing KPIs...');
        await loadAllKPIs();
      }
    }, 60000); // Every 60 seconds

    // Subscribe to backtest completion events for immediate refresh
    const channel = supabase
      .channel('backtest-completions')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'daily_session_results',
          filter: `user_id=eq.${user.id}`
        },
        async (payload) => {
          console.log('[Learning Center] New backtest data detected - refreshing KPIs...');
          await loadAllKPIs();
        }
      )
      .subscribe();

    return () => {
      clearInterval(refreshInterval);
      supabase.removeChannel(channel);
    };
  }, [user]);

  const loadAllKPIs = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];

      const [llmData, avoidData, learningData, strategyData, goalData, masteryData, anomalyData] = await Promise.all([
        supabase.from('llm_layer_kpis').select('*').eq('user_id', user.id).eq('date', today).order('layer_number'),
        supabase.from('avoid_pattern_kpis').select('*').eq('user_id', user.id).eq('date', today),
        supabase.from('continuous_learning_kpis').select('*').eq('user_id', user.id).eq('date', today).maybeSingle(),
        supabase.from('strategy_evolution_kpis').select('*').eq('user_id', user.id).eq('date', today),
        supabase.from('smart_goal_kpis').select('*').eq('user_id', user.id).eq('date', today).maybeSingle(),
        supabase.from('ai_mastery_kpis').select('*').eq('user_id', user.id).eq('date', today).maybeSingle(),
        supabase.from('kpi_anomalies').select('*').eq('user_id', user.id).eq('acknowledged', false).order('detected_at', { ascending: false }).limit(10)
      ]);

      setLLMLayerKPIs(llmData.data || []);
      setAvoidPatternKPIs(avoidData.data || []);
      setLearningKPIs(learningData.data);
      setStrategyKPIs(strategyData.data || []);
      setSmartGoalKPIs(goalData.data);
      setMasteryKPIs(masteryData.data);
      setAnomalies(anomalyData.data || []);
    } catch (error) {
      console.error('Error loading KPIs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (!user) return;

    setRefreshing(true);
    try {
      await kpiAggregator.updateAllKPIs(user.id);
      await loadAllKPIs();
    } catch (error) {
      console.error('Error refreshing KPIs:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const handleExport = async () => {
    if (!user) return;

    const exportData = {
      llm_layers: llmLayerKPIs,
      avoid_patterns: avoidPatternKPIs,
      learning: learningKPIs,
      strategy_evolution: strategyKPIs,
      smart_goal: smartGoalKPIs,
      mastery: masteryKPIs,
      anomalies: anomalies,
      exported_at: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kpi-report-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Brain className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">Please sign in to access the AI Learning Center</p>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Brain },
    { id: 'llm-layers', label: 'LLM Decision Stack', icon: Layers },
    { id: 'avoid-patterns', label: 'Avoid Patterns', icon: Shield },
    { id: 'learning-loop', label: 'Continuous Learning', icon: Activity },
    { id: 'strategy-evolution', label: 'Strategy Evolution', icon: TrendingUp },
    { id: 'smart-goal', label: 'Smart Goal Mode', icon: Target },
    { id: 'mastery', label: 'AI Mastery', icon: Award }
  ];

  return (
    <>
      <NavigationMenu />
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-6">
        <div className="max-w-7xl mx-auto">
        <div className="bg-gradient-to-br from-emerald-900/30 to-blue-900/30 backdrop-blur-sm border-2 border-emerald-500/30 rounded-lg shadow-md p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Brain className="w-10 h-10 text-emerald-400" />
                <h1 className="text-3xl font-bold text-white">AI Learning Center</h1>
              </div>
              <p className="text-gray-400">
                Comprehensive KPI monitoring for multi-layer LLM architecture and continuous learning systems
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white rounded-lg flex items-center gap-2 transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                onClick={handleExport}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg flex items-center gap-2 transition-colors"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
            </div>
          </div>

          {anomalies.length > 0 && (
            <div className="mt-4 p-3 bg-red-900/20 border border-red-500/30 rounded-lg">
              <p className="text-red-300 text-sm">
                {anomalies.length} anomalies detected - Review tabs for details
              </p>
            </div>
          )}
        </div>

        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-2 mb-6 overflow-x-auto">
          <div className="flex gap-2 min-w-max">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as TabId)}
                  className={`flex items-center gap-2 px-4 py-3 rounded-lg transition-all whitespace-nowrap ${
                    isActive
                      ? 'bg-emerald-600 text-white shadow-lg'
                      : 'bg-gray-900/50 text-gray-400 hover:bg-gray-700 hover:text-white'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-semibold text-sm">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
            </div>
          ) : (
            <>
              {activeTab === 'overview' && (
                <OverviewTab
                  llmLayerKPIs={llmLayerKPIs}
                  avoidPatternKPIs={avoidPatternKPIs}
                  learningKPIs={learningKPIs}
                  strategyKPIs={strategyKPIs}
                  smartGoalKPIs={smartGoalKPIs}
                  masteryKPIs={masteryKPIs}
                  anomalies={anomalies}
                />
              )}

              {activeTab === 'llm-layers' && (
                <LLMLayersTab llmLayerKPIs={llmLayerKPIs} />
              )}

              {activeTab === 'avoid-patterns' && (
                <AvoidPatternsTab avoidPatternKPIs={avoidPatternKPIs} />
              )}

              {activeTab === 'learning-loop' && (
                <LearningLoopTab learningKPIs={learningKPIs} />
              )}

              {activeTab === 'strategy-evolution' && (
                <StrategyEvolutionTab strategyKPIs={strategyKPIs} />
              )}

              {activeTab === 'smart-goal' && (
                <SmartGoalTab smartGoalKPIs={smartGoalKPIs} />
              )}

              {activeTab === 'mastery' && (
                <MasteryTab masteryKPIs={masteryKPIs} />
              )}
            </>
          )}
        </div>
      </div>
      </div>
    </>
  );
}

function OverviewTab({ llmLayerKPIs, avoidPatternKPIs, learningKPIs, strategyKPIs, smartGoalKPIs, masteryKPIs, anomalies }: any) {
  const avgLLMPassRate = llmLayerKPIs.length > 0
    ? llmLayerKPIs.reduce((sum: number, l: any) => sum + l.pass_rate, 0) / llmLayerKPIs.length
    : 0;

  const totalAvoidedTrades = avoidPatternKPIs.reduce((sum: number, k: any) => sum + (k.trades_avoided || 0), 0);
  const totalBlockRate = avoidPatternKPIs.length > 0
    ? avoidPatternKPIs.reduce((sum: number, k: any) => sum + (k.block_rate || 0), 0) / avoidPatternKPIs.length
    : 0;

  // Check if we have any actual data
  const hasAnyData = llmLayerKPIs.length > 0 || avoidPatternKPIs.length > 0 || learningKPIs || masteryKPIs;

  if (!hasAnyData) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-white">System Overview</h2>
        <div className="bg-gradient-to-br from-blue-900/30 to-purple-900/30 backdrop-blur-sm border-2 border-blue-500/30 rounded-lg p-8 text-center">
          <Brain className="w-16 h-16 text-blue-400 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-white mb-2">AI Learning System Ready</h3>
          <p className="text-gray-400 mb-4">
            Run backtests or live trades to generate learning data. The AI will analyze your trades and build intelligence over time.
          </p>
          <div className="bg-gray-800/50 rounded-lg p-4 text-left">
            <p className="text-sm text-gray-300 mb-2">To generate learning data:</p>
            <ul className="text-sm text-gray-400 space-y-1">
              <li>• Navigate to AI Training & Backtesting Lab</li>
              <li>• Enable Auto-Backtest Mode</li>
              <li>• AI will run 30-day sessions with learning every 10 days</li>
              <li>• Learning insights appear here automatically</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">System Overview</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPIMetricCard
          title="LLM Pipeline Health"
          value={`${avgLLMPassRate.toFixed(1)}%`}
          subtitle="Average pass rate across all layers"
          trend={avgLLMPassRate >= 60 ? 'up' : 'down'}
          icon={<Layers className="w-5 h-5" />}
          isAnomaly={avgLLMPassRate < 40}
          anomalyReason={avgLLMPassRate < 40 ? 'Pass rate below critical threshold' : undefined}
        />

        <KPIMetricCard
          title="Trades Avoided"
          value={totalAvoidedTrades}
          subtitle={`${totalBlockRate.toFixed(1)}% block rate`}
          icon={<Shield className="w-5 h-5" />}
        />

        <KPIMetricCard
          title="Learning Velocity"
          value={`${learningKPIs?.learning_velocity?.toFixed(1) || 0}%`}
          subtitle="Insights created per validation"
          icon={<Activity className="w-5 h-5" />}
          trend={learningKPIs?.learning_velocity > 50 ? 'up' : 'neutral'}
        />

        <KPIMetricCard
          title="Win Rate (100 trades)"
          value={`${masteryKPIs?.moving_win_rate_100?.toFixed(1) || 0}%`}
          subtitle="Moving average performance"
          icon={<Award className="w-5 h-5" />}
          trend={masteryKPIs?.moving_win_rate_100 >= 55 ? 'up' : 'down'}
          isAnomaly={masteryKPIs?.moving_win_rate_100 < 45}
        />
      </div>

      {anomalies.length > 0 && (
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-6">
          <h3 className="text-xl font-bold text-white mb-4">Recent Anomalies</h3>
          <div className="space-y-3">
            {anomalies.map((anomaly: any) => (
              <div key={anomaly.id} className="p-4 bg-red-900/20 border border-red-500/30 rounded-lg">
                <div className="flex items-start justify-between mb-2">
                  <span className="text-red-300 font-semibold">{anomaly.kpi_metric}</span>
                  <span className={`text-xs px-2 py-1 rounded ${
                    anomaly.severity === 'critical' ? 'bg-red-600 text-white' :
                    anomaly.severity === 'high' ? 'bg-orange-600 text-white' :
                    anomaly.severity === 'medium' ? 'bg-yellow-600 text-white' :
                    'bg-gray-600 text-white'
                  }`}>
                    {anomaly.severity}
                  </span>
                </div>
                <p className="text-sm text-red-200 mb-2">{anomaly.anomaly_reason}</p>
                <p className="text-xs text-gray-400">{anomaly.recovery_suggestion}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LLMLayersTab({ llmLayerKPIs }: any) {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">5-Layer LLM Decision Stack</h2>

      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Decision Funnel</h3>
        <LLMLayerFunnel layers={llmLayerKPIs} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {llmLayerKPIs.map((layer: any) => (
          <div key={layer.layer_number} className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-4">
            <h4 className="text-white font-semibold mb-3">Layer {layer.layer_number}: {layer.layer_name}</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Pass Rate:</span>
                <span className={`font-semibold ${
                  layer.pass_rate >= 60 ? 'text-green-400' :
                  layer.pass_rate >= 40 ? 'text-yellow-400' :
                  'text-red-400'
                }`}>
                  {layer.pass_rate.toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Evaluations:</span>
                <span className="text-white">{layer.total_evaluations}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Avg Time:</span>
                <span className="text-white">{layer.avg_processing_time_ms}ms</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Tokens Used:</span>
                <span className="text-white">{layer.total_tokens_used}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AvoidPatternsTab({ avoidPatternKPIs }: any) {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Avoid Pattern Enforcement</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {avoidPatternKPIs.map((kpi: any) => (
          <KPIMetricCard
            key={`${kpi.symbol}-${kpi.date}`}
            title={kpi.symbol}
            value={kpi.trades_avoided}
            subtitle={`${kpi.block_rate.toFixed(1)}% block rate`}
            icon={<Shield className="w-5 h-5" />}
          />
        ))}
      </div>
    </div>
  );
}

function LearningLoopTab({ learningKPIs }: any) {
  if (!learningKPIs) {
    return (
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-8 text-center">
        <Activity className="w-16 h-16 text-gray-600 mx-auto mb-4" />
        <p className="text-gray-400">No learning loop data available for today</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Continuous Learning Loop</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPIMetricCard
          title="Insights Created"
          value={learningKPIs.insights_created}
          icon={<Activity className="w-5 h-5" />}
        />
        <KPIMetricCard
          title="Insights Validated"
          value={learningKPIs.insights_validated}
          icon={<Activity className="w-5 h-5" />}
        />
        <KPIMetricCard
          title="Validation Accuracy"
          value={`${learningKPIs.validation_accuracy.toFixed(1)}%`}
          trend={learningKPIs.validation_accuracy >= 70 ? 'up' : 'down'}
          icon={<Activity className="w-5 h-5" />}
        />
        <KPIMetricCard
          title="Learning Velocity"
          value={`${learningKPIs.learning_velocity.toFixed(1)}%`}
          icon={<Activity className="w-5 h-5" />}
        />
      </div>
    </div>
  );
}

function StrategyEvolutionTab({ strategyKPIs }: any) {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Strategy Evolution</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {strategyKPIs.map((kpi: any) => (
          <KPIMetricCard
            key={`${kpi.symbol}-${kpi.date}`}
            title={kpi.symbol}
            value={kpi.patterns_discovered}
            subtitle={`${kpi.patterns_active} active patterns`}
            icon={<TrendingUp className="w-5 h-5" />}
          />
        ))}
      </div>
    </div>
  );
}

function SmartGoalTab({ smartGoalKPIs }: any) {
  if (!smartGoalKPIs) {
    return (
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-8 text-center">
        <Target className="w-16 h-16 text-gray-600 mx-auto mb-4" />
        <p className="text-gray-400">No Smart Goal Mode data available for today</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Smart Goal Mode Performance</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPIMetricCard
          title="LLM Decision Rate"
          value={`${smartGoalKPIs.llm_decision_percentage.toFixed(1)}%`}
          subtitle={`${smartGoalKPIs.llm_decision_trades} trades`}
          icon={<Target className="w-5 h-5" />}
        />
        <KPIMetricCard
          title="LLM Win Rate"
          value={`${smartGoalKPIs.llm_win_rate.toFixed(1)}%`}
          trend={smartGoalKPIs.llm_win_rate >= 55 ? 'up' : 'down'}
          icon={<Target className="w-5 h-5" />}
        />
        <KPIMetricCard
          title="Rule-Based Win Rate"
          value={`${smartGoalKPIs.rule_win_rate.toFixed(1)}%`}
          icon={<Target className="w-5 h-5" />}
        />
        <KPIMetricCard
          title="Performance Gap"
          value={`${smartGoalKPIs.performance_gap > 0 ? '+' : ''}${smartGoalKPIs.performance_gap.toFixed(1)}%`}
          subtitle="LLM vs Rule-based"
          trend={smartGoalKPIs.performance_gap > 0 ? 'up' : 'down'}
          icon={<Target className="w-5 h-5" />}
        />
      </div>
    </div>
  );
}

function MasteryTab({ masteryKPIs }: any) {
  if (!masteryKPIs) {
    return (
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-8 text-center">
        <Award className="w-16 h-16 text-gray-600 mx-auto mb-4" />
        <p className="text-gray-400">No mastery data available for today</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">AI Mastery Progression</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Moving Win Rates</h3>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-gray-400 text-sm">50 Trades</span>
                <span className="text-white font-semibold">{masteryKPIs.moving_win_rate_50.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-600 to-blue-400"
                  style={{ width: `${Math.min(masteryKPIs.moving_win_rate_50, 100)}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-gray-400 text-sm">100 Trades</span>
                <span className="text-white font-semibold">{masteryKPIs.moving_win_rate_100.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-green-600 to-green-400"
                  style={{ width: `${Math.min(masteryKPIs.moving_win_rate_100, 100)}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-gray-400 text-sm">500 Trades</span>
                <span className="text-white font-semibold">{masteryKPIs.moving_win_rate_500.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-600 to-purple-400"
                  style={{ width: `${Math.min(masteryKPIs.moving_win_rate_500, 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Moving Profit Factors</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-400 text-sm">50 Trades</span>
              <span className="text-white font-semibold">{masteryKPIs.moving_profit_factor_50.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400 text-sm">100 Trades</span>
              <span className="text-white font-semibold">{masteryKPIs.moving_profit_factor_100.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400 text-sm">500 Trades</span>
              <span className="text-white font-semibold">{masteryKPIs.moving_profit_factor_500.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Skill Level</h3>
          <div className="text-center">
            <div className="text-4xl font-bold text-emerald-400 mb-2">{masteryKPIs.skill_level}</div>
            <div className="text-sm text-gray-400 mb-4">{masteryKPIs.skill_progress_percentage.toFixed(1)}% to next level</div>
            <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-500"
                style={{ width: `${masteryKPIs.skill_progress_percentage}%` }}
              />
            </div>
            <div className="mt-2 text-xs text-gray-400">{masteryKPIs.trades_to_next_level} trades remaining</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AILearningCenterPage;
