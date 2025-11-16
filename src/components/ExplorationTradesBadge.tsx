import { Search, TrendingUp, Award } from 'lucide-react';

interface ExplorationTradesBadgeProps {
  isExploratory: boolean;
  confidence: number;
  patternName?: string;
  isGraduated?: boolean;
  className?: string;
}

export function ExplorationTradesBadge({
  isExploratory,
  confidence,
  patternName,
  isGraduated = false,
  className = ''
}: ExplorationTradesBadgeProps) {
  if (!isExploratory) {
    return null;
  }

  if (isGraduated) {
    return (
      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-500/30 ${className}`}>
        <Award className="w-3.5 h-3.5 text-green-400" />
        <span className="text-xs font-medium text-green-300">
          Graduated Pattern
        </span>
        {patternName && (
          <span className="text-xs text-green-400/70">
            ({patternName})
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border border-amber-500/30 ${className}`}>
      <Search className="w-3.5 h-3.5 text-amber-400" />
      <span className="text-xs font-medium text-amber-300">
        Exploring
      </span>
      <span className="text-xs text-amber-400/70">
        {confidence}%
      </span>
      {patternName && (
        <span className="text-xs text-amber-400/70">
          • {patternName}
        </span>
      )}
    </div>
  );
}

interface ExplorationStatsCardProps {
  totalTrades: number;
  exploratoryTrades: number;
  explorationWinRate: number;
  normalWinRate: number;
  patternsDiscovered: number;
  patternsGraduated: number;
  className?: string;
}

export function ExplorationStatsCard({
  totalTrades,
  exploratoryTrades,
  explorationWinRate,
  normalWinRate,
  patternsDiscovered,
  patternsGraduated,
  className = ''
}: ExplorationStatsCardProps) {
  const explorationRate = totalTrades > 0 ? (exploratoryTrades / totalTrades) * 100 : 0;
  const targetRate = 10; // 10% target exploration rate

  return (
    <div className={`bg-slate-800/50 border border-slate-700 rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <Search className="w-5 h-5 text-amber-400" />
          Exploration & Learning
        </h3>
        <div className="flex items-center gap-2">
          <div className={`px-2 py-1 rounded text-xs font-medium ${
            explorationRate <= targetRate + 2 ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'
          }`}>
            {explorationRate.toFixed(1)}% exploration rate
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-900/50 rounded-lg p-3">
          <div className="text-sm text-slate-400 mb-1">Exploratory Trades</div>
          <div className="text-2xl font-bold text-white">
            {exploratoryTrades}
            <span className="text-sm text-slate-500 ml-2">/ {totalTrades}</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {explorationRate.toFixed(1)}% of total
          </div>
        </div>

        <div className="bg-slate-900/50 rounded-lg p-3">
          <div className="text-sm text-slate-400 mb-1">Exploration Win Rate</div>
          <div className={`text-2xl font-bold ${
            explorationWinRate >= 50 ? 'text-green-400' : 'text-amber-400'
          }`}>
            {explorationWinRate.toFixed(1)}%
          </div>
          <div className="text-xs text-slate-500 mt-1">
            vs {normalWinRate.toFixed(1)}% normal
          </div>
        </div>

        <div className="bg-slate-900/50 rounded-lg p-3">
          <div className="text-sm text-slate-400 mb-1">Patterns Discovered</div>
          <div className="text-2xl font-bold text-blue-400">
            {patternsDiscovered}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            active patterns
          </div>
        </div>

        <div className="bg-slate-900/50 rounded-lg p-3">
          <div className="text-sm text-slate-400 mb-1">Patterns Graduated</div>
          <div className="text-2xl font-bold text-green-400 flex items-center gap-1">
            <Award className="w-5 h-5" />
            {patternsGraduated}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            proven strategies
          </div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-slate-700">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-slate-400">
            <TrendingUp className="w-4 h-4" />
            <span>Exploration Impact:</span>
          </div>
          <div className={`font-medium ${
            explorationWinRate >= normalWinRate * 0.8 ? 'text-green-400' : 'text-amber-400'
          }`}>
            {explorationWinRate >= normalWinRate * 0.8
              ? '✓ Discovering profitable patterns'
              : '⚠ Lower performance (expected during exploration)'}
          </div>
        </div>
      </div>
    </div>
  );
}
