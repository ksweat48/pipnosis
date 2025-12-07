import React, { useState, useEffect } from 'react';
import { NavigationMenu } from '@/components/NavigationMenu';
import { TradeHistory } from '@/components/TradeHistory';
import { useAuth } from '@/hooks/useAuth';
import { useUserBalance } from '@/hooks/useUserBalance';
import { supabase } from '@/lib/supabase';
import { pageContext } from '@/services/page-context';
import { TrendingUp, TrendingDown, DollarSign, Target, Award, AlertTriangle, Clock, Calendar, BarChart3, PieChart } from 'lucide-react';

interface TradeStatistics {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_profit: number;
  total_loss: number;
  net_profit: number;
  average_win: number;
  average_loss: number;
  best_trade: number;
  worst_trade: number;
  profit_factor: number;
}

interface SymbolPerformance {
  symbol: string;
  trades: number;
  wins: number;
  losses: number;
  net_pnl: number;
  win_rate: number;
}

export function AnalysisPage() {
  const { user } = useAuth();
  const { balance, totalPnL } = useUserBalance(user?.id || null);
  const [statistics, setStatistics] = useState<TradeStatistics | null>(null);
  const [symbolPerformance, setSymbolPerformance] = useState<SymbolPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [timePeriod, setTimePeriod] = useState<'today' | 'week' | 'month' | 'all'>('all');

  // Set page context on mount
  useEffect(() => {
    pageContext.setPage('analysis');
    return () => pageContext.setPage('other');
  }, []);

  useEffect(() => {
    if (user) {
      fetchAnalytics();
    }
  }, [user, timePeriod]);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);

      const { data: statsData, error: statsError } = await supabase
        .rpc('get_trade_statistics', { p_user_id: user?.id });

      if (statsError) throw statsError;
      if (statsData && statsData.length > 0) {
        const stats = statsData[0];
        const profitFactor = stats.total_loss !== 0
          ? Math.abs(stats.total_profit / stats.total_loss)
          : stats.total_profit > 0 ? 999 : 0;

        setStatistics({
          ...stats,
          profit_factor: profitFactor
        });
      }

      const { data: tradesData, error: tradesError } = await supabase
        .from('trade_history')
        .select('symbol, profit_loss')
        .eq('user_id', user?.id);

      if (tradesError) throw tradesError;

      const symbolStats = tradesData.reduce((acc: any, trade) => {
        if (!acc[trade.symbol]) {
          acc[trade.symbol] = {
            symbol: trade.symbol,
            trades: 0,
            wins: 0,
            losses: 0,
            net_pnl: 0
          };
        }

        acc[trade.symbol].trades += 1;
        acc[trade.symbol].net_pnl += trade.profit_loss;

        if (trade.profit_loss > 0) {
          acc[trade.symbol].wins += 1;
        } else {
          acc[trade.symbol].losses += 1;
        }

        return acc;
      }, {});

      const symbolArray: SymbolPerformance[] = Object.values(symbolStats).map((s: any) => ({
        ...s,
        win_rate: (s.wins / s.trades) * 100
      }));

      symbolArray.sort((a, b) => b.net_pnl - a.net_pnl);

      setSymbolPerformance(symbolArray);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="app-viewport bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950">
        <NavigationMenu />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <div className="text-center text-white">
            <div className="animate-spin h-12 w-12 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full mx-auto mb-4"></div>
            <p>Loading analytics...</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-viewport bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950">
      <NavigationMenu />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-12">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-xl sm:text-3xl font-bold text-white mb-1">Performance Analysis</h2>
            <p className="text-gray-400 text-sm sm:text-base">Comprehensive analytics of your trading performance</p>
          </div>

          <select
            value={timePeriod}
            onChange={(e) => setTimePeriod(e.target.value as any)}
            className="bg-gray-800 text-white px-3 sm:px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm sm:text-base"
          >
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="all">All Time</option>
          </select>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6 mb-6 sm:mb-8">
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 sm:p-6">
            <div className="flex items-center justify-between mb-1 sm:mb-2">
              <div className="text-gray-400 text-xs sm:text-sm truncate">Account Balance</div>
              <DollarSign className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500" />
            </div>
            <div className="text-white text-xl sm:text-3xl font-bold">${balance.toFixed(2)}</div>
            <div className={`text-xs sm:text-sm mt-1 sm:mt-2 ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)} P&L
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 sm:p-6">
            <div className="flex items-center justify-between mb-1 sm:mb-2">
              <div className="text-gray-400 text-xs sm:text-sm truncate">Total Trades</div>
              <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500" />
            </div>
            <div className="text-white text-xl sm:text-3xl font-bold">{statistics?.total_trades || 0}</div>
            <div className="text-xs sm:text-sm text-gray-400 mt-1 sm:mt-2 truncate">
              {statistics?.winning_trades || 0}W, {statistics?.losing_trades || 0}L
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 sm:p-6">
            <div className="flex items-center justify-between mb-1 sm:mb-2">
              <div className="text-gray-400 text-xs sm:text-sm truncate">Win Rate</div>
              <Target className="w-4 h-4 sm:w-5 sm:h-5 text-purple-500" />
            </div>
            <div className={`text-xl sm:text-3xl font-bold ${(statistics?.win_rate || 0) >= 50 ? 'text-green-400' : 'text-red-400'}`}>
              {statistics?.win_rate?.toFixed(1) || 0}%
            </div>
            <div className="text-xs sm:text-sm text-gray-400 mt-1 sm:mt-2 truncate">
              {(statistics?.win_rate || 0) >= 50 ? 'Above avg' : 'Below avg'}
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 sm:p-6">
            <div className="flex items-center justify-between mb-1 sm:mb-2">
              <div className="text-gray-400 text-xs sm:text-sm truncate">Profit Factor</div>
              <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-500" />
            </div>
            <div className="text-white text-xl sm:text-3xl font-bold">
              {statistics?.profit_factor ? statistics.profit_factor.toFixed(2) : '0.00'}
            </div>
            <div className="text-xs sm:text-sm text-gray-400 mt-1 sm:mt-2 truncate">
              {(statistics?.profit_factor || 0) >= 1.5 ? 'Excellent' : (statistics?.profit_factor || 0) >= 1 ? 'Good' : 'Poor'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6 sm:mb-8">
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 sm:p-6">
            <h3 className="text-base sm:text-xl font-bold text-white mb-3 sm:mb-4 flex items-center gap-2">
              <Award className="w-4 h-4 sm:w-5 sm:h-5 text-green-500" />
              Best & Worst Trades
            </h3>

            <div className="space-y-3 sm:space-y-4">
              <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-3 sm:p-4">
                <div className="text-green-400 text-xs sm:text-sm mb-1">Best Trade</div>
                <div className="text-white text-xl sm:text-2xl font-bold">
                  +${statistics?.best_trade?.toFixed(2) || '0.00'}
                </div>
              </div>

              <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3 sm:p-4">
                <div className="text-red-400 text-xs sm:text-sm mb-1">Worst Trade</div>
                <div className="text-white text-xl sm:text-2xl font-bold">
                  ${statistics?.worst_trade?.toFixed(2) || '0.00'}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:gap-4 mt-3 sm:mt-4">
                <div>
                  <div className="text-gray-400 text-xs sm:text-sm mb-1">Avg Win</div>
                  <div className="text-green-400 text-base sm:text-lg font-bold">
                    +${statistics?.average_win?.toFixed(2) || '0.00'}
                  </div>
                </div>
                <div>
                  <div className="text-gray-400 text-xs sm:text-sm mb-1">Avg Loss</div>
                  <div className="text-red-400 text-base sm:text-lg font-bold">
                    ${statistics?.average_loss?.toFixed(2) || '0.00'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 sm:p-6">
            <h3 className="text-base sm:text-xl font-bold text-white mb-3 sm:mb-4 flex items-center gap-2">
              <PieChart className="w-4 h-4 sm:w-5 sm:h-5 text-purple-500" />
              Performance by Symbol
            </h3>

            {symbolPerformance.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">
                <p>No trading data available yet</p>
              </div>
            ) : (
              <div className="space-y-2 sm:space-y-3 max-h-80 overflow-y-auto">
                {symbolPerformance.map((symbol) => (
                  <div key={symbol.symbol} className="bg-gray-800 border border-gray-700 rounded-lg p-3 sm:p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-bold text-sm sm:text-base">{symbol.symbol}</span>
                        <span className="text-gray-400 text-xs sm:text-sm">{symbol.trades} trades</span>
                      </div>
                      <div className={`text-base sm:text-lg font-bold ${symbol.net_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {symbol.net_pnl >= 0 ? '+' : ''}${symbol.net_pnl.toFixed(2)}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs sm:text-sm">
                      <div className="flex items-center gap-3 sm:gap-4">
                        <div className="flex items-center gap-1">
                          <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4 text-green-400" />
                          <span className="text-gray-400">{symbol.wins}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <TrendingDown className="w-3 h-3 sm:w-4 sm:h-4 text-red-400" />
                          <span className="text-gray-400">{symbol.losses}</span>
                        </div>
                      </div>
                      <div className={`font-medium ${symbol.win_rate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                        {symbol.win_rate.toFixed(1)}%
                      </div>
                    </div>

                    <div className="mt-2 bg-gray-900 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full ${symbol.win_rate >= 50 ? 'bg-green-500' : 'bg-red-500'}`}
                        style={{ width: `${symbol.win_rate}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 sm:p-6">
          <h3 className="text-base sm:text-xl font-bold text-white mb-3 sm:mb-4 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-500" />
            Trading Insights
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            {statistics && statistics.win_rate < 50 && (
              <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-3 sm:p-4">
                <div className="text-yellow-400 font-semibold text-sm sm:text-base mb-1 sm:mb-2">Improve Win Rate</div>
                <p className="text-gray-300 text-xs sm:text-sm">
                  Your win rate is below 50%. Consider refining your entry strategy and risk management.
                </p>
              </div>
            )}

            {statistics && statistics.profit_factor < 1 && (
              <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3 sm:p-4">
                <div className="text-red-400 font-semibold text-sm sm:text-base mb-1 sm:mb-2">Negative Profit Factor</div>
                <p className="text-gray-300 text-xs sm:text-sm">
                  Your losses exceed your wins. Review your trading strategy and cut losses earlier.
                </p>
              </div>
            )}

            {statistics && Math.abs(statistics.average_loss) > statistics.average_win && (
              <div className="bg-orange-900/20 border border-orange-700/50 rounded-lg p-3 sm:p-4">
                <div className="text-orange-400 font-semibold text-sm sm:text-base mb-1 sm:mb-2">Risk/Reward Imbalance</div>
                <p className="text-gray-300 text-xs sm:text-sm">
                  Your average loss is larger than your average win. Aim for better risk-reward ratios.
                </p>
              </div>
            )}

            {statistics && statistics.profit_factor >= 1.5 && statistics.win_rate >= 55 && (
              <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-3 sm:p-4">
                <div className="text-green-400 font-semibold text-sm sm:text-base mb-1 sm:mb-2">Strong Performance</div>
                <p className="text-gray-300 text-xs sm:text-sm">
                  Great work! Your profit factor and win rate indicate a solid trading strategy.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-8">
          <TradeHistory />
        </div>
      </main>
    </div>
  );
}
