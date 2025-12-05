import { useState, useEffect } from 'react';
import {
  TrendingUp,
  Brain,
  Target,
  Activity,
  BarChart3,
  Zap,
  Award,
  AlertCircle,
  CheckCircle,
  XCircle
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

interface SymbolPerformance {
  symbol: string;
  total_trades: number;
  open_positions: number;
  closed_trades: number;
  total_pnl: number;
  avg_pnl: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
}

interface StrategyMemory {
  id: string;
  symbol: string;
  strategy_mode: string;
  trades_executed: number;
  trades_won: number;
  trades_lost: number;
  win_rate: number;
  total_pnl: number;
  avg_pnl: number;
  performance_rating: string;
  what_worked: string;
  what_failed: string;
  key_lesson: string;
  status: string;
  created_at: string;
}

interface SymbolRanking {
  id: string;
  scan_time: string;
  rankings: Array<{
    symbol: string;
    confidence: number;
    score: number;
    reasoning: string;
  }>;
  selected_symbol: string;
  selected_rank: number;
  selected_confidence: number;
  total_symbols_scanned: number;
}

interface LoadMetrics {
  symbol: string;
  api_calls_count: number;
  error_count: number;
  avg_response_time_ms: number;
  priority: string;
  timestamp: string;
}

export default function MultiSymbolIntelligencePage() {
  const { user } = useAuth();
  const [symbolPerformance, setSymbolPerformance] = useState<SymbolPerformance[]>([]);
  const [strategyMemories, setStrategyMemories] = useState<StrategyMemory[]>([]);
  const [rankings, setRankings] = useState<SymbolRanking[]>([]);
  const [loadMetrics, setLoadMetrics] = useState<LoadMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d' | 'all'>('7d');

  useEffect(() => {
    if (user) {
      loadDashboardData();
      const interval = setInterval(loadDashboardData, 30000);
      return () => clearInterval(interval);
    }
  }, [user, timeRange]);

  const loadDashboardData = async () => {
    try {
      const cutoffDate = getTimeRangeCutoff(timeRange);

      const [perfData, memoryData, rankingData, metricsData] = await Promise.all([
        supabase.from('trading_by_symbol').select('*'),
        supabase
          .from('alpha_strategy_memory')
          .select('*')
          .eq('user_id', user?.id)
          .gte('created_at', cutoffDate)
          .order('created_at', { ascending: false }),
        supabase
          .from('goal_symbol_rankings')
          .select('*')
          .eq('user_id', user?.id)
          .gte('scan_time', cutoffDate)
          .order('scan_time', { ascending: false })
          .limit(50),
        supabase
          .from('symbol_load_metrics')
          .select('*')
          .gte('timestamp', cutoffDate)
          .order('timestamp', { ascending: false })
          .limit(100)
      ]);

      if (perfData.data) setSymbolPerformance(perfData.data);
      if (memoryData.data) setStrategyMemories(memoryData.data);
      if (rankingData.data) setRankings(rankingData.data);
      if (metricsData.data) setLoadMetrics(metricsData.data);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getTimeRangeCutoff = (range: string) => {
    const now = new Date();
    switch (range) {
      case '24h': return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      case '7d': return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      case '30d': return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      default: return new Date('2020-01-01').toISOString();
    }
  };

  const getPerformanceColor = (winRate: number) => {
    if (winRate >= 60) return 'text-green-400';
    if (winRate >= 50) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getRatingBadge = (rating: string) => {
    const colors = {
      excellent: 'bg-green-500/20 text-green-400 border-green-500/30',
      good: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      average: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      poor: 'bg-red-500/20 text-red-400 border-red-500/30'
    };
    return colors[rating as keyof typeof colors] || colors.average;
  };

  const getSymbolRankingHistory = (symbol: string) => {
    return rankings
      .filter(r => r.rankings?.some(rank => rank.symbol === symbol))
      .map(r => {
        const symbolData = r.rankings.find(rank => rank.symbol === symbol);
        return {
          time: new Date(r.scan_time).toLocaleDateString(),
          confidence: symbolData?.confidence || 0,
          selected: r.selected_symbol === symbol
        };
      });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Activity className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading Intelligence Dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Brain className="w-8 h-8 text-blue-500" />
              Multi-Symbol Intelligence
            </h1>
            <p className="text-gray-400 mt-1">AI performance across all trading pairs</p>
          </div>
          <div className="flex gap-2">
            {(['24h', '7d', '30d', 'all'] as const).map(range => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  timeRange === range
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-gray-400 hover:bg-slate-700'
                }`}
              >
                {range.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-lg p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Total Symbols Tracked</p>
                <p className="text-2xl font-bold mt-1">{symbolPerformance.length}</p>
              </div>
              <Target className="w-8 h-8 text-blue-500" />
            </div>
          </div>
          <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-lg p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Strategy Memories</p>
                <p className="text-2xl font-bold mt-1">{strategyMemories.length}</p>
              </div>
              <Brain className="w-8 h-8 text-purple-500" />
            </div>
          </div>
          <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-lg p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Scans Performed</p>
                <p className="text-2xl font-bold mt-1">{rankings.length}</p>
              </div>
              <BarChart3 className="w-8 h-8 text-green-500" />
            </div>
          </div>
          <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-lg p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Avg Win Rate</p>
                <p className="text-2xl font-bold mt-1">
                  {symbolPerformance.length > 0
                    ? (symbolPerformance.reduce((acc, s) => acc + (s.win_rate || 0), 0) / symbolPerformance.length).toFixed(1)
                    : '0.0'}%
                </p>
              </div>
              <TrendingUp className="w-8 h-8 text-yellow-500" />
            </div>
          </div>
        </div>

        {/* Symbol Performance Grid */}
        <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-lg p-6">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-500" />
            Symbol Performance Matrix
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left border-b border-slate-700">
                  <th className="pb-3 px-4 text-gray-400 font-medium">Symbol</th>
                  <th className="pb-3 px-4 text-gray-400 font-medium">Total Trades</th>
                  <th className="pb-3 px-4 text-gray-400 font-medium">Win Rate</th>
                  <th className="pb-3 px-4 text-gray-400 font-medium">Total P&L</th>
                  <th className="pb-3 px-4 text-gray-400 font-medium">Avg P&L</th>
                  <th className="pb-3 px-4 text-gray-400 font-medium">Open</th>
                  <th className="pb-3 px-4 text-gray-400 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {symbolPerformance.map((symbol, idx) => (
                  <tr
                    key={idx}
                    onClick={() => setSelectedSymbol(symbol.symbol)}
                    className="border-b border-slate-700/50 hover:bg-slate-700/30 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4">
                      <span className="font-medium text-blue-400">{symbol.symbol}</span>
                    </td>
                    <td className="py-3 px-4">{symbol.total_trades}</td>
                    <td className="py-3 px-4">
                      <span className={`font-medium ${getPerformanceColor(symbol.win_rate || 0)}`}>
                        {symbol.win_rate?.toFixed(1) || '0.0'}%
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={symbol.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                        ${symbol.total_pnl?.toFixed(2) || '0.00'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={symbol.avg_pnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                        ${symbol.avg_pnl?.toFixed(2) || '0.00'}
                      </span>
                    </td>
                    <td className="py-3 px-4">{symbol.open_positions}</td>
                    <td className="py-3 px-4">
                      {symbol.open_positions > 0 ? (
                        <span className="flex items-center gap-1 text-green-400">
                          <Activity className="w-4 h-4" />
                          Active
                        </span>
                      ) : (
                        <span className="text-gray-500">Idle</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {symbolPerformance.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                No symbol performance data available for selected time range
              </div>
            )}
          </div>
        </div>

        {/* Recent Symbol Rankings */}
        <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-lg p-6">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Award className="w-5 h-5 text-yellow-500" />
            Recent Symbol Rankings
          </h2>
          <div className="space-y-4">
            {rankings.slice(0, 10).map((ranking, idx) => (
              <div key={ranking.id} className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-gray-400 text-sm">
                      {new Date(ranking.scan_time).toLocaleString()}
                    </span>
                    <span className="text-sm text-gray-500">
                      Scanned {ranking.total_symbols_scanned} symbols
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <span className="text-green-400 font-medium">{ranking.selected_symbol}</span>
                    <span className="text-gray-400 text-sm">
                      (Rank #{ranking.selected_rank}, {ranking.selected_confidence?.toFixed(1)}% conf)
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                  {ranking.rankings?.slice(0, 6).map((rank, i) => (
                    <div
                      key={i}
                      className={`p-3 rounded border ${
                        rank.symbol === ranking.selected_symbol
                          ? 'bg-green-500/10 border-green-500/30'
                          : 'bg-slate-800 border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">{rank.symbol}</span>
                        <span className="text-xs text-gray-400">#{i + 1}</span>
                      </div>
                      <div className="text-lg font-bold text-blue-400">{rank.confidence?.toFixed(1)}%</div>
                      <div className="text-xs text-gray-500 mt-1 truncate">{rank.reasoning}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {rankings.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                No ranking data available for selected time range
              </div>
            )}
          </div>
        </div>

        {/* Strategy Memories */}
        <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-lg p-6">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-500" />
            Strategy Memory Bank
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {strategyMemories
              .filter(mem => !selectedSymbol || mem.symbol === selectedSymbol)
              .slice(0, 8)
              .map((memory) => (
                <div
                  key={memory.id}
                  className="bg-slate-900/50 rounded-lg p-5 border border-slate-700 hover:border-slate-600 transition-colors"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg font-bold text-blue-400">{memory.symbol}</span>
                        <span className={`px-2 py-1 rounded text-xs border ${getRatingBadge(memory.performance_rating || 'average')}`}>
                          {memory.performance_rating?.toUpperCase() || 'N/A'}
                        </span>
                      </div>
                      <span className="text-sm text-gray-400">{memory.strategy_mode}</span>
                    </div>
                    <div className="text-right">
                      <div className={`text-lg font-bold ${getPerformanceColor(memory.win_rate || 0)}`}>
                        {memory.win_rate?.toFixed(1) || '0.0'}%
                      </div>
                      <div className="text-xs text-gray-500">{memory.trades_executed} trades</div>
                    </div>
                  </div>

                  <div className="space-y-2 mb-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-400">P&L:</span>
                      <span className={memory.total_pnl >= 0 ? 'text-green-400 font-medium' : 'text-red-400 font-medium'}>
                        ${memory.total_pnl?.toFixed(2) || '0.00'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-400">Win/Loss:</span>
                      <span className="font-medium">
                        <span className="text-green-400">{memory.trades_won}W</span>
                        {' / '}
                        <span className="text-red-400">{memory.trades_lost}L</span>
                      </span>
                    </div>
                  </div>

                  {memory.key_lesson && (
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded p-3 mb-2">
                      <div className="flex items-start gap-2">
                        <Zap className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <div className="text-xs text-blue-400 font-medium mb-1">Key Lesson</div>
                          <div className="text-sm text-gray-300">{memory.key_lesson}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {memory.what_worked && (
                    <div className="mb-2">
                      <div className="flex items-start gap-2 text-sm">
                        <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="text-green-400 font-medium">Worked:</span>{' '}
                          <span className="text-gray-400">{memory.what_worked}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {memory.what_failed && (
                    <div>
                      <div className="flex items-start gap-2 text-sm">
                        <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="text-red-400 font-medium">Failed:</span>{' '}
                          <span className="text-gray-400">{memory.what_failed}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-3 pt-3 border-t border-slate-700 flex items-center justify-between text-xs text-gray-500">
                    <span>{new Date(memory.created_at).toLocaleDateString()}</span>
                    <span className={`px-2 py-1 rounded ${
                      memory.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                    }`}>
                      {memory.status}
                    </span>
                  </div>
                </div>
              ))}
          </div>
          {strategyMemories.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No strategy memories available for selected time range
            </div>
          )}
        </div>

        {/* System Load Metrics */}
        {loadMetrics.length > 0 && (
          <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-lg p-6">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5 text-orange-500" />
              System Load Metrics
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {loadMetrics.slice(0, 9).map((metric, idx) => (
                <div key={idx} className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-blue-400">{metric.symbol}</span>
                    <span className={`text-xs px-2 py-1 rounded ${
                      metric.priority === 'high'
                        ? 'bg-red-500/20 text-red-400'
                        : metric.priority === 'medium'
                        ? 'bg-yellow-500/20 text-yellow-400'
                        : 'bg-green-500/20 text-green-400'
                    }`}>
                      {metric.priority}
                    </span>
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">API Calls:</span>
                      <span className="font-medium">{metric.api_calls_count}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Errors:</span>
                      <span className={metric.error_count > 0 ? 'text-red-400 font-medium' : 'text-gray-500'}>
                        {metric.error_count}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Avg Response:</span>
                      <span className="font-medium">{metric.avg_response_time_ms}ms</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Symbol Filter Info */}
        {selectedSymbol && (
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-blue-400" />
                <span className="text-blue-400 font-medium">
                  Filtering by symbol: {selectedSymbol}
                </span>
              </div>
              <button
                onClick={() => setSelectedSymbol(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm font-medium transition-colors"
              >
                Clear Filter
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
