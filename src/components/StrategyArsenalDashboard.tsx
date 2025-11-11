import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import {
  Trophy, TrendingUp, Target, Zap, Brain, ChevronDown, ChevronUp,
  CheckCircle, XCircle, Activity, Clock, BarChart3, Flame
} from 'lucide-react';

interface Strategy {
  id: string;
  strategy_name: string;
  strategy_type: string;
  generation: number;
  win_rate: number;
  profit_factor: number;
  expectancy: number;
  sharpe_ratio: number;
  total_trades: number;
  validation_status: string;
  passes_baseline: boolean;
  discovery_method: string;
  created_at: string;
  last_used_at: string | null;
  trending_up_win_rate: number;
  trending_down_win_rate: number;
  ranging_win_rate: number;
  high_volatility_win_rate: number;
  low_volatility_win_rate: number;
  entry_rules: any;
  exit_rules: any;
  indicators: any;
  dna_encoding: any;
  baseline_comparison: any;
}

export default function StrategyArsenalDashboard() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active' | 'validated'>('active');
  const [sortBy, setSortBy] = useState<'expectancy' | 'win_rate' | 'profit_factor'>('expectancy');

  useEffect(() => {
    loadStrategies();
  }, [filter]);

  async function loadStrategies() {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let query = supabase
        .from('ai_discovered_strategies')
        .select('*')
        .eq('user_id', user.id);

      if (filter === 'active') {
        query = query.eq('validation_status', 'active').eq('passes_baseline', true);
      } else if (filter === 'validated') {
        query = query.in('validation_status', ['validated', 'active']);
      }

      const { data, error } = await query.order('expectancy', { ascending: false });

      if (error) {
        console.error('Error loading strategies:', error);
        return;
      }

      setStrategies(data || []);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  }

  const getSortedStrategies = () => {
    return [...strategies].sort((a, b) => {
      switch (sortBy) {
        case 'win_rate':
          return b.win_rate - a.win_rate;
        case 'profit_factor':
          return b.profit_factor - a.profit_factor;
        case 'expectancy':
        default:
          return b.expectancy - a.expectancy;
      }
    });
  };

  const getStrategyIcon = (type: string) => {
    switch (type) {
      case 'discovered':
        return <Brain className="w-5 h-5 text-purple-500" />;
      case 'evolved':
        return <Zap className="w-5 h-5 text-yellow-500" />;
      case 'hybrid':
        return <Flame className="w-5 h-5 text-orange-500" />;
      default:
        return <Target className="w-5 h-5 text-blue-500" />;
    }
  };

  const getPerformanceColor = (value: number, type: 'winRate' | 'profitFactor') => {
    if (type === 'winRate') {
      if (value >= 70) return 'text-green-500';
      if (value >= 60) return 'text-blue-500';
      if (value >= 55) return 'text-yellow-500';
      return 'text-red-500';
    } else {
      if (value >= 2.5) return 'text-green-500';
      if (value >= 2.0) return 'text-blue-500';
      if (value >= 1.5) return 'text-yellow-500';
      return 'text-red-500';
    }
  };

  const activeStrategies = strategies.filter(s => s.validation_status === 'active' && s.passes_baseline);
  const totalTrades = strategies.reduce((sum, s) => sum + s.total_trades, 0);
  const avgWinRate = strategies.length > 0
    ? strategies.reduce((sum, s) => sum + s.win_rate, 0) / strategies.length
    : 0;

  return (
    <div className="space-y-6">
      {/* Header Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-purple-100 text-sm">Total Strategies</p>
              <p className="text-3xl font-bold mt-1">{strategies.length}</p>
            </div>
            <Trophy className="w-10 h-10 text-purple-200" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-100 text-sm">Active Strategies</p>
              <p className="text-3xl font-bold mt-1">{activeStrategies.length}</p>
            </div>
            <CheckCircle className="w-10 h-10 text-green-200" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-sm">Avg Win Rate</p>
              <p className="text-3xl font-bold mt-1">{avgWinRate.toFixed(1)}%</p>
            </div>
            <TrendingUp className="w-10 h-10 text-blue-200" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-orange-100 text-sm">Total Trades</p>
              <p className="text-3xl font-bold mt-1">{totalTrades}</p>
            </div>
            <Activity className="w-10 h-10 text-orange-200" />
          </div>
        </div>
      </div>

      {/* Filters and Sort */}
      <div className="bg-gray-800 rounded-lg p-4">
        <div className="flex flex-wrap gap-4 items-center justify-between">
          <div className="flex gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded-lg transition-colors ${
                filter === 'all'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              All Strategies
            </button>
            <button
              onClick={() => setFilter('active')}
              className={`px-4 py-2 rounded-lg transition-colors ${
                filter === 'active'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Active Only
            </button>
            <button
              onClick={() => setFilter('validated')}
              className={`px-4 py-2 rounded-lg transition-colors ${
                filter === 'validated'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Validated
            </button>
          </div>

          <div className="flex gap-2 items-center">
            <span className="text-gray-400 text-sm">Sort by:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-gray-700 text-white px-3 py-2 rounded-lg border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            >
              <option value="expectancy">Expectancy</option>
              <option value="win_rate">Win Rate</option>
              <option value="profit_factor">Profit Factor</option>
            </select>
          </div>
        </div>
      </div>

      {/* Strategy List */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading strategies...</div>
      ) : strategies.length === 0 ? (
        <div className="bg-gray-800 rounded-lg p-12 text-center">
          <Brain className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 mb-2">No strategies discovered yet</p>
          <p className="text-gray-500 text-sm">
            Run backtests to discover new trading strategies
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {getSortedStrategies().map((strategy) => (
            <div
              key={strategy.id}
              className="bg-gray-800 rounded-lg p-5 hover:bg-gray-750 transition-colors cursor-pointer"
              onClick={() => {
                setSelectedStrategy(strategy);
                setShowDetails(true);
              }}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    {getStrategyIcon(strategy.strategy_type)}
                    <div>
                      <h3 className="text-white font-semibold text-lg">
                        {strategy.strategy_name}
                      </h3>
                      <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
                        <span className="capitalize">{strategy.strategy_type}</span>
                        <span>•</span>
                        <span>Gen {strategy.generation}</span>
                        <span>•</span>
                        <span className="capitalize">{strategy.discovery_method.replace('_', ' ')}</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div>
                      <p className="text-gray-400 text-xs mb-1">Win Rate</p>
                      <p className={`font-bold text-lg ${getPerformanceColor(strategy.win_rate, 'winRate')}`}>
                        {strategy.win_rate.toFixed(1)}%
                      </p>
                    </div>

                    <div>
                      <p className="text-gray-400 text-xs mb-1">Profit Factor</p>
                      <p className={`font-bold text-lg ${getPerformanceColor(strategy.profit_factor, 'profitFactor')}`}>
                        {strategy.profit_factor.toFixed(2)}
                      </p>
                    </div>

                    <div>
                      <p className="text-gray-400 text-xs mb-1">Expectancy</p>
                      <p className="font-bold text-lg text-blue-400">
                        ${strategy.expectancy.toFixed(2)}
                      </p>
                    </div>

                    <div>
                      <p className="text-gray-400 text-xs mb-1">Sharpe Ratio</p>
                      <p className="font-bold text-lg text-purple-400">
                        {strategy.sharpe_ratio.toFixed(2)}
                      </p>
                    </div>

                    <div>
                      <p className="text-gray-400 text-xs mb-1">Total Trades</p>
                      <p className="font-bold text-lg text-gray-300">
                        {strategy.total_trades}
                      </p>
                    </div>
                  </div>

                  {/* Status Badges */}
                  <div className="flex flex-wrap gap-2 mt-4">
                    {strategy.passes_baseline && (
                      <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-full flex items-center gap-1">
                        <Trophy className="w-3 h-3" />
                        Beats Baseline
                      </span>
                    )}
                    {strategy.validation_status === 'active' && (
                      <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded-full flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />
                        Active
                      </span>
                    )}
                    {strategy.last_used_at && (
                      <span className="px-2 py-1 bg-purple-500/20 text-purple-400 text-xs rounded-full flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Recently Used
                      </span>
                    )}
                  </div>
                </div>

                <button className="text-gray-400 hover:text-white transition-colors">
                  <ChevronDown className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Strategy Details Modal */}
      {showDetails && selectedStrategy && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gray-800 border-b border-gray-700 p-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {getStrategyIcon(selectedStrategy.strategy_type)}
                <div>
                  <h2 className="text-2xl font-bold text-white">
                    {selectedStrategy.strategy_name}
                  </h2>
                  <p className="text-gray-400 text-sm mt-1">
                    Generation {selectedStrategy.generation} • {selectedStrategy.strategy_type}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDetails(false)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Performance Overview */}
              <div>
                <h3 className="text-lg font-semibold text-white mb-4">Performance Metrics</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="bg-gray-700 rounded-lg p-4">
                    <p className="text-gray-400 text-sm">Win Rate</p>
                    <p className={`text-2xl font-bold ${getPerformanceColor(selectedStrategy.win_rate, 'winRate')}`}>
                      {selectedStrategy.win_rate.toFixed(1)}%
                    </p>
                  </div>
                  <div className="bg-gray-700 rounded-lg p-4">
                    <p className="text-gray-400 text-sm">Profit Factor</p>
                    <p className={`text-2xl font-bold ${getPerformanceColor(selectedStrategy.profit_factor, 'profitFactor')}`}>
                      {selectedStrategy.profit_factor.toFixed(2)}
                    </p>
                  </div>
                  <div className="bg-gray-700 rounded-lg p-4">
                    <p className="text-gray-400 text-sm">Expectancy</p>
                    <p className="text-2xl font-bold text-blue-400">
                      ${selectedStrategy.expectancy.toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Regime Performance */}
              <div>
                <h3 className="text-lg font-semibold text-white mb-4">Market Regime Performance</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {selectedStrategy.trending_up_win_rate > 0 && (
                    <div className="bg-gray-700 rounded-lg p-3">
                      <p className="text-gray-400 text-xs">Trending Up</p>
                      <p className="text-green-400 font-bold">
                        {selectedStrategy.trending_up_win_rate.toFixed(1)}%
                      </p>
                    </div>
                  )}
                  {selectedStrategy.trending_down_win_rate > 0 && (
                    <div className="bg-gray-700 rounded-lg p-3">
                      <p className="text-gray-400 text-xs">Trending Down</p>
                      <p className="text-red-400 font-bold">
                        {selectedStrategy.trending_down_win_rate.toFixed(1)}%
                      </p>
                    </div>
                  )}
                  {selectedStrategy.ranging_win_rate > 0 && (
                    <div className="bg-gray-700 rounded-lg p-3">
                      <p className="text-gray-400 text-xs">Ranging</p>
                      <p className="text-yellow-400 font-bold">
                        {selectedStrategy.ranging_win_rate.toFixed(1)}%
                      </p>
                    </div>
                  )}
                  {selectedStrategy.high_volatility_win_rate > 0 && (
                    <div className="bg-gray-700 rounded-lg p-3">
                      <p className="text-gray-400 text-xs">High Volatility</p>
                      <p className="text-orange-400 font-bold">
                        {selectedStrategy.high_volatility_win_rate.toFixed(1)}%
                      </p>
                    </div>
                  )}
                  {selectedStrategy.low_volatility_win_rate > 0 && (
                    <div className="bg-gray-700 rounded-lg p-3">
                      <p className="text-gray-400 text-xs">Low Volatility</p>
                      <p className="text-blue-400 font-bold">
                        {selectedStrategy.low_volatility_win_rate.toFixed(1)}%
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Strategy DNA */}
              <div>
                <h3 className="text-lg font-semibold text-white mb-4">Strategy DNA</h3>
                <div className="bg-gray-700 rounded-lg p-4">
                  <pre className="text-sm text-gray-300 overflow-x-auto">
                    {JSON.stringify(selectedStrategy.dna_encoding, null, 2)}
                  </pre>
                </div>
              </div>

              {/* Baseline Comparison */}
              {selectedStrategy.baseline_comparison && (
                <div>
                  <h3 className="text-lg font-semibold text-white mb-4">
                    Comparison to Flow Trader V2
                  </h3>
                  <div className="bg-gray-700 rounded-lg p-4 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Baseline Win Rate:</span>
                      <span className="text-white font-semibold">
                        {selectedStrategy.baseline_comparison.baseline_win_rate?.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Your Win Rate:</span>
                      <span className="text-green-400 font-semibold">
                        {selectedStrategy.baseline_comparison.new_win_rate?.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-gray-600">
                      <span className="text-gray-400">Improvement:</span>
                      <span className="text-blue-400 font-bold">
                        +{(selectedStrategy.baseline_comparison.new_win_rate - selectedStrategy.baseline_comparison.baseline_win_rate).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
