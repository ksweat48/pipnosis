import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { TrendingUp, TrendingDown, AlertCircle, Calendar } from 'lucide-react';

interface DailyProfit {
  date: string;
  closed_trades_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  user_count_with_trades: number;
  total_closed_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  prev_day_closed_pnl: number | null;
  prev_day_pnl_change: number | null;
}

interface LifetimeStats {
  lifetime_closed_pnl: number;
  lifetime_unrealized_pnl: number;
  lifetime_total_pnl: number;
  total_closed_trades: number;
  total_users_ever_traded: number;
  total_winning_trades: number;
  total_losing_trades: number;
  win_rate: number;
  average_pnl_per_trade: number;
  best_day_pnl: number;
  worst_day_pnl: number;
  best_day_date: string;
  worst_day_date: string;
}

interface ComparisonMetrics {
  todays_closed_pnl: number;
  todays_unrealized_pnl: number;
  todays_total_pnl: number;
  yesterday_closed_pnl: number;
  yesterday_total_pnl: number;
  day_over_day_change: number;
  day_over_day_change_percent: number;
  week_total_closed_pnl: number;
  week_total_pnl: number;
  prev_week_closed_pnl: number;
  week_over_week_change: number;
  week_over_week_change_percent: number;
}

export function PlatformProfitsCard() {
  const [dailyProfits, setDailyProfits] = useState<DailyProfit[]>([]);
  const [lifetimeStats, setLifetimeStats] = useState<LifetimeStats | null>(null);
  const [comparison, setComparison] = useState<ComparisonMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadProfitData();
    // Refresh every 30 seconds for real-time updates
    const interval = setInterval(loadProfitData, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadProfitData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load daily profits for last 7 days
      const { data: dailyData, error: dailyError } = await supabase.rpc('get_platform_daily_profits', {
        p_days_back: 7
      });
      if (dailyError) throw dailyError;
      setDailyProfits(dailyData || []);

      // Load lifetime stats
      const { data: lifetimeData, error: lifetimeError } = await supabase.rpc('get_platform_lifetime_profits');
      if (lifetimeError) throw lifetimeError;
      if (lifetimeData && lifetimeData.length > 0) {
        setLifetimeStats(lifetimeData[0]);
      }

      // Load comparison metrics
      const { data: comparisonData, error: comparisonError } = await supabase.rpc('get_platform_profit_comparison');
      if (comparisonError) throw comparisonError;
      if (comparisonData && comparisonData.length > 0) {
        setComparison(comparisonData[0]);
      }
    } catch (err) {
      console.error('Error loading profit data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load profit data');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  const getChangeColor = (value: number) => {
    if (value > 0) return 'text-green-400';
    if (value < 0) return 'text-red-400';
    return 'text-gray-400';
  };

  const getChangeBgColor = (value: number) => {
    if (value > 0) return 'bg-green-500/10 border-green-500/20';
    if (value < 0) return 'bg-red-500/10 border-red-500/20';
    return 'bg-gray-500/10 border-gray-500/20';
  };

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-emerald-900/30 via-teal-900/20 to-cyan-900/30 border-2 border-emerald-500/30 rounded-xl p-4 sm:p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-700 rounded w-1/3"></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="h-24 bg-gray-700 rounded"></div>
            <div className="h-24 bg-gray-700 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gradient-to-br from-red-900/30 to-orange-900/30 border-2 border-red-500/30 rounded-xl p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <AlertCircle className="w-6 h-6 text-red-400" />
          <div>
            <h3 className="font-bold text-white">Error Loading Profits</h3>
            <p className="text-sm text-red-200">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const today = dailyProfits[0];

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Main Profits Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-4">
        {/* Today's Closed Trades P&L */}
        <div className={`bg-gray-900/60 backdrop-blur-sm border rounded-lg p-4 transition-all ${
          today?.closed_trades_pnl >= 0
            ? 'border-green-500/20 hover:border-green-500/40'
            : 'border-red-500/20 hover:border-red-500/40'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-400 text-sm font-medium">Today's Closed P&L</span>
            <TrendingUp className={`w-5 h-5 ${
              today?.closed_trades_pnl >= 0 ? 'text-green-400' : 'text-red-400'
            }`} />
          </div>
          <div className={`text-2xl sm:text-3xl font-bold mb-2 ${
            today?.closed_trades_pnl >= 0 ? 'text-green-400' : 'text-red-400'
          }`}>
            {today ? formatCurrency(today.closed_trades_pnl) : '$0.00'}
          </div>
          <div className="text-xs text-gray-500">
            {today?.total_closed_trades || 0} trades ({today?.winning_trades || 0}W / {today?.losing_trades || 0}L)
          </div>
        </div>

        {/* Today's Unrealized P&L */}
        <div className={`bg-gray-900/60 backdrop-blur-sm border rounded-lg p-4 transition-all ${
          today?.unrealized_pnl >= 0
            ? 'border-yellow-500/20 hover:border-yellow-500/40'
            : 'border-orange-500/20 hover:border-orange-500/40'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-400 text-sm font-medium">Today's Unrealized P&L</span>
            <Calendar className={`w-5 h-5 ${
              today?.unrealized_pnl >= 0 ? 'text-yellow-400' : 'text-orange-400'
            }`} />
          </div>
          <div className={`text-2xl sm:text-3xl font-bold mb-2 ${
            today?.unrealized_pnl >= 0 ? 'text-yellow-400' : 'text-orange-400'
          }`}>
            {today ? formatCurrency(today.unrealized_pnl) : '$0.00'}
          </div>
          <div className="text-xs text-gray-500">
            {today?.user_count_with_trades || 0} active traders
          </div>
        </div>
      </div>

      {/* Comparisons Row */}
      {comparison && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-4">
          {/* Day-over-Day Change */}
          <div className={`bg-gray-900/60 backdrop-blur-sm border rounded-lg p-4 ${getChangeBgColor(comparison.day_over_day_change)}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-300 text-sm font-medium">vs Yesterday</span>
              {comparison.day_over_day_change >= 0 ? (
                <TrendingUp className="w-4 h-4 text-green-400" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-400" />
              )}
            </div>
            <div className={`text-lg sm:text-xl font-bold ${getChangeColor(comparison.day_over_day_change)}`}>
              {comparison.day_over_day_change >= 0 ? '+' : ''}{formatCurrency(comparison.day_over_day_change)}
            </div>
            <div className={`text-xs mt-1 ${getChangeColor(comparison.day_over_day_change_percent || 0)}`}>
              {comparison.day_over_day_change_percent !== null ? (
                `${comparison.day_over_day_change_percent >= 0 ? '+' : ''}${comparison.day_over_day_change_percent.toFixed(1)}%`
              ) : '-'}
            </div>
          </div>

          {/* Week-over-Week Change */}
          <div className={`bg-gray-900/60 backdrop-blur-sm border rounded-lg p-4 ${getChangeBgColor(comparison.week_over_week_change)}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-300 text-sm font-medium">vs Last Week</span>
              {comparison.week_over_week_change >= 0 ? (
                <TrendingUp className="w-4 h-4 text-green-400" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-400" />
              )}
            </div>
            <div className={`text-lg sm:text-xl font-bold ${getChangeColor(comparison.week_over_week_change)}`}>
              {comparison.week_over_week_change >= 0 ? '+' : ''}{formatCurrency(comparison.week_over_week_change)}
            </div>
            <div className={`text-xs mt-1 ${getChangeColor(comparison.week_over_week_change_percent || 0)}`}>
              {comparison.week_over_week_change_percent !== null ? (
                `${comparison.week_over_week_change_percent >= 0 ? '+' : ''}${comparison.week_over_week_change_percent.toFixed(1)}%`
              ) : '-'}
            </div>
          </div>
        </div>
      )}

      {/* Last 7 Days Breakdown */}
      <div className="bg-gray-900/60 backdrop-blur-sm border border-gray-700/50 rounded-lg p-4 sm:p-6">
        <h4 className="font-bold text-white mb-4 flex items-center gap-2">
          <Calendar className="w-5 h-5 text-emerald-400" />
          Last 7 Days Breakdown
        </h4>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {dailyProfits.map((day) => (
            <div key={day.date} className="flex items-center justify-between p-2 hover:bg-gray-800/50 rounded transition-colors">
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-300">
                  {new Date(day.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </div>
                <div className="text-xs text-gray-500">
                  {day.winning_trades}W / {day.losing_trades}L • {day.total_closed_trades} trades
                </div>
              </div>
              <div className="text-right">
                <div className={`text-sm font-bold ${
                  day.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                  {day.total_pnl >= 0 ? '+' : ''}{formatCurrency(day.total_pnl)}
                </div>
                <div className="text-xs text-gray-500">
                  C: {day.closed_trades_pnl >= 0 ? '+' : ''}{formatCurrency(day.closed_trades_pnl)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Lifetime Statistics */}
      {lifetimeStats && (
        <div className="bg-gray-900/60 backdrop-blur-sm border border-gray-700/50 rounded-lg p-4 sm:p-6">
          <h4 className="font-bold text-white mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-cyan-400" />
            Lifetime Statistics
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
            {/* Lifetime P&L */}
            <div>
              <div className="text-xs text-gray-400 mb-1">Lifetime P&L</div>
              <div className={`font-bold text-lg ${
                lifetimeStats.lifetime_total_pnl >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {lifetimeStats.lifetime_total_pnl >= 0 ? '+' : ''}{formatCurrency(lifetimeStats.lifetime_total_pnl)}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {lifetimeStats.total_winning_trades}W / {lifetimeStats.total_losing_trades}L
              </div>
            </div>

            {/* Win Rate */}
            <div>
              <div className="text-xs text-gray-400 mb-1">Win Rate</div>
              <div className="font-bold text-lg text-purple-400">
                {lifetimeStats.win_rate.toFixed(1)}%
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {lifetimeStats.total_closed_trades} trades
              </div>
            </div>

            {/* Average P&L */}
            <div>
              <div className="text-xs text-gray-400 mb-1">Avg P&L/Trade</div>
              <div className={`font-bold text-lg ${
                lifetimeStats.average_pnl_per_trade >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {lifetimeStats.average_pnl_per_trade >= 0 ? '+' : ''}{formatCurrency(lifetimeStats.average_pnl_per_trade)}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">Per trade</div>
            </div>

            {/* Best Day */}
            <div>
              <div className="text-xs text-gray-400 mb-1">Best Day</div>
              <div className="font-bold text-lg text-green-400">
                {formatCurrency(lifetimeStats.best_day_pnl)}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {new Date(lifetimeStats.best_day_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
            </div>

            {/* Worst Day */}
            <div>
              <div className="text-xs text-gray-400 mb-1">Worst Day</div>
              <div className="font-bold text-lg text-red-400">
                {formatCurrency(lifetimeStats.worst_day_pnl)}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {new Date(lifetimeStats.worst_day_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
            </div>

            {/* Total Users */}
            <div>
              <div className="text-xs text-gray-400 mb-1">Total Users Traded</div>
              <div className="font-bold text-lg text-blue-400">
                {lifetimeStats.total_users_ever_traded}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">Platform wide</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
