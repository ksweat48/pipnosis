import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, TrendingUp, DollarSign, Activity, BarChart3,
  ArrowLeft, Download, RefreshCw, Eye, Shield, Target, Database
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { DataHealthPanel } from '../components/DataHealthPanel';

interface PlatformStats {
  total_users: number;
  active_traders: number;
  total_trades: number;
  open_positions: number;
  closed_positions: number;
  total_platform_pnl: number;
  avg_trade_pnl: number;
  total_platform_balance: number;
  winning_trades: number;
  losing_trades: number;
  win_rate_percentage: number;
}

interface UserSummary {
  user_id: string;
  email: string;
  full_name: string;
  account_balance: number;
  plan_type: string;
  user_since: string;
  total_trades: number;
  open_positions: number;
  closed_trades: number;
  total_pnl: number;
  avg_pnl_per_trade: number;
  best_trade: number;
  worst_trade: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
}

interface AIPerformance {
  ai_confidence: string;
  trades_executed: number;
  completed_trades: number;
  total_pnl: number;
  avg_pnl: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
}

interface SymbolStats {
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

export const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [platformStats, setPlatformStats] = useState<PlatformStats | null>(null);
  const [userSummaries, setUserSummaries] = useState<UserSummary[]>([]);
  const [aiPerformance, setAIPerformance] = useState<AIPerformance[]>([]);
  const [symbolStats, setSymbolStats] = useState<SymbolStats[]>([]);
  const [selectedView, setSelectedView] = useState<'overview' | 'users' | 'ai' | 'symbols' | 'data-health'>('overview');

  useEffect(() => {
    if (isAdmin) {
      loadAdminData();
    }
  }, [isAdmin]);

  const loadAdminData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadPlatformStats(),
        loadUserSummaries(),
        loadAIPerformance(),
        loadSymbolStats()
      ]);
    } catch (error) {
      console.error('Error loading admin data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadPlatformStats = async () => {
    try {
      const { data, error } = await supabase
        .from('platform_statistics')
        .select('*')
        .maybeSingle();

      if (error) {
        console.error('Error loading platform stats:', error);
        if (error.message.includes('tected in policy') || error.message.includes('recursion')) {
          console.warn('RLS policy error detected. The database migration may need time to propagate.');
        }
      } else {
        setPlatformStats(data);
      }
    } catch (err) {
      console.error('Exception loading platform stats:', err);
    }
  };

  const loadUserSummaries = async () => {
    try {
      const { data, error } = await supabase
        .from('user_trading_summary')
        .select('*')
        .order('total_pnl', { ascending: false });

      if (error) {
        console.error('Error loading user summaries:', error);
      } else {
        setUserSummaries(data || []);
      }
    } catch (err) {
      console.error('Exception loading user summaries:', err);
    }
  };

  const loadAIPerformance = async () => {
    try {
      const { data, error } = await supabase
        .from('ai_performance_metrics')
        .select('*')
        .order('ai_confidence', { ascending: false });

      if (error) {
        console.error('Error loading AI performance:', error);
      } else {
        setAIPerformance(data || []);
      }
    } catch (err) {
      console.error('Exception loading AI performance:', err);
    }
  };

  const loadSymbolStats = async () => {
    try {
      const { data, error } = await supabase
        .from('trading_by_symbol')
        .select('*')
        .order('total_trades', { ascending: false })
        .limit(10);

      if (error) {
        console.error('Error loading symbol stats:', error);
      } else {
        setSymbolStats(data || []);
      }
    } catch (err) {
      console.error('Exception loading symbol stats:', err);
    }
  };

  const exportData = async () => {
    const exportData = {
      platform_stats: platformStats,
      user_summaries: userSummaries,
      ai_performance: aiPerformance,
      symbol_stats: symbolStats,
      exported_at: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pipnosis-analytics-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="h-12 w-12 text-emerald-400 animate-spin mx-auto mb-4" />
          <p className="text-white/70 text-lg">Loading analytics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => navigate('/')}
              className="p-2 glass-card hover:bg-white/10 transition-colors rounded-lg"
            >
              <ArrowLeft className="h-5 w-5 text-white" />
            </button>
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold text-white">Admin Dashboard</h1>
              <p className="text-white/60 mt-1">Platform analytics and user management</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={loadAdminData}
              className="px-4 py-2 glass-card hover:bg-white/10 transition-colors rounded-lg flex items-center space-x-2"
            >
              <RefreshCw className="h-4 w-4 text-emerald-400" />
              <span className="text-white text-sm">Refresh</span>
            </button>
            <button
              onClick={exportData}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 transition-colors rounded-lg flex items-center space-x-2"
            >
              <Download className="h-4 w-4 text-white" />
              <span className="text-white text-sm font-medium">Export Data</span>
            </button>
          </div>
        </div>

        <div className="flex space-x-2 mb-6 overflow-x-auto pb-2">
          {[
            { id: 'overview', label: 'Overview', icon: BarChart3 },
            { id: 'users', label: 'Users', icon: Users },
            { id: 'ai', label: 'AI Performance', icon: Target },
            { id: 'symbols', label: 'Trading Pairs', icon: TrendingUp },
            { id: 'data-health', label: 'Data Health', icon: Database }
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSelectedView(id as any)}
              className={`px-4 py-2 rounded-lg flex items-center space-x-2 transition-colors whitespace-nowrap ${
                selectedView === id
                  ? 'bg-emerald-500 text-white'
                  : 'glass-card text-white/60 hover:text-white hover:bg-white/10'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="text-sm font-medium">{label}</span>
            </button>
          ))}
        </div>

        {selectedView === 'overview' && platformStats && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="glass-card p-6">
                <div className="flex items-center justify-between mb-2">
                  <Users className="h-8 w-8 text-blue-400" />
                  <Shield className="h-5 w-5 text-emerald-400" />
                </div>
                <div className="text-3xl font-bold text-white mb-1">
                  {platformStats.total_users}
                </div>
                <div className="text-sm text-white/60">Total Users</div>
              </div>

              <div className="glass-card p-6">
                <div className="flex items-center justify-between mb-2">
                  <Activity className="h-8 w-8 text-green-400" />
                </div>
                <div className="text-3xl font-bold text-white mb-1">
                  {platformStats.active_traders}
                </div>
                <div className="text-sm text-white/60">Active Traders</div>
              </div>

              <div className="glass-card p-6">
                <div className="flex items-center justify-between mb-2">
                  <TrendingUp className="h-8 w-8 text-emerald-400" />
                </div>
                <div className="text-3xl font-bold text-white mb-1">
                  {platformStats.total_trades}
                </div>
                <div className="text-sm text-white/60">Total Trades</div>
              </div>

              <div className="glass-card p-6">
                <div className="flex items-center justify-between mb-2">
                  <DollarSign className="h-8 w-8 text-yellow-400" />
                </div>
                <div className={`text-3xl font-bold mb-1 ${
                  platformStats.total_platform_pnl >= 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                  ${platformStats.total_platform_pnl.toFixed(2)}
                </div>
                <div className="text-sm text-white/60">Platform P&L</div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="glass-card p-6">
                <h3 className="text-lg font-bold text-white mb-4">Trading Statistics</h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-white/60">Open Positions</span>
                    <span className="text-white font-semibold">{platformStats.open_positions}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-white/60">Closed Positions</span>
                    <span className="text-white font-semibold">{platformStats.closed_positions}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-white/60">Winning Trades</span>
                    <span className="text-green-400 font-semibold">{platformStats.winning_trades}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-white/60">Losing Trades</span>
                    <span className="text-red-400 font-semibold">{platformStats.losing_trades}</span>
                  </div>
                  <div className="flex justify-between items-center pt-3 border-t border-white/10">
                    <span className="text-white/60">Win Rate</span>
                    <span className="text-emerald-400 font-bold text-lg">
                      {platformStats.win_rate_percentage}%
                    </span>
                  </div>
                </div>
              </div>

              <div className="glass-card p-6">
                <h3 className="text-lg font-bold text-white mb-4">Financial Overview</h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-white/60">Total Platform Balance</span>
                    <span className="text-white font-semibold">
                      ${platformStats.total_platform_balance.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-white/60">Avg Trade P&L</span>
                    <span className={`font-semibold ${
                      platformStats.avg_trade_pnl >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      ${platformStats.avg_trade_pnl.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-white/60">Total Platform P&L</span>
                    <span className={`font-semibold ${
                      platformStats.total_platform_pnl >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      ${platformStats.total_platform_pnl.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedView === 'users' && (
          <div className="glass-card p-6">
            <h3 className="text-xl font-bold text-white mb-6">User Trading Summary</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-3 px-4 text-white/60 font-medium text-sm">User</th>
                    <th className="text-right py-3 px-4 text-white/60 font-medium text-sm">Balance</th>
                    <th className="text-right py-3 px-4 text-white/60 font-medium text-sm">Trades</th>
                    <th className="text-right py-3 px-4 text-white/60 font-medium text-sm">Total P&L</th>
                    <th className="text-right py-3 px-4 text-white/60 font-medium text-sm">Win Rate</th>
                    <th className="text-right py-3 px-4 text-white/60 font-medium text-sm">Plan</th>
                  </tr>
                </thead>
                <tbody>
                  {userSummaries.map((user) => (
                    <tr key={user.user_id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-3 px-4">
                        <div>
                          <div className="text-white font-medium">
                            {user.full_name || user.email}
                          </div>
                          <div className="text-white/40 text-xs">{user.email}</div>
                        </div>
                      </td>
                      <td className="text-right py-3 px-4 text-white font-mono">
                        ${user.account_balance.toFixed(2)}
                      </td>
                      <td className="text-right py-3 px-4 text-white">
                        {user.total_trades}
                      </td>
                      <td className={`text-right py-3 px-4 font-semibold ${
                        user.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        ${user.total_pnl.toFixed(2)}
                      </td>
                      <td className="text-right py-3 px-4 text-emerald-400 font-medium">
                        {user.win_rate}%
                      </td>
                      <td className="text-right py-3 px-4">
                        <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded text-xs font-medium uppercase">
                          {user.plan_type}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {selectedView === 'ai' && (
          <div className="space-y-6">
            <div className="glass-card p-6">
              <h3 className="text-xl font-bold text-white mb-6">AI Performance by Confidence Level</h3>
              <div className="space-y-4">
                {aiPerformance.map((ai) => (
                  <div key={ai.ai_confidence} className="border border-white/10 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center space-x-3">
                        <div className={`w-3 h-3 rounded-full ${
                          ai.ai_confidence === 'high' ? 'bg-green-400' :
                          ai.ai_confidence === 'medium' ? 'bg-yellow-400' : 'bg-red-400'
                        }`}></div>
                        <h4 className="text-lg font-semibold text-white capitalize">
                          {ai.ai_confidence} Confidence
                        </h4>
                      </div>
                      <div className="text-emerald-400 font-bold text-lg">
                        {ai.win_rate}% Win Rate
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <div>
                        <div className="text-white/60 text-sm mb-1">Trades Executed</div>
                        <div className="text-white font-semibold">{ai.trades_executed}</div>
                      </div>
                      <div>
                        <div className="text-white/60 text-sm mb-1">Completed</div>
                        <div className="text-white font-semibold">{ai.completed_trades}</div>
                      </div>
                      <div>
                        <div className="text-white/60 text-sm mb-1">Total P&L</div>
                        <div className={`font-semibold ${
                          ai.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          ${ai.total_pnl.toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <div className="text-white/60 text-sm mb-1">Avg P&L</div>
                        <div className={`font-semibold ${
                          ai.avg_pnl >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          ${ai.avg_pnl.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {selectedView === 'symbols' && (
          <div className="glass-card p-6">
            <h3 className="text-xl font-bold text-white mb-6">Top Trading Pairs</h3>
            <div className="space-y-3">
              {symbolStats.map((symbol) => (
                <div key={symbol.symbol} className="border border-white/10 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-lg font-bold text-white">{symbol.symbol}</h4>
                    <div className="flex items-center space-x-4">
                      <div className="text-right">
                        <div className="text-white/60 text-xs">Win Rate</div>
                        <div className="text-emerald-400 font-bold">{symbol.win_rate}%</div>
                      </div>
                      <div className="text-right">
                        <div className="text-white/60 text-xs">Total P&L</div>
                        <div className={`font-bold ${
                          symbol.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          ${symbol.total_pnl.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-4 text-sm">
                    <div>
                      <div className="text-white/60 mb-1">Total Trades</div>
                      <div className="text-white font-medium">{symbol.total_trades}</div>
                    </div>
                    <div>
                      <div className="text-white/60 mb-1">Open</div>
                      <div className="text-white font-medium">{symbol.open_positions}</div>
                    </div>
                    <div>
                      <div className="text-white/60 mb-1">Closed</div>
                      <div className="text-white font-medium">{symbol.closed_trades}</div>
                    </div>
                    <div>
                      <div className="text-white/60 mb-1">Winners</div>
                      <div className="text-green-400 font-medium">{symbol.winning_trades}</div>
                    </div>
                    <div>
                      <div className="text-white/60 mb-1">Losers</div>
                      <div className="text-red-400 font-medium">{symbol.losing_trades}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {selectedView === 'data-health' && (
          <DataHealthPanel />
        )}
      </div>
    </div>
  );
};
