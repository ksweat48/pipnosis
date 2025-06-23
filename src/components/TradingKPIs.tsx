import React, { useState } from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown, 
  Target, 
  Clock, 
  Shield, 
  Zap, 
  AlertTriangle,
  CheckCircle,
  Activity,
  Calendar,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

interface KPIData {
  winRate: number;
  averageRRR: number;
  maxDrawdown: number;
  avgDrawdown: number;
  monthlyReturn: number;
  tradeFrequency: number;
  avgTradeDuration: string;
  stopLossHitRatio: number;
  earlyExitRatio: number;
  tpHitRatio: number;
  recoveryAfterLoss: number;
  totalTrades: number;
  profitableTrades: number;
  losingTrades: number;
}

interface TradingKPIsProps {
  kpiData?: KPIData;
}

export const TradingKPIs: React.FC<TradingKPIsProps> = ({ kpiData }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Mock data for demonstration
  const defaultKPIData: KPIData = {
    winRate: 73.5,
    averageRRR: 2.4,
    maxDrawdown: 8.2,
    avgDrawdown: 3.1,
    monthlyReturn: 12.8,
    tradeFrequency: 4.2,
    avgTradeDuration: '2h 45m',
    stopLossHitRatio: 18.5,
    earlyExitRatio: 12.0,
    tpHitRatio: 69.5,
    recoveryAfterLoss: 85.0,
    totalTrades: 47,
    profitableTrades: 35,
    losingTrades: 12
  };

  const data = kpiData || defaultKPIData;

  const getPerformanceColor = (value: number, type: 'percentage' | 'ratio' | 'drawdown' | 'return') => {
    if (type === 'drawdown') {
      if (value <= 5) return 'text-green-400';
      if (value <= 10) return 'text-yellow-400';
      return 'text-red-400';
    }
    
    if (type === 'return') {
      // Monthly return should always be green if positive
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

  const getPerformanceIcon = (value: number, type: 'percentage' | 'ratio' | 'drawdown' | 'return') => {
    if (type === 'drawdown') {
      if (value <= 5) return <CheckCircle className="h-4 w-4 text-green-400" />;
      if (value <= 10) return <AlertTriangle className="h-4 w-4 text-yellow-400" />;
      return <AlertTriangle className="h-4 w-4 text-red-400" />;
    }
    
    if (type === 'return') {
      if (value > 0) return <TrendingUp className="h-4 w-4 text-green-400" />;
      return <TrendingDown className="h-4 w-4 text-red-400" />;
    }
    
    if (type === 'percentage') {
      if (value >= 70) return <TrendingUp className="h-4 w-4 text-green-400" />;
      if (value >= 50) return <Activity className="h-4 w-4 text-yellow-400" />;
      return <TrendingDown className="h-4 w-4 text-red-400" />;
    }
    
    if (type === 'ratio') {
      if (value >= 2.0) return <Target className="h-4 w-4 text-green-400" />;
      if (value >= 1.5) return <Target className="h-4 w-4 text-yellow-400" />;
      return <Target className="h-4 w-4 text-red-400" />;
    }
    
    return <Activity className="h-4 w-4 text-slate-400" />;
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
      value: `${data.winRate}%`,
      description: 'Success rate of trades',
      icon: Target,
      type: 'percentage' as const,
      rawValue: data.winRate
    },
    {
      id: 'averageRRR',
      label: 'Average RRR',
      value: `${data.averageRRR}:1`,
      description: 'Risk-to-reward ratio',
      icon: BarChart3,
      type: 'ratio' as const,
      rawValue: data.averageRRR
    },
    {
      id: 'maxDrawdown',
      label: 'Drawdown (max)',
      value: `${data.maxDrawdown}%`,
      description: 'Capital protection',
      icon: TrendingDown,
      type: 'drawdown' as const,
      rawValue: data.maxDrawdown
    },
    {
      id: 'avgDrawdown',
      label: 'Drawdown (avg)',
      value: `${data.avgDrawdown}%`,
      description: 'Average capital decline',
      icon: Shield,
      type: 'drawdown' as const,
      rawValue: data.avgDrawdown
    },
    {
      id: 'monthlyReturn',
      label: 'Monthly return (%)',
      value: `${data.monthlyReturn}%`,
      description: 'Real-world profitability',
      icon: TrendingUp,
      type: 'return' as const,
      rawValue: data.monthlyReturn
    },
    {
      id: 'tradeFrequency',
      label: 'Trade frequency',
      value: `${data.tradeFrequency}/day`,
      description: 'Scalping vs swing efficiency',
      icon: Zap,
      type: 'percentage' as const,
      rawValue: data.tradeFrequency * 10 // Convert to percentage-like scale
    },
    {
      id: 'avgTradeDuration',
      label: 'Average trade duration',
      value: data.avgTradeDuration,
      description: 'Behavioral pattern (scalp/swing)',
      icon: Clock,
      type: 'percentage' as const,
      rawValue: 75 // Mock percentage for coloring
    },
    {
      id: 'stopLossHitRatio',
      label: 'Stop-loss hit ratio',
      value: `${data.stopLossHitRatio}%`,
      description: 'Discipline and volatility control',
      icon: Shield,
      type: 'drawdown' as const,
      rawValue: data.stopLossHitRatio
    },
    {
      id: 'earlyExitRatio',
      label: 'Early exits vs. TP hits',
      value: `${data.earlyExitRatio}%`,
      description: 'Smart exits vs lucky holds',
      icon: Activity,
      type: 'percentage' as const,
      rawValue: data.earlyExitRatio
    },
    {
      id: 'recoveryAfterLoss',
      label: 'Recovery after losses',
      value: `${data.recoveryAfterLoss}%`,
      description: 'How well AI adapts post-loss',
      icon: TrendingUp,
      type: 'percentage' as const,
      rawValue: data.recoveryAfterLoss
    }
  ];

  const visibleItems = isExpanded ? kpiItems : kpiItems.slice(0, 6);

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700">
      <div className="p-4 sm:p-6 border-b border-slate-700">
        <div className="flex flex-col space-y-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <h3 className="text-lg font-semibold text-white flex items-center space-x-2">
            <BarChart3 className="h-5 w-5 text-blue-400 flex-shrink-0" />
            <span>AI Performance</span>
          </h3>
          <div className="flex flex-col space-y-2 sm:flex-row sm:items-center sm:space-y-0 sm:space-x-4">
            <div className="text-sm text-slate-400">
              {data.totalTrades} total trades
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
        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-6 p-3 sm:p-4 bg-slate-900 rounded-lg border border-slate-600">
          <div className="text-center">
            <div className="text-lg sm:text-2xl font-bold text-green-400">{data.profitableTrades}</div>
            <div className="text-xs text-slate-400">Winning Trades</div>
          </div>
          <div className="text-center">
            <div className="text-lg sm:text-2xl font-bold text-red-400">{data.losingTrades}</div>
            <div className="text-xs text-slate-400">Losing Trades</div>
          </div>
          <div className="text-center">
            <div className="text-lg sm:text-2xl font-bold text-blue-400">{data.totalTrades}</div>
            <div className="text-xs text-slate-400">Total Trades</div>
          </div>
        </div>

        {/* KPI Columns - Changed from rows to columns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {visibleItems.map((kpi) => (
            <div
              key={kpi.id}
              className="bg-slate-900 rounded-lg p-4 border border-slate-600 hover:border-slate-500 transition-colors"
            >
              <div className="flex flex-col space-y-3">
                {/* Top: Icon and Label */}
                <div className="flex items-center space-x-2">
                  <kpi.icon className="h-5 w-5 text-blue-400 flex-shrink-0" />
                  <h4 className="text-white font-medium text-sm truncate">
                    {kpi.label}
                  </h4>
                </div>
                
                {/* Middle: Value */}
                <div className={`text-xl sm:text-2xl font-bold ${getPerformanceColor(kpi.rawValue, kpi.type)} text-center`}>
                  {kpi.value}
                </div>
                
                {/* Progress bar */}
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
                
                {/* Bottom: Description and Performance icon */}
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-400 flex-1">
                    {kpi.description}
                  </p>
                  <div className="flex-shrink-0 ml-2">
                    {getPerformanceIcon(kpi.rawValue, kpi.type)}
                  </div>
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
              <div className="space-y-1 text-sm text-blue-200">
                <p>• Your {data.winRate}% win rate is {data.winRate >= 70 ? 'excellent' : data.winRate >= 50 ? 'good' : 'needs improvement'} for AI trading</p>
                <p>• Risk-reward ratio of {data.averageRRR}:1 shows {data.averageRRR >= 2 ? 'strong' : 'moderate'} profit potential per trade</p>
                <p>• {data.recoveryAfterLoss}% recovery rate indicates {data.recoveryAfterLoss >= 80 ? 'excellent' : 'good'} AI adaptation after losses</p>
                <p>• Monthly return of {data.monthlyReturn}% is {data.monthlyReturn >= 10 ? 'outstanding' : data.monthlyReturn >= 5 ? 'solid' : 'conservative'} for automated trading</p>
              </div>
            </div>
          </div>
        </div>

        {/* Time Period Selector */}
        <div className="mt-4 flex flex-col space-y-2 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <div className="flex items-center space-x-2 text-sm text-slate-400">
            <Calendar className="h-4 w-4 flex-shrink-0" />
            <span>Data from last 30 days</span>
          </div>
          <div className="flex space-x-2">
            <button className="px-3 py-1 text-xs bg-blue-500 text-white rounded-lg">30D</button>
            <button className="px-3 py-1 text-xs bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-colors">7D</button>
            <button className="px-3 py-1 text-xs bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-colors">90D</button>
          </div>
        </div>
      </div>
    </div>
  );
};