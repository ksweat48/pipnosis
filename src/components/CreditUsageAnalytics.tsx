import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Activity, DollarSign, Calendar, BarChart3 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

interface UsageStats {
  today: number;
  thisWeek: number;
  thisMonth: number;
  averagePerDay: number;
  averagePerSession: number;
  totalSessions: number;
  mostExpensiveSession: {
    amount: number;
    date: string;
  } | null;
}

export function CreditUsageAnalytics() {
  const { user } = useAuth();
  const [stats, setStats] = useState<UsageStats>({
    today: 0,
    thisWeek: 0,
    thisMonth: 0,
    averagePerDay: 0,
    averagePerSession: 0,
    totalSessions: 0,
    mostExpensiveSession: null
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (user?.id) {
      loadUsageStats();
    }
  }, [user?.id]);

  const loadUsageStats = async () => {
    if (!user?.id) return;

    setIsLoading(true);
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const { data: deductions, error } = await supabase
        .from('credit_deduction_history')
        .select('amount, timestamp, session_id')
        .eq('status', 'success')
        .order('timestamp', { ascending: false });

      if (error) throw error;

      if (deductions) {
        const todayDeductions = deductions.filter(
          d => new Date(d.timestamp) >= todayStart
        );
        const weekDeductions = deductions.filter(
          d => new Date(d.timestamp) >= weekStart
        );
        const monthDeductions = deductions.filter(
          d => new Date(d.timestamp) >= monthStart
        );

        const todayTotal = todayDeductions.reduce((sum, d) => sum + d.amount, 0);
        const weekTotal = weekDeductions.reduce((sum, d) => sum + d.amount, 0);
        const monthTotal = monthDeductions.reduce((sum, d) => sum + d.amount, 0);

        const uniqueSessions = new Set(deductions.map(d => d.session_id));
        const totalSessions = uniqueSessions.size;

        const sessionTotals = Array.from(uniqueSessions).map(sessionId => {
          const sessionDeductions = deductions.filter(d => d.session_id === sessionId);
          const total = sessionDeductions.reduce((sum, d) => sum + d.amount, 0);
          const firstDeduction = sessionDeductions[sessionDeductions.length - 1];
          return {
            amount: total,
            date: firstDeduction?.timestamp || ''
          };
        });

        const mostExpensive = sessionTotals.length > 0
          ? sessionTotals.reduce((max, session) =>
              session.amount > max.amount ? session : max
            )
          : null;

        const daysInMonth = Math.max(1, Math.ceil((now.getTime() - monthStart.getTime()) / (24 * 60 * 60 * 1000)));

        setStats({
          today: todayTotal,
          thisWeek: weekTotal,
          thisMonth: monthTotal,
          averagePerDay: monthTotal / daysInMonth,
          averagePerSession: totalSessions > 0 ? deductions.reduce((sum, d) => sum + d.amount, 0) / totalSessions : 0,
          totalSessions,
          mostExpensiveSession: mostExpensive
        });
      }
    } catch (error) {
      console.error('[CreditUsageAnalytics] Error loading stats:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
  };

  if (isLoading) {
    return (
      <div className="relative group">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl opacity-10 blur" />

        <div className="relative bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-xl border border-gray-700/50 p-8 shadow-xl">
          <div className="flex items-center justify-center gap-3">
            <div className="animate-spin h-6 w-6 border-2 border-blue-500/30 border-t-blue-500 rounded-full" />
            <span className="text-gray-400">Loading usage analytics...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative group">
      <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl opacity-10 group-hover:opacity-20 transition duration-300 blur" />

      <div className="relative bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-xl border border-gray-700/50 shadow-xl overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600/30 to-purple-600/30 px-6 py-4 border-b border-gray-700/50">
          <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-400" />
            Credit Usage Analytics
          </h2>
          <p className="text-gray-400 text-sm mt-1">Track your credit spending patterns</p>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="relative group/card">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500 to-green-500 rounded-lg opacity-0 group-hover/card:opacity-20 transition duration-300 blur" />

              <div className="relative bg-gradient-to-br from-gray-700/50 to-gray-800/50 backdrop-blur-sm rounded-lg p-4 border border-gray-700/50 hover:border-emerald-500/30 transition-all">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-emerald-500/10 rounded-lg">
                    <Calendar size={20} className="text-emerald-400" />
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Today</div>
                    <div className="text-2xl font-bold text-white">{stats.today.toFixed(0)}</div>
                  </div>
                </div>
                <p className="text-xs text-gray-400">Credits spent today</p>
              </div>
            </div>

            <div className="relative group/card">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-lg opacity-0 group-hover/card:opacity-20 transition duration-300 blur" />

              <div className="relative bg-gradient-to-br from-gray-700/50 to-gray-800/50 backdrop-blur-sm rounded-lg p-4 border border-gray-700/50 hover:border-blue-500/30 transition-all">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-blue-500/10 rounded-lg">
                    <TrendingUp size={20} className="text-blue-400" />
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">This Week</div>
                    <div className="text-2xl font-bold text-white">{stats.thisWeek.toFixed(0)}</div>
                  </div>
                </div>
                <p className="text-xs text-gray-400">Last 7 days</p>
              </div>
            </div>

            <div className="relative group/card">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg opacity-0 group-hover/card:opacity-20 transition duration-300 blur" />

              <div className="relative bg-gradient-to-br from-gray-700/50 to-gray-800/50 backdrop-blur-sm rounded-lg p-4 border border-gray-700/50 hover:border-purple-500/30 transition-all">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-purple-500/10 rounded-lg">
                    <Activity size={20} className="text-purple-400" />
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">This Month</div>
                    <div className="text-2xl font-bold text-white">{stats.thisMonth.toFixed(0)}</div>
                  </div>
                </div>
                <p className="text-xs text-gray-400">Current month total</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gradient-to-br from-gray-700/30 to-gray-800/30 backdrop-blur-sm rounded-lg p-4 border border-gray-700/50">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <TrendingDown size={16} className="text-yellow-400" />
                  Average per Day
                </h3>
              </div>
              <div className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-yellow-400 to-orange-400">
                {stats.averagePerDay.toFixed(1)}
              </div>
              <p className="text-xs text-gray-400 mt-1">Credits per day this month</p>
            </div>

            <div className="bg-gradient-to-br from-gray-700/30 to-gray-800/30 backdrop-blur-sm rounded-lg p-4 border border-gray-700/50">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <DollarSign size={16} className="text-green-400" />
                  Average per Session
                </h3>
              </div>
              <div className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-green-400 to-emerald-400">
                {stats.averagePerSession.toFixed(1)}
              </div>
              <p className="text-xs text-gray-400 mt-1">Across {stats.totalSessions} sessions</p>
            </div>
          </div>

          {stats.mostExpensiveSession && (
            <div className="bg-gradient-to-r from-red-900/30 to-orange-900/30 backdrop-blur-sm border border-red-500/30 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-2">
                <TrendingUp size={16} className="text-red-400" />
                Highest Session Cost
              </h3>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold text-red-400">
                    {stats.mostExpensiveSession.amount.toFixed(0)} credits
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {formatDate(stats.mostExpensiveSession.date)}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-blue-400 mb-2">Usage Insights</h3>
            <ul className="space-y-2 text-sm text-gray-300">
              {stats.averagePerDay < 20 && (
                <li className="flex items-start gap-2">
                  <span className="text-green-400 mt-1">•</span>
                  <span>Your daily usage is low - you're being conservative with credits</span>
                </li>
              )}
              {stats.averagePerDay >= 20 && stats.averagePerDay < 50 && (
                <li className="flex items-start gap-2">
                  <span className="text-blue-400 mt-1">•</span>
                  <span>Moderate daily usage - you're actively trading</span>
                </li>
              )}
              {stats.averagePerDay >= 50 && (
                <li className="flex items-start gap-2">
                  <span className="text-yellow-400 mt-1">•</span>
                  <span>High daily usage - consider upgrading to a subscription package for better value</span>
                </li>
              )}
              {stats.totalSessions > 0 && (
                <li className="flex items-start gap-2">
                  <span className="text-blue-400 mt-1">•</span>
                  <span>You've completed {stats.totalSessions} trading sessions</span>
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
