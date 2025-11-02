import React, { useState, useEffect } from 'react';
import { NavigationMenu } from '@/components/NavigationMenu';
import { supabase } from '@/lib/supabase';
import { kpiAnalyticsService } from '@/services/kpi-analytics-service';
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
} from 'lucide-react';

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
  const [timeframe, setTimeframe] = useState<string>('all_time');
  const [metrics, setMetrics] = useState<LearningMetrics | null>(null);
  const [strategies, setStrategies] = useState<StrategyAnalytics[]>([]);
  const [userPerformance, setUserPerformance] = useState<UserPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  useEffect(() => {
    loadKPIData();
  }, [timeframe]);

  const loadKPIData = async () => {
    try {
      setLoading(true);

      const [metricsData, strategiesData, usersData] = await Promise.all([
        fetchMetrics(),
        fetchStrategies(),
        fetchUserPerformance(),
      ]);

      setMetrics(metricsData);
      setStrategies(strategiesData);
      setUserPerformance(usersData);
    } catch (error) {
      console.error('Error loading KPI data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMetrics = async (): Promise<LearningMetrics | null> => {
    const { data, error } = await supabase
      .from('ai_learning_metrics')
      .select('*')
      .eq('metric_period', timeframe)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error fetching metrics:', error);
      return null;
    }

    return data;
  };

  const fetchStrategies = async (): Promise<StrategyAnalytics[]> => {
    const { data, error } = await supabase
      .from('strategy_analytics')
      .select('*')
      .order('win_rate', { ascending: false });

    if (error) {
      console.error('Error fetching strategies:', error);
      return [];
    }

    return data || [];
  };

  const fetchUserPerformance = async (): Promise<UserPerformance[]> => {
    const { data, error } = await supabase
      .from('user_performance_summary')
      .select(`
        *,
        user_profiles!inner(email)
      `)
      .order('net_profit', { ascending: false })
      .limit(10);

    if (error) {
      console.error('Error fetching user performance:', error);
      return [];
    }

    return (data || []).map((item: any) => ({
      ...item,
      email: item.user_profiles?.email,
    }));
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await kpiAnalyticsService.refreshKPIData();
      await loadKPIData();
      setLastRefresh(new Date());
    } catch (error) {
      console.error('Error refreshing KPI data:', error);
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
  const colorClasses = {
    blue: 'bg-blue-600/20 text-blue-400',
    green: 'bg-green-600/20 text-green-400',
    red: 'bg-red-600/20 text-red-400',
    amber: 'bg-amber-600/20 text-amber-400',
  };

  return (
    <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6 hover:border-gray-700 transition-all">
      <div className="flex items-start justify-between mb-3">
        <div className={`p-3 rounded-lg ${colorClasses[color as keyof typeof colorClasses]}`}>
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
