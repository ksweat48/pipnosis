import React, { useState, useEffect } from 'react';
import { TrendingUp, Award, Target, BarChart3, RefreshCw, Calendar } from 'lucide-react';
import { shadowTradingEngine } from '../strategies/core/shadowTradingEngine';
import { strategyService } from '../strategies';
import { useAuth } from '../hooks/useAuth';

interface PerformanceData {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnL: number;
  avgPnL: number;
  profitFactor: number;
  bestTrade: number;
  worstTrade: number;
}

export function StrategyPerformanceWidget() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [performance, setPerformance] = useState<PerformanceData>({
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    totalPnL: 0,
    avgPnL: 0,
    profitFactor: 0,
    bestTrade: 0,
    worstTrade: 0
  });
  const [demoPerformance, setDemoPerformance] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      loadPerformance();
    }
  }, [user, period]);

  const loadPerformance = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const [metrics, demoStats] = await Promise.all([
        strategyService.getPerformanceMetrics(user.id, period),
        shadowTradingEngine.getTradePerformance(user.id, getDaysForPeriod(period))
      ]);

      if (metrics) {
        setPerformance({
          totalTrades: metrics.totalTrades,
          winningTrades: metrics.winningTrades,
          losingTrades: metrics.losingTrades,
          winRate: metrics.winRate,
          totalPnL: metrics.totalPnL,
          avgPnL: (metrics.averageWin + metrics.averageLoss) / 2,
          profitFactor: metrics.profitFactor,
          bestTrade: 0,
          worstTrade: 0
        });
      }

      if (demoStats) {
        setDemoPerformance(demoStats);
      }
    } catch (error) {
      console.error('Error loading performance:', error);
    } finally {
      setLoading(false);
    }
  };

  const getDaysForPeriod = (period: string) => {
    switch (period) {
      case 'daily': return 1;
      case 'weekly': return 7;
      case 'monthly': return 30;
      default: return 7;
    }
  };

  const getWinRateColor = (winRate: number) => {
    if (winRate >= 70) return 'text-green-600';
    if (winRate >= 50) return 'text-blue-600';
    return 'text-yellow-600';
  };

  const getPnLColor = (pnl: number) => {
    if (pnl > 0) return 'text-green-600';
    if (pnl < 0) return 'text-red-600';
    return 'text-gray-600';
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-6 bg-gradient-to-r from-blue-50 to-purple-50 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Award className="w-6 h-6 text-blue-600" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">AI Strategy Performance</h3>
              <p className="text-sm text-gray-600">Fx Flow Scalper v2.0 Analytics</p>
            </div>
          </div>
          <button
            onClick={loadPerformance}
            disabled={loading}
            className="p-2 hover:bg-white/50 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-5 h-5 text-gray-600 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="flex gap-2">
          {(['daily', 'weekly', 'monthly'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                period === p
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-100'
              }`}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-5 h-5 text-blue-600" />
              <p className="text-sm font-medium text-blue-900">Win Rate</p>
            </div>
            <p className={`text-3xl font-bold ${getWinRateColor(performance.winRate)}`}>
              {performance.winRate.toFixed(1)}%
            </p>
            <p className="text-xs text-gray-600 mt-1">
              {performance.winningTrades}W / {performance.losingTrades}L
            </p>
          </div>

          <div className="p-4 bg-green-50 rounded-lg border border-green-200">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-5 h-5 text-green-600" />
              <p className="text-sm font-medium text-green-900">Total P&L</p>
            </div>
            <p className={`text-3xl font-bold ${getPnLColor(performance.totalPnL)}`}>
              ${performance.totalPnL.toFixed(2)}
            </p>
            <p className="text-xs text-gray-600 mt-1">
              Avg: ${performance.avgPnL.toFixed(2)}
            </p>
          </div>

          <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="w-5 h-5 text-purple-600" />
              <p className="text-sm font-medium text-purple-900">Profit Factor</p>
            </div>
            <p className="text-3xl font-bold text-purple-900">
              {performance.profitFactor.toFixed(2)}
            </p>
            <p className="text-xs text-gray-600 mt-1">
              {performance.profitFactor >= 2 ? 'Excellent' : performance.profitFactor >= 1.5 ? 'Good' : 'Improving'}
            </p>
          </div>

          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-5 h-5 text-gray-600" />
              <p className="text-sm font-medium text-gray-900">Total Trades</p>
            </div>
            <p className="text-3xl font-bold text-gray-900">
              {performance.totalTrades}
            </p>
            <p className="text-xs text-gray-600 mt-1">
              {period.charAt(0).toUpperCase() + period.slice(1)} period
            </p>
          </div>
        </div>

        {demoPerformance && (
          <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border-2 border-blue-200">
            <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Award className="w-5 h-5 text-blue-600" />
              AI Demo Trading Performance
            </h4>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-600 mb-1">Win Rate</p>
                <p className={`text-lg font-bold ${getWinRateColor(demoPerformance.winRate)}`}>
                  {demoPerformance.winRate.toFixed(1)}%
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-600 mb-1">Total P&L</p>
                <p className={`text-lg font-bold ${getPnLColor(demoPerformance.totalPnL)}`}>
                  ${demoPerformance.totalPnL.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-600 mb-1">Trades</p>
                <p className="text-lg font-bold text-gray-900">
                  {demoPerformance.totalTrades}
                </p>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-blue-200">
              <p className="text-xs text-blue-700">
                AI parallel demo trades track recommendation accuracy and build confidence through transparent performance.
              </p>
            </div>
          </div>
        )}

        {performance.totalTrades === 0 && !loading && (
          <div className="text-center py-8">
            <BarChart3 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No trades recorded for this period</p>
            <p className="text-gray-400 text-xs mt-1">Execute some signals to see performance metrics</p>
          </div>
        )}
      </div>
    </div>
  );
}
