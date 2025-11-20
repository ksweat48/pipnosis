import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { aggregateUserKPIs } from '@/services/comprehensive-kpi-aggregator';
import {
  Brain,
  Shield,
  TrendingUp,
  Sparkles,
  Target,
  Trophy,
  AlertTriangle,
  Layers,
  Activity,
  BarChart3,
  Zap,
  RefreshCw,
  Calendar,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export function ComprehensiveKPIDashboard() {
  const { user } = useAuth();
  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [llmLayerKPIs, setLLMLayerKPIs] = useState<any[]>([]);
  const [avoidPatternKPIs, setAvoidPatternKPIs] = useState<any[]>([]);
  const [learningKPIs, setLearningKPIs] = useState<any>(null);
  const [evolutionKPIs, setEvolutionKPIs] = useState<any[]>([]);
  const [goalKPIs, setGoalKPIs] = useState<any>(null);
  const [masteryKPIs, setMasteryKPIs] = useState<any>(null);
  const [anomalies, setAnomalies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (user) {
      loadKPIs();
    }
  }, [user, date]);

  const loadKPIs = async () => {
    if (!user) return;

    try {
      setLoading(true);

      const [llm, avoid, learning, evolution, goal, mastery, anomalyData] = await Promise.all([
        supabase.from('llm_layer_kpis').select('*').eq('user_id', user.id).eq('date', date).order('layer_number'),
        supabase.from('avoid_pattern_kpis').select('*').eq('user_id', user.id).eq('date', date),
        supabase.from('continuous_learning_kpis').select('*').eq('user_id', user.id).eq('date', date).maybeSingle(),
        supabase.from('strategy_evolution_kpis').select('*').eq('user_id', user.id).eq('date', date),
        supabase.from('smart_goal_kpis').select('*').eq('user_id', user.id).eq('date', date).maybeSingle(),
        supabase.from('ai_mastery_kpis').select('*').eq('user_id', user.id).eq('date', date).maybeSingle(),
        supabase.from('kpi_anomalies').select('*').eq('user_id', user.id).eq('acknowledged', false).order('detected_at', { ascending: false }).limit(10),
      ]);

      setLLMLayerKPIs(llm.data || []);
      setAvoidPatternKPIs(avoid.data || []);
      setLearningKPIs(learning.data);
      setEvolutionKPIs(evolution.data || []);
      setGoalKPIs(goal.data);
      setMasteryKPIs(mastery.data);
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
      await aggregateUserKPIs(user.id);
      await loadKPIs();
    } catch (error) {
      console.error('Error refreshing KPIs:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const acknowledgeAnomaly = async (anomalyId: string) => {
    await supabase
      .from('kpi_anomalies')
      .update({ acknowledged: true, acknowledged_at: new Date().toISOString() })
      .eq('id', anomalyId);

    setAnomalies(anomalies.filter(a => a.id !== anomalyId));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin h-12 w-12 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
          />
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-all disabled:opacity-50"
          >
            <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
            Refresh KPIs
          </button>
        </div>
        <div className="text-sm text-gray-400 flex items-center gap-2">
          <Calendar size={16} />
          {new Date(date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
      </div>

      {anomalies.length > 0 && (
        <div className="bg-gradient-to-br from-red-900/30 to-orange-900/30 border-2 border-red-500/50 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="text-red-400" size={24} />
            <h3 className="text-xl font-bold text-white">Active Anomalies Detected</h3>
          </div>
          <div className="space-y-3">
            {anomalies.map((anomaly) => (
              <div key={anomaly.id} className="bg-gray-900/50 rounded-lg p-4 flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${
                      anomaly.severity === 'critical' ? 'bg-red-600 text-white' :
                      anomaly.severity === 'high' ? 'bg-orange-600 text-white' :
                      anomaly.severity === 'medium' ? 'bg-yellow-600 text-white' :
                      'bg-blue-600 text-white'
                    }`}>
                      {anomaly.severity.toUpperCase()}
                    </span>
                    <span className="text-white font-semibold">{anomaly.kpi_table}.{anomaly.kpi_metric}</span>
                  </div>
                  <p className="text-gray-300 text-sm mb-2">{anomaly.anomaly_reason}</p>
                  <p className="text-gray-400 text-xs">
                    Expected: {anomaly.expected_range_min}-{anomaly.expected_range_max} | Actual: {anomaly.actual_value}
                  </p>
                  <p className="text-emerald-400 text-xs mt-2">💡 {anomaly.recovery_suggestion}</p>
                </div>
                <button
                  onClick={() => acknowledgeAnomaly(anomaly.id)}
                  className="ml-4 px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition-all"
                >
                  Acknowledge
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-gradient-to-br from-blue-900/30 to-purple-900/30 border-2 border-blue-500/30 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <Layers className="text-blue-400" size={28} />
          <div>
            <h2 className="text-2xl font-bold text-white">5-Layer LLM Decision Stack</h2>
            <p className="text-gray-300 text-sm">Performance metrics for each decision layer</p>
          </div>
        </div>

        {llmLayerKPIs.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {llmLayerKPIs.map((layer) => (
              <div key={layer.layer_number} className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-xs text-gray-400">Layer {layer.layer_number}</div>
                    <div className="text-white font-bold">{layer.layer_name}</div>
                  </div>
                  <div className="text-right">
                    <div className={`text-2xl font-bold ${
                      layer.pass_rate >= 70 ? 'text-green-400' :
                      layer.pass_rate >= 50 ? 'text-yellow-400' :
                      'text-red-400'
                    }`}>
                      {layer.pass_rate}%
                    </div>
                    <div className="text-xs text-gray-400">Pass Rate</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-gray-400">Pass</div>
                    <div className="text-green-400 font-semibold">{layer.pass_count}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Reject</div>
                    <div className="text-red-400 font-semibold">{layer.reject_count}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Skip</div>
                    <div className="text-gray-300 font-semibold">{layer.skip_count}</div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-700 flex justify-between text-xs">
                  <div>
                    <span className="text-gray-400">Confidence:</span>{' '}
                    <span className="text-white font-semibold">{layer.avg_confidence}%</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Tokens:</span>{' '}
                    <span className="text-white font-semibold">{layer.total_tokens_used}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-gray-500 py-8">No LLM layer data for this date</div>
        )}
      </div>

      <div className="bg-gradient-to-br from-red-900/30 to-pink-900/30 border-2 border-red-500/30 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <Shield className="text-red-400" size={28} />
          <div>
            <h2 className="text-2xl font-bold text-white">Avoid Pattern Enforcement</h2>
            <p className="text-gray-300 text-sm">Pattern matching and trade avoidance effectiveness</p>
          </div>
        </div>

        {avoidPatternKPIs.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {avoidPatternKPIs.map((pattern) => (
              <div key={pattern.symbol} className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-white font-bold text-lg">{pattern.symbol}</div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-orange-400">{pattern.block_rate}%</div>
                    <div className="text-xs text-gray-400">Block Rate</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-gray-400 text-xs">Trades Avoided</div>
                    <div className="text-red-400 font-semibold">{pattern.trades_avoided}</div>
                  </div>
                  <div>
                    <div className="text-gray-400 text-xs">Trades Allowed</div>
                    <div className="text-green-400 font-semibold">{pattern.trades_allowed}</div>
                  </div>
                  <div>
                    <div className="text-gray-400 text-xs">Pattern Accuracy</div>
                    <div className="text-white font-semibold">{pattern.pattern_accuracy}%</div>
                  </div>
                  <div>
                    <div className="text-gray-400 text-xs">EV Difference</div>
                    <div className={`font-semibold ${pattern.ev_difference >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      ${pattern.ev_difference.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-gray-500 py-8">No avoid pattern data for this date</div>
        )}
      </div>

      {learningKPIs && (
        <div className="bg-gradient-to-br from-purple-900/30 to-indigo-900/30 border-2 border-purple-500/30 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <Brain className="text-purple-400" size={28} />
            <div>
              <h2 className="text-2xl font-bold text-white">Continuous Learning Loop</h2>
              <p className="text-gray-300 text-sm">AI learning system health and effectiveness</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-gray-800/50 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Loop Activations</div>
              <div className="text-white text-3xl font-bold">{learningKPIs.loop_activations}</div>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Insights Created</div>
              <div className="text-emerald-400 text-3xl font-bold">{learningKPIs.insights_created}</div>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Validation Accuracy</div>
              <div className={`text-3xl font-bold ${
                learningKPIs.validation_accuracy >= 70 ? 'text-green-400' :
                learningKPIs.validation_accuracy >= 50 ? 'text-yellow-400' :
                'text-red-400'
              }`}>
                {learningKPIs.validation_accuracy}%
              </div>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">System Health</div>
              <div className={`text-3xl font-bold ${
                learningKPIs.system_health_score >= 70 ? 'text-green-400' :
                learningKPIs.system_health_score >= 50 ? 'text-yellow-400' :
                'text-red-400'
              }`}>
                {learningKPIs.system_health_score}%
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gray-800/50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="text-gray-400 text-sm">Insights Validated</div>
                <div className="text-blue-400 font-bold">{learningKPIs.insights_validated}</div>
              </div>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="text-gray-400 text-sm">Insights Updated</div>
                <div className="text-yellow-400 font-bold">{learningKPIs.insights_updated}</div>
              </div>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="text-gray-400 text-sm">Insights Pruned</div>
                <div className="text-red-400 font-bold">{learningKPIs.insights_pruned}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {masteryKPIs && (
        <div className="bg-gradient-to-br from-amber-900/30 to-yellow-900/30 border-2 border-amber-500/30 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <Trophy className="text-amber-400" size={28} />
            <div>
              <h2 className="text-2xl font-bold text-white">AI Mastery & Progression</h2>
              <p className="text-gray-300 text-sm">Skill level and performance over time</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div className="bg-gray-800/50 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Current Skill Level</div>
              <div className="text-amber-400 text-2xl font-bold">{masteryKPIs.skill_level}</div>
              <div className="text-gray-400 text-xs mt-1">{masteryKPIs.skill_progress_percentage}% progress</div>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Moving Win Rate (50)</div>
              <div className={`text-2xl font-bold ${
                masteryKPIs.moving_win_rate_50 >= 55 ? 'text-green-400' :
                masteryKPIs.moving_win_rate_50 >= 50 ? 'text-yellow-400' :
                'text-red-400'
              }`}>
                {masteryKPIs.moving_win_rate_50}%
              </div>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Moving Win Rate (100)</div>
              <div className={`text-2xl font-bold ${
                masteryKPIs.moving_win_rate_100 >= 55 ? 'text-green-400' :
                masteryKPIs.moving_win_rate_100 >= 50 ? 'text-yellow-400' :
                'text-red-400'
              }`}>
                {masteryKPIs.moving_win_rate_100}%
              </div>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Moving Win Rate (500)</div>
              <div className={`text-2xl font-bold ${
                masteryKPIs.moving_win_rate_500 >= 55 ? 'text-green-400' :
                masteryKPIs.moving_win_rate_500 >= 50 ? 'text-yellow-400' :
                'text-red-400'
              }`}>
                {masteryKPIs.moving_win_rate_500}%
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gray-800/50 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Profit Factor (50)</div>
              <div className="text-emerald-400 text-xl font-bold">{masteryKPIs.moving_profit_factor_50.toFixed(2)}</div>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Confidence Accuracy</div>
              <div className="text-blue-400 text-xl font-bold">{masteryKPIs.confidence_accuracy}%</div>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Trades to Next Level</div>
              <div className="text-white text-xl font-bold">{masteryKPIs.trades_to_next_level}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
