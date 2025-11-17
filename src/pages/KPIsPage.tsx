import React, { useState, useEffect } from 'react';
import { NavigationMenu } from '@/components/NavigationMenu';
import { supabase } from '@/lib/supabase';
import { kpiAnalyticsService } from '@/services/kpi-analytics-service';
import { GlobalPollingStatus } from '@/components/GlobalPollingStatus';
import { PollingPreferences } from '@/components/PollingPreferences';
import { CPUCreditDashboard } from '@/components/CPUCreditDashboard';
import {
  TrendingUp,
  TrendingDown,
  Target,
  Activity,
  BarChart3,
  RefreshCw,
  Calendar,
  Users,
  Award,
  AlertCircle,
  Settings,
  Brain,
  Zap,
  Sparkles,
  LineChart,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

interface LearningMetrics {
  metric_period: string;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_profit: number;
  total_loss: number;
  net_profit: number;
  average_win: number;
  average_loss: number;
  profit_factor: number;
  best_strategy: string;
  worst_strategy: string;
  improvement_percentage: number;
  confidence_accuracy: number;
}

interface StrategyAnalytics {
  strategy_type: string;
  total_trades: number;
  win_count: number;
  loss_count: number;
  win_rate: number;
  net_profit: number;
  profit_factor: number;
  average_trade_duration: number;
  best_symbol: string;
}

interface UserPerformance {
  user_id: string;
  total_trades: number;
  win_rate: number;
  net_profit: number;
  best_strategy: string;
  email?: string;
}

export function KPIsPage() {
  const { user } = useAuth();
  const [timeframe, setTimeframe] = useState<string>('all_time');
  const [metrics, setMetrics] = useState<LearningMetrics | null>(null);
  const [strategies, setStrategies] = useState<StrategyAnalytics[]>([]);
  const [userPerformance, setUserPerformance] = useState<UserPerformance[]>([]);
  const [trainingMetrics, setTrainingMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadKPIData();
  }, [timeframe, user]);

  const loadKPIData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [metricsData, strategiesData, usersData, trainingData] = await Promise.all([
        fetchMetrics(),
        fetchStrategies(),
        fetchUserPerformance(),
        fetchTrainingMetrics(),
      ]);

      setMetrics(metricsData);
      setStrategies(strategiesData);
      setUserPerformance(usersData);
      setTrainingMetrics(trainingData);
    } catch (error) {
      console.error('Error loading KPI data:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setError(`Failed to load KPI data: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchTrainingMetrics = async () => {
    if (!user) return null;

    try {
      // Get backtest session counts
      const { count: realCount } = await supabase
        .from('backtest_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);

      const { count: syntheticCount } = await supabase
        .from('synthetic_backtest_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);

      // Get auto-backtest count
      const { data: autoSessions } = await supabase
        .from('backtest_sessions')
        .select('session_name')
        .eq('user_id', user.id)
        .like('session_name', 'Auto-BT-%');

      const { data: autoSyntheticSessions } = await supabase
        .from('synthetic_backtest_sessions')
        .select('session_name')
        .eq('user_id', user.id)
        .like('session_name', 'Auto-BT-%');

      const totalAutoBacktests = (autoSessions?.length || 0) + (autoSyntheticSessions?.length || 0);

      // Get current skill level
      const { data: skillData } = await supabase
        .from('ai_skill_tracking')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Get learning insights count
      const { count: insightsCount } = await supabase
        .from('ai_learning_insights')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);

      // Get pattern discoveries count
      const { count: patternsCount } = await supabase
        .from('ai_pattern_discoveries')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);

      // Get recent performance (last 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: recentSessions } = await supabase
        .from('backtest_sessions')
        .select('win_rate, total_pnl')
        .eq('user_id', user.id)
        .gte('created_at', thirtyDaysAgo);

      const avgWinRate = recentSessions && recentSessions.length > 0
        ? recentSessions.reduce((sum, s) => sum + s.win_rate, 0) / recentSessions.length
        : 0;

      const avgPnL = recentSessions && recentSessions.length > 0
        ? recentSessions.reduce((sum, s) => sum + s.total_pnl, 0) / recentSessions.length
        : 0;

      // Get skill progression (compare last 2 records)
      const { data: skillHistory } = await supabase
        .from('ai_skill_tracking')
        .select('skill_level')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false})
        .limit(2);

      let skillImprovement = 0;
      if (skillHistory && skillHistory.length === 2) {
        skillImprovement = skillHistory[0].skill_level - skillHistory[1].skill_level;
      }

      return {
        totalBacktests: (realCount || 0) + (syntheticCount || 0),
        realBacktests: realCount || 0,
        syntheticBacktests: syntheticCount || 0,
        autoBacktests: totalAutoBacktests,
        manualBacktests: ((realCount || 0) + (syntheticCount || 0)) - totalAutoBacktests,
        currentSkillLevel: skillData?.skill_level || 0,
        totalInsights: insightsCount || 0,
        totalPatterns: patternsCount || 0,
        avgWinRate30d: avgWinRate,
        avgPnL30d: avgPnL,
        skillImprovement,
        insightsPerBacktest: ((realCount || 0) + (syntheticCount || 0)) > 0
          ? (insightsCount || 0) / ((realCount || 0) + (syntheticCount || 0))
          : 0
      };
    } catch (error) {
      console.error('Error fetching training metrics:', error);
      return null;
    }
  };

  const fetchMetrics = async (): Promise<LearningMetrics | null> => {
    try {
      const { data, error } = await supabase
        .from('ai_learning_metrics')
        .select('*')
        .eq('metric_period', timeframe)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Error fetching metrics:', error);
        throw new Error(`Metrics query failed: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('Exception in fetchMetrics:', error);
      return null;
    }
  };

  const fetchStrategies = async (): Promise<StrategyAnalytics[]> => {
    try {
      const { data, error } = await supabase
        .from('strategy_analytics')
        .select('*')
        .order('win_rate', { ascending: false });

      if (error) {
        console.error('Error fetching strategies:', error);
        throw new Error(`Strategy analytics query failed: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('Exception in fetchStrategies:', error);
      return [];
    }
  };

  const fetchUserPerformance = async (): Promise<UserPerformance[]> => {
    try {
      const { data, error } = await supabase
        .from('user_performance_summary')
        .select('*')
        .order('net_profit', { ascending: false })
        .limit(10);

      if (error) {
        console.error('Error fetching user performance:', error);
        throw new Error(`User performance query failed: ${error.message}`);
      }

      // Fetch email separately for each user to avoid join issues
      const usersWithEmails = await Promise.all(
        (data || []).map(async (user) => {
          try {
            const { data: profile } = await supabase
              .from('user_profiles')
              .select('email')
              .eq('id', user.user_id)
              .maybeSingle();

            return {
              ...user,
              email: profile?.email || 'Unknown',
            };
          } catch (emailError) {
            console.error('Error fetching user email:', emailError);
            return {
              ...user,
              email: 'Unknown',
            };
          }
        })
      );

      return usersWithEmails;
    } catch (error) {
      console.error('Exception in fetchUserPerformance:', error);
      return [];
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await kpiAnalyticsService.refreshKPIData();
      await loadKPIData();
      setLastRefresh(new Date());
    } catch (error) {
      console.error('Error refreshing KPI data:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setError(`Failed to refresh KPI data: ${errorMessage}`);
    } finally {
      setRefreshing(false);
    }
  };

  const timeframeOptions = [
    { value: 'daily', label: 'Today' },
    { value: 'weekly', label: 'This Week' },
    { value: 'monthly', label: 'This Month' },
    { value: 'all_time', label: 'All Time' },
  ];

  const topStrategies = strategies.slice(0, 5);
  const bottomStrategies = strategies.slice(-5).reverse();

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950">
        <NavigationMenu />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex items-center justify-center h-96">
            <div className="animate-spin h-12 w-12 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full"></div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950">
      <NavigationMenu />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {error && (
          <div className="mb-6 bg-red-900/20 border border-red-500/50 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="text-red-400 mt-0.5" size={20} />
              <div className="flex-1">
                <h3 className="text-red-400 font-semibold mb-1">Error Loading KPI Data</h3>
                <p className="text-red-300/80 text-sm">{error}</p>
                <button
                  onClick={() => {
                    setError(null);
                    loadKPIData();
                  }}
                  className="mt-3 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-all"
                >
                  Try Again
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-600/20 rounded-lg">
              <Target className="text-emerald-400" size={32} />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">AI Performance KPIs</h1>
              <p className="text-gray-400 mt-1">Monitor and improve AI trading effectiveness</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex gap-2">
              {timeframeOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setTimeframe(option.value)}
                  className={`px-4 py-2 rounded-lg font-medium transition-all ${
                    timeframe === option.value
                      ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
                      : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-all disabled:opacity-50"
            >
              <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        <div className="text-xs text-gray-500 mb-6 flex items-center gap-2">
          <Calendar size={14} />
          Last updated: {lastRefresh.toLocaleString()}
        </div>

        <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6 mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Settings size={24} className="text-blue-400" />
            <div>
              <h2 className="text-2xl font-bold text-white">System Performance & API Management</h2>
              <p className="text-gray-400 mt-1">Monitor and configure real-time data polling and API usage</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1">
              <GlobalPollingStatus />
            </div>
            <div className="lg:col-span-2 space-y-6">
              <PollingPreferences />
              <CPUCreditDashboard />
            </div>
          </div>
        </div>

        {metrics ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <MetricCard
                title="Total Trades"
                value={metrics.total_trades.toString()}
                icon={Activity}
                color="blue"
              />
              <MetricCard
                title="Win Rate"
                value={`${metrics.win_rate}%`}
                icon={Target}
                color={metrics.win_rate >= 50 ? 'green' : 'red'}
                subtitle={`${metrics.winning_trades} wins / ${metrics.losing_trades} losses`}
              />
              <MetricCard
                title="Net Profit"
                value={`$${metrics.net_profit.toFixed(2)}`}
                icon={TrendingUp}
                color={metrics.net_profit >= 0 ? 'green' : 'red'}
                subtitle={`Profit Factor: ${metrics.profit_factor.toFixed(2)}`}
              />
              <MetricCard
                title="AI Improvement"
                value={`${metrics.improvement_percentage >= 0 ? '+' : ''}${metrics.improvement_percentage}%`}
                icon={metrics.improvement_percentage >= 0 ? TrendingUp : TrendingDown}
                color={metrics.improvement_percentage >= 0 ? 'green' : 'red'}
                subtitle={`Confidence Accuracy: ${metrics.confidence_accuracy}%`}
              />
            </div>

            {/* AI Training Lab Metrics - Side by Side with Trading Performance */}
            {trainingMetrics && (
              <div className="bg-gradient-to-br from-blue-900/30 to-purple-900/30 backdrop-blur-sm border-2 border-blue-500/30 rounded-xl p-6 mb-8">
                <div className="flex items-center gap-3 mb-6">
                  <Brain className="w-8 h-8 text-blue-400" />
                  <div>
                    <h2 className="text-2xl font-bold text-white">AI Training Lab Metrics</h2>
                    <p className="text-gray-300 text-sm">Continuous learning and skill development performance</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
                  <MetricCard
                    title="AI Skill Level"
                    value={`${trainingMetrics.currentSkillLevel}%`}
                    icon={Brain}
                    color={trainingMetrics.currentSkillLevel >= 75 ? 'green' : trainingMetrics.currentSkillLevel >= 50 ? 'amber' : 'red'}
                    subtitle={`${trainingMetrics.skillImprovement >= 0 ? '+' : ''}${trainingMetrics.skillImprovement.toFixed(1)}% change`}
                  />
                  <MetricCard
                    title="Total Training Sessions"
                    value={trainingMetrics.totalBacktests.toString()}
                    icon={Activity}
                    color="blue"
                    subtitle={`${trainingMetrics.autoBacktests} auto / ${trainingMetrics.manualBacktests} manual`}
                  />
                  <MetricCard
                    title="Learning Insights"
                    value={trainingMetrics.totalInsights.toString()}
                    icon={Sparkles}
                    color="purple"
                    subtitle={`${trainingMetrics.insightsPerBacktest.toFixed(1)} per session`}
                  />
                  <MetricCard
                    title="30-Day Win Rate"
                    value={`${trainingMetrics.avgWinRate30d.toFixed(1)}%`}
                    icon={Target}
                    color={trainingMetrics.avgWinRate30d >= 55 ? 'green' : 'amber'}
                    subtitle={`Avg P&L: $${trainingMetrics.avgPnL30d.toFixed(2)}`}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                    <div className="flex items-center gap-2 mb-3">
                      <Zap className="w-5 h-5 text-green-400" />
                      <h3 className="text-white font-semibold">Auto-Backtest</h3>
                    </div>
                    <div className="text-3xl font-bold text-green-400 mb-1">{trainingMetrics.autoBacktests}</div>
                    <div className="text-sm text-gray-400">Automated training runs</div>
                  </div>

                  <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                    <div className="flex items-center gap-2 mb-3">
                      <Sparkles className="w-5 h-5 text-purple-400" />
                      <h3 className="text-white font-semibold">Synthetic Data</h3>
                    </div>
                    <div className="text-3xl font-bold text-purple-400 mb-1">{trainingMetrics.syntheticBacktests}</div>
                    <div className="text-sm text-gray-400">Synthetic training sessions</div>
                  </div>

                  <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                    <div className="flex items-center gap-2 mb-3">
                      <LineChart className="w-5 h-5 text-emerald-400" />
                      <h3 className="text-white font-semibold">Pattern Discoveries</h3>
                    </div>
                    <div className="text-3xl font-bold text-emerald-400 mb-1">{trainingMetrics.totalPatterns}</div>
                    <div className="text-sm text-gray-400">Unique patterns found</div>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                  <BarChart3 size={24} className="text-emerald-400" />
                  Performance Breakdown
                </h2>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Average Win Size</span>
                    <span className="text-green-400 font-semibold">${metrics.average_win.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Average Loss Size</span>
                    <span className="text-red-400 font-semibold">${metrics.average_loss.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Total Profit</span>
                    <span className="text-green-400 font-semibold">${metrics.total_profit.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Total Loss</span>
                    <span className="text-red-400 font-semibold">${metrics.total_loss.toFixed(2)}</span>
                  </div>
                  <div className="pt-4 border-t border-gray-800">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-300 font-medium">Risk/Reward Ratio</span>
                      <span className="text-white font-bold">
                        1:{metrics.average_loss > 0 ? (metrics.average_win / metrics.average_loss).toFixed(2) : '0'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                  <Award size={24} className="text-amber-400" />
                  Strategy Leaders
                </h2>
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-400">Best Performing</span>
                      <span className="text-green-400 font-semibold">{metrics.best_strategy}</span>
                    </div>
                    <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-green-600 to-emerald-500" style={{ width: '85%' }}></div>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-400">Needs Improvement</span>
                      <span className="text-orange-400 font-semibold">{metrics.worst_strategy}</span>
                    </div>
                    <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-orange-600 to-red-500" style={{ width: '35%' }}></div>
                    </div>
                  </div>
                  <div className="pt-4 border-t border-gray-800">
                    <div className="text-sm text-gray-400 mb-2">AI Confidence Accuracy</div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-3 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-blue-600 to-cyan-500 transition-all duration-500"
                          style={{ width: `${metrics.confidence_accuracy}%` }}
                        ></div>
                      </div>
                      <span className="text-cyan-400 font-bold">{metrics.confidence_accuracy}%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                  <TrendingUp size={24} className="text-green-400" />
                  Top 5 Strategies
                </h2>
                <div className="space-y-3">
                  {topStrategies.length > 0 ? (
                    topStrategies.map((strategy, index) => (
                      <StrategyCard key={strategy.strategy_type} strategy={strategy} rank={index + 1} />
                    ))
                  ) : (
                    <div className="text-gray-500 text-center py-8">No strategy data available</div>
                  )}
                </div>
              </div>

              <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                  <AlertCircle size={24} className="text-orange-400" />
                  Strategies Needing Improvement
                </h2>
                <div className="space-y-3">
                  {bottomStrategies.length > 0 ? (
                    bottomStrategies.map((strategy, index) => (
                      <StrategyCard key={strategy.strategy_type} strategy={strategy} rank={index + 1} isBottom />
                    ))
                  ) : (
                    <div className="text-gray-500 text-center py-8">No strategy data available</div>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Users size={24} className="text-purple-400" />
                Top Performing Users
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left py-3 px-4 text-gray-400 font-medium">Rank</th>
                      <th className="text-left py-3 px-4 text-gray-400 font-medium">User</th>
                      <th className="text-left py-3 px-4 text-gray-400 font-medium">Trades</th>
                      <th className="text-left py-3 px-4 text-gray-400 font-medium">Win Rate</th>
                      <th className="text-left py-3 px-4 text-gray-400 font-medium">Net Profit</th>
                      <th className="text-left py-3 px-4 text-gray-400 font-medium">Best Strategy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userPerformance.length > 0 ? (
                      userPerformance.map((user, index) => (
                        <tr key={user.user_id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              {index < 3 && <Award size={16} className={index === 0 ? 'text-yellow-400' : index === 1 ? 'text-gray-400' : 'text-amber-600'} />}
                              <span className="text-white font-semibold">{index + 1}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-gray-300">{user.email || 'Unknown'}</td>
                          <td className="py-3 px-4 text-gray-300">{user.total_trades}</td>
                          <td className="py-3 px-4">
                            <span className={`font-semibold ${user.win_rate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                              {user.win_rate.toFixed(1)}%
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className={`font-semibold ${user.net_profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              ${user.net_profit.toFixed(2)}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-gray-400">{user.best_strategy}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="text-center py-8 text-gray-500">
                          No user performance data available
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-12 text-center">
            <AlertCircle size={48} className="text-gray-600 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">No Data Available</h3>
            <p className="text-gray-400 mb-6">
              KPI data for this timeframe has not been collected yet. Click refresh to generate metrics.
            </p>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-all disabled:opacity-50"
            >
              {refreshing ? 'Collecting Data...' : 'Generate KPI Data'}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

interface MetricCardProps {
  title: string;
  value: string;
  icon: React.ElementType;
  color: string;
  subtitle?: string;
}

function MetricCard({ title, value, icon: Icon, color, subtitle }: MetricCardProps) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-600/20 text-blue-400',
    green: 'bg-green-600/20 text-green-400',
    red: 'bg-red-600/20 text-red-400',
    amber: 'bg-amber-600/20 text-amber-400',
  };

  // Safely get color class with fallback
  const colorClass = colorClasses[color] || colorClasses['blue'];

  return (
    <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6 hover:border-gray-700 transition-all">
      <div className="flex items-start justify-between mb-3">
        <div className={`p-3 rounded-lg ${colorClass}`}>
          <Icon size={24} />
        </div>
      </div>
      <div className="text-gray-400 text-sm mb-1">{title}</div>
      <div className="text-white text-3xl font-bold mb-2">{value}</div>
      {subtitle && <div className="text-gray-500 text-xs">{subtitle}</div>}
    </div>
  );
}

interface StrategyCardProps {
  strategy: StrategyAnalytics;
  rank: number;
  isBottom?: boolean;
}

function StrategyCard({ strategy, rank, isBottom = false }: StrategyCardProps) {
  return (
    <div className="bg-gray-800/50 rounded-lg p-4 hover:bg-gray-800 transition-all">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`text-lg font-bold ${isBottom ? 'text-orange-400' : 'text-emerald-400'}`}>
            #{rank}
          </span>
          <span className="text-white font-semibold">{strategy.strategy_type}</span>
        </div>
        <span className={`text-sm font-bold ${strategy.win_rate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
          {strategy.win_rate.toFixed(1)}%
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3 text-xs">
        <div>
          <div className="text-gray-500">Trades</div>
          <div className="text-gray-300 font-semibold">{strategy.total_trades}</div>
        </div>
        <div>
          <div className="text-gray-500">Net P&L</div>
          <div className={`font-semibold ${strategy.net_profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            ${strategy.net_profit.toFixed(0)}
          </div>
        </div>
        <div>
          <div className="text-gray-500">Best Pair</div>
          <div className="text-gray-300 font-semibold">{strategy.best_symbol}</div>
        </div>
      </div>
    </div>
  );
}
