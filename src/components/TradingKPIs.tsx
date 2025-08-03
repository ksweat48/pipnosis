import React, { useState, useEffect, useCallback } from 'react';
import { 
  BarChart3, TrendingUp, TrendingDown, Target, CheckCircle, Activity, 
  Calendar, ChevronDown, ChevronUp, RefreshCw
} from 'lucide-react';
import { useTradingKPIs } from '../hooks/useAPI';
import { useAuth } from '../contexts/AuthContext';

interface TradingKPIsProps {
  className?: string;
}

export const TradingKPIs: React.FC<TradingKPIsProps> = ({ className = "" }) => {
  const { user } = useAuth();
  const { kpis, isLoading, error, refetch } = useTradingKPIs();
  const [isExpanded, setIsExpanded] = useState(false);

  const getPerformanceColor = (value: number, type: 'percentage' | 'ratio' | 'drawdown' | 'return') => {
    if (type === 'drawdown') {
      if (value <= 5) return 'text-green-400';
      if (value <= 10) return 'text-yellow-400';
      return 'text-red-400';
    }
    
    if (type === 'return') {
      if (value > 0) return 'text-green-400';
      return 'text-red-400';
    }
    
    if (type === 'percentage') {
      if (value >= 70) return 'text-green-400';
      if (value >= 50) return 'text-yellow-400';
      return 'text-red-400';
    }
    
    if (type === 'ratio') {
      if (value >= 2.0) return 'text-green-400';
      if (value >= 1.5) return 'text-yellow-400';
      return 'text-red-400';
    }
    
    return 'text-slate-300';
  };

  const getProgressBarColor = (value: number, type: 'percentage' | 'ratio' | 'drawdown' | 'return') => {
    if (type === 'drawdown') {
      if (value <= 5) return 'bg-green-400';
      if (value <= 10) return 'bg-yellow-400';
      return 'bg-red-400';
    }
    
    if (type === 'return') {
      if (value > 0) return 'bg-green-400';
      return 'bg-red-400';
    }
    
    if (type === 'percentage') {
      if (value >= 70) return 'bg-green-400';
      if (value >= 50) return 'bg-yellow-400';
      return 'bg-red-400';
    }
    
    if (type === 'ratio') {
      if (value >= 2.0) return 'bg-green-400';
      if (value >= 1.5) return 'bg-yellow-400';
      return 'bg-red-400';
    }
    
    return 'bg-slate-400';
  };

  const kpiItems = [
    {
      id: 'winRate',
      label: 'Win Rate (%)',
      value: `${(kpis?.winRate || 0).toFixed(1)}%`,
      description: 'Success rate of trades',
      icon: Target,
      type: 'percentage' as const,
      rawValue: kpis?.winRate || 0
    },
    {
      id: 'averageRRR',
      label: 'Average RRR',
      value: `${(kpis?.averageRRR || 0).toFixed(1)}:1`,
      description: 'Risk-to-reward ratio',
      icon: BarChart3,
      type: 'ratio' as const,
      rawValue: kpis?.averageRRR || 0
    },
    {
      id: 'maxDrawdown',
      label: 'Drawdown (max)',
      value: `${(kpis?.maxDrawdown || 0).toFixed(1)}%`,
      description: 'Capital protection',
      icon: TrendingDown,
      type: 'drawdown' as const,
      rawValue: kpis?.maxDrawdown || 0
    },
    {
      id: 'totalPnL',
      label: 'Total P&L',
      value: `${(kpis?.totalPnL || 0) >= 0 ? '+' : ''}$${(kpis?.totalPnL || 0).toFixed(2)}`,
      description: 'All-time profit/loss',
      icon: TrendingUp,
      type: 'return' as const,
      rawValue: kpis?.totalPnL || 0
    }
  ];

  // Use Supabase data
  const profitableTrades = kpis?.winningTrades || 0;
  const losingTrades = kpis?.losingTrades || 0;
  const totalTrades = kpis?.totalTrades || 0;

  return (
    <div className={`bg-slate-800 rounded-xl border border-slate-700 ${className}`}>
      <div className="p-4 sm:p-6 border-b border-slate-700">
        <div className="flex flex-col space-y-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <h3 className="text-lg font-semibold text-white flex items-center space-x-2">
            <BarChart3 className="h-5 w-5 text-blue-400 flex-shrink-0" />
            <span>AI Performance</span>
            {isLoading && <RefreshCw className="h-4 w-4 text-blue-400 animate-spin" />}
          </h3>
          <div className="flex flex-col space-y-2 sm:flex-row sm:items-center sm:space-y-0 sm:space-x-4">
            <div className="text-sm text-slate-400">
              {totalTrades} total trades
            </div>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center justify-center space-x-1 text-blue-400 hover:text-blue-300 transition-colors text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded-lg"
            >
              <span>{isExpanded ? 'Show Less' : 'Show All'}</span>
              {isExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {/* Summary Stats - Always visible */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-6 p-3 sm:p-4 bg-slate-900 rounded-lg border border-slate-600">
          <div className="text-center">
            <div className="text-lg sm:text-2xl font-bold text-green-400">{profitableTrades}</div>
            <div className="text-xs text-slate-400">Winning Trades</div>
          </div>
          <div className="text-center">
            <div className="text-lg sm:text-2xl font-bold text-red-400">{losingTrades}</div>
            <div className="text-xs text-slate-400">Losing Trades</div>
          </div>
          <div className="text-center">
            <div className="text-lg sm:text-2xl font-bold text-blue-400">{totalTrades}</div>
            <div className="text-xs text-slate-400">Total Trades</div>
          </div>
        </div>

        {/* No Data State */}
        {totalTrades === 0 && !isExpanded && (
          <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <div className="flex items-start space-x-3">
              <BarChart3 className="h-5 w-5 text-blue-400 mt-0.5 flex-shrink-0" />
              <div>
                <h4 className="text-blue-300 font-medium mb-2">No Trading Data Yet</h4>
                <p className="text-blue-200 text-sm">
                  {user ? 
                    "You haven't executed any trades yet. Use the AI Prompt Console to generate and execute your first trading strategy." :
                    "Sign in to track your trading performance and see AI-powered analytics."}
                </p>
                {user && (
                  <p className="text-blue-200 text-sm mt-2">
                    Your demo balance: ${user.user_metadata?.account_balance?.toLocaleString() || '10,000'}
                  </p>
                )}
                <div className="mt-3 space-y-1 text-xs text-blue-200">
                    <p>• AI Trade Assistant will monitor your trades and provide real-time guidance</p>
                    <p>• Maximum 2 trades per session following Immutable Law #9 (Do Not Overtrade)</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Detailed KPIs - Only show when expanded */}
        {isExpanded && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {kpiItems.map((kpi) => (
                <div
                  key={kpi.id}
                  className="bg-slate-900 rounded-lg p-4 border border-slate-600 hover:border-slate-500 transition-colors"
                >
                  <div className="flex flex-col space-y-3">
                    <div className="flex items-center space-x-2">
                      <kpi.icon className="h-5 w-5 text-blue-400 flex-shrink-0" />
                      <h4 className="text-white font-medium text-sm truncate">
                        {kpi.label}
                      </h4>
                    </div>
                    
                    <div className={`text-xl sm:text-2xl font-bold ${getPerformanceColor(kpi.rawValue, kpi.type)} text-center`}>
                      {kpi.value}
                    </div>
                    
                    <div className="w-full bg-slate-700 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all duration-300 ${getProgressBarColor(kpi.rawValue, kpi.type)}`}
                        style={{
                          width: `${
                            kpi.type === 'drawdown'
                              ? Math.min((20 - kpi.rawValue) * 5, 100)
                              : kpi.type === 'ratio'
                              ? Math.min(kpi.rawValue * 33.33, 100)
                              : kpi.type === 'return'
                              ? Math.min(Math.abs(kpi.rawValue) * 5, 100)
                              : Math.min(kpi.rawValue, 100)
                          }%`
                        }}
                      ></div>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-slate-400 flex-1">
                        {kpi.description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Performance Insights */}
            <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <div className="flex items-start space-x-3">
                <BarChart3 className="h-5 w-5 text-blue-400 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-blue-300 font-medium mb-2">AI Performance Insights</h4>
                  {totalTrades > 0 ? (
                    <div className="space-y-1 text-sm text-blue-200">
                      <p>• Your {(kpis?.winRate || 0).toFixed(1)}% win rate is {(kpis?.winRate || 0) >= 70 ? 'excellent' : (kpis?.winRate || 0) >= 50 ? 'good' : 'needs improvement'} for AI trading</p>
                      <p>• Risk-reward ratio of 2.1:1 shows strong profit potential per trade</p>
                      <p>• 80.0% recovery rate indicates excellent AI adaptation after losses</p>
                      <p>• Monthly return of 8.5% is outstanding for automated trading</p>
                      <p>• AI Trade Assistant provides guidance every 5 minutes on active positions</p>
                    </div>
                  ) : (
                    <div className="space-y-1 text-sm text-blue-200">
                      <p>• Pipnosis AI targets a 70-80% win rate through careful trade selection</p>
                      <p>• Risk-reward ratios of 2:1 or higher are prioritized for long-term profitability</p>
                      <p>• The system adapts after losses to maintain consistent performance</p>
                      <p>• AI Trade Assistant monitors trades every 5 minutes following Immutable Law #10</p>
                      <p>• Session limits (max 2 trades/day) ensure disciplined trading per Immutable Law #9</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Time Period Selector */}
            <div className="mt-4 flex flex-col space-y-2 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
              <div className="flex items-center space-x-2 text-sm text-slate-400">
                <Calendar className="h-4 w-4 flex-shrink-0" />
                <span>Data from {new Date().toLocaleDateString()}</span>
              </div>
              <div className="flex items-center space-x-2">
                <button 
                  onClick={refetch}
                  disabled={isLoading}
                  className="flex items-center space-x-1 px-3 py-1 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
              </div>
            </div>
          </>
        )}

        {/* Error State */}
        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-red-400 text-sm">Error loading KPIs: {error}</p>
            <button 
              onClick={refetch}
              className="mt-2 text-xs text-red-300 hover:text-red-200 underline"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
};