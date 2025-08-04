import React, { useState } from 'react';
import { 
  BarChart3, TrendingUp, TrendingDown, Target, Activity, 
  Calendar, ChevronDown, ChevronUp, RefreshCw
} from 'lucide-react';
import { useTradingKPIs } from '../hooks/useAPI';

interface TradingKPIsProps {
  className?: string;
}

export const TradingKPIs: React.FC<TradingKPIsProps> = ({ className = "" }) => {
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

  const profitableTrades = kpis?.winningTrades || 0;
  const losingTrades = kpis?.losingTrades || 0;
  const totalTrades = kpis?.totalTrades || 0;

  return (
    <div className={`glass-card ${className}`}>
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold text-white flex items-center space-x-3">
            <BarChart3 className="h-5 w-5 text-emerald-400 flex-shrink-0" />
            <span>AI Performance</span>
            {isLoading && <RefreshCw className="h-5 w-5 text-emerald-400 animate-spin" />}
          </h3>
          <div className="flex items-center space-x-4">
            <div className="text-sm text-white/60 font-medium">
              {totalTrades} total trades
            </div>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center space-x-2 text-emerald-400 hover:text-emerald-300 transition-all duration-200 text-sm glass-button px-4 py-2"
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

      <div className="p-6">
        {/* Summary Stats - Always visible */}
        <div className="grid grid-cols-3 gap-6 mb-8 p-6 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10">
          <div className="text-center">
            <div className="text-3xl font-bold text-green-400">{profitableTrades}</div>
            <div className="text-sm text-white/60 font-semibold uppercase tracking-wide">Winning Trades</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-red-400">{losingTrades}</div>
            <div className="text-sm text-white/60 font-semibold uppercase tracking-wide">Losing Trades</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-emerald-400">{totalTrades}</div>
            <div className="text-sm text-white/60 font-semibold uppercase tracking-wide">Total Trades</div>
          </div>
        </div>

        {/* Demo Data Notice */}
        <div className="p-6 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl">
          <div className="flex items-start space-x-4">
            <BarChart3 className="h-5 w-5 text-emerald-400 mt-0.5 flex-shrink-0" />
            <div>
              <h4 className="text-emerald-300 font-bold text-lg mb-3">Demo Trading Performance</h4>
              <div className="space-y-2 text-emerald-200 font-medium">
                <p>• Demo account showing {(kpis?.winRate || 0).toFixed(1)}% win rate with AI trading strategies</p>
                <p>• Risk-reward ratio of {(kpis?.averageRRR || 0).toFixed(1)}:1 demonstrates strong profit potential</p>
                <p>• Maximum drawdown of {(kpis?.maxDrawdown || 0).toFixed(1)}% shows excellent capital protection</p>
                <p>• Total P&L of ${(kpis?.totalPnL || 0).toFixed(2)} from {totalTrades} demo trades</p>
                <p>• AI follows all 10 Immutable Laws for consistent performance</p>
              </div>
            </div>
          </div>
        </div>

        {/* Detailed KPIs - Only show when expanded */}
        {isExpanded && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-8">
              {kpiItems.map((kpi) => (
                <div
                  key={kpi.id}
                  className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10 hover:border-white/20 transition-all duration-200"
                >
                  <div className="flex flex-col space-y-4">
                    <div className="flex items-center space-x-3">
                      <kpi.icon className="h-5 w-5 text-blue-400 flex-shrink-0" />
                      <h4 className="text-white font-bold truncate">
                        {kpi.label}
                      </h4>
                    </div>
                    
                    <div className={`text-3xl font-bold ${getPerformanceColor(kpi.rawValue, kpi.type)} text-center`}>
                      {kpi.value}
                    </div>
                    
                    <div className="w-full bg-white/10 rounded-full h-3">
                      <div
                        className={`h-3 rounded-full transition-all duration-500 ${getProgressBarColor(kpi.rawValue, kpi.type)}`}
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
                      <p className="text-sm text-white/50 flex-1 font-medium">
                        {kpi.description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Time Period Selector */}
            <div className="mt-6 flex items-center justify-between">
              <div className="flex items-center space-x-2 text-sm text-white/60 font-medium">
                <Calendar className="h-4 w-4 flex-shrink-0" />
                <span>Demo data from {new Date().toLocaleDateString()}</span>
              </div>
              <div className="flex items-center space-x-2">
                <button 
                  onClick={refetch}
                  disabled={isLoading}
                  className="flex items-center space-x-2 px-4 py-2 text-sm bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-all duration-200 disabled:opacity-50 font-medium"
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
          <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-2xl">
            <p className="text-red-400 font-medium">Error loading KPIs: {error}</p>
            <button 
              onClick={refetch}
              className="mt-3 text-sm text-red-300 hover:text-red-200 underline font-medium"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
};