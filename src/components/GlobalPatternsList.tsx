import React, { useEffect, useState } from 'react';
import {
  Search, Filter, TrendingUp, TrendingDown, Target, Activity,
  CheckCircle, ArrowUpRight, ArrowDownRight, Package, Calendar
} from 'lucide-react';
import {
  platformIntelligenceService,
  GlobalPattern
} from '../services/platform-intelligence-service';

export function GlobalPatternsList() {
  const [patterns, setPatterns] = useState<GlobalPattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPattern, setSelectedPattern] = useState<GlobalPattern | null>(null);
  const [filters, setFilters] = useState({
    symbol: '',
    setupType: '',
    minWinRate: 0
  });

  useEffect(() => {
    loadPatterns();
  }, [filters]);

  const loadPatterns = async () => {
    setLoading(true);
    const data = await platformIntelligenceService.fetchGlobalPatterns({
      symbol: filters.symbol || undefined,
      setupType: filters.setupType || undefined,
      minWinRate: filters.minWinRate || undefined,
      limit: 50
    });
    setPatterns(data);
    setLoading(false);
  };

  const uniqueSymbols = Array.from(new Set(patterns.map(p => p.symbol))).sort();
  const uniqueSetupTypes = Array.from(new Set(patterns.map(p => p.setup_type))).sort();

  if (loading) {
    return (
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-6">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="ml-3 text-gray-300">Loading platform patterns...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with Filters */}
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xl font-bold text-white">Pattern Discovery</h3>
            <p className="text-sm text-gray-400 mt-1">
              {patterns.length} patterns discovered across all trading activity
            </p>
          </div>
          <Package className="w-6 h-6 text-emerald-400" />
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Symbol</label>
            <select
              value={filters.symbol}
              onChange={(e) => setFilters({ ...filters, symbol: e.target.value })}
              className="w-full bg-gray-900 text-white text-sm rounded px-3 py-2 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">All Symbols</option>
              {uniqueSymbols.map(symbol => (
                <option key={symbol} value={symbol}>{symbol}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-1 block">Setup Type</label>
            <select
              value={filters.setupType}
              onChange={(e) => setFilters({ ...filters, setupType: e.target.value })}
              className="w-full bg-gray-900 text-white text-sm rounded px-3 py-2 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">All Setups</option>
              {uniqueSetupTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-1 block">Min Win Rate</label>
            <select
              value={filters.minWinRate}
              onChange={(e) => setFilters({ ...filters, minWinRate: Number(e.target.value) })}
              className="w-full bg-gray-900 text-white text-sm rounded px-3 py-2 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="0">Any</option>
              <option value="50">50%+</option>
              <option value="60">60%+</option>
              <option value="70">70%+</option>
              <option value="80">80%+</option>
            </select>
          </div>
        </div>
      </div>

      {/* Patterns List */}
      {patterns.length === 0 ? (
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-8 text-center">
          <Search className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No patterns found with current filters</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {patterns.map((pattern) => (
            <PatternCard
              key={pattern.id}
              pattern={pattern}
              isSelected={selectedPattern?.id === pattern.id}
              onClick={() => setSelectedPattern(selectedPattern?.id === pattern.id ? null : pattern)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface PatternCardProps {
  pattern: GlobalPattern;
  isSelected: boolean;
  onClick: () => void;
}

function PatternCard({ pattern, isSelected, onClick }: PatternCardProps) {
  const winRate = pattern.win_rate || 0;
  const profitFactor = pattern.profit_factor || 0;

  const getWinRateColor = (rate: number) => {
    if (rate >= 70) return 'text-emerald-400';
    if (rate >= 60) return 'text-blue-400';
    if (rate >= 50) return 'text-yellow-400';
    return 'text-orange-400';
  };

  const DirectionIcon = pattern.direction === 'buy' ? ArrowUpRight :
                       pattern.direction === 'sell' ? ArrowDownRight :
                       Activity;

  const directionColor = pattern.direction === 'buy' ? 'text-emerald-400' :
                        pattern.direction === 'sell' ? 'text-red-400' :
                        'text-blue-400';

  return (
    <div
      className={`bg-gray-800/50 backdrop-blur-sm border rounded-lg transition-all cursor-pointer ${
        isSelected
          ? 'border-emerald-500 shadow-lg shadow-emerald-500/20'
          : 'border-gray-700 hover:border-gray-600'
      }`}
      onClick={onClick}
    >
      {/* Card Header */}
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <DirectionIcon className={`w-5 h-5 ${directionColor}`} />
              <h4 className="text-white font-semibold">{pattern.pattern_name}</h4>
              {pattern.sample_size_adequate && (
                <CheckCircle className="w-4 h-4 text-emerald-400" />
              )}
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="px-2 py-1 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                {pattern.symbol}
              </span>
              <span className="px-2 py-1 rounded bg-gray-700 text-gray-300">
                {pattern.setup_type}
              </span>
              <span className="text-gray-400">
                {pattern.total_occurrences} occurrences
              </span>
            </div>
          </div>

          {/* Win Rate Badge */}
          <div className="text-right ml-4">
            <div className={`text-3xl font-bold ${getWinRateColor(winRate)}`}>
              {winRate.toFixed(0)}%
            </div>
            <div className="text-xs text-gray-400">Win Rate</div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-gray-900/50 rounded p-2 text-center">
            <div className="text-emerald-400 font-semibold">{pattern.win_count}</div>
            <div className="text-xs text-gray-400">Wins</div>
          </div>
          <div className="bg-gray-900/50 rounded p-2 text-center">
            <div className="text-red-400 font-semibold">{pattern.loss_count}</div>
            <div className="text-xs text-gray-400">Losses</div>
          </div>
          <div className="bg-gray-900/50 rounded p-2 text-center">
            <div className="text-blue-400 font-semibold">{profitFactor.toFixed(2)}</div>
            <div className="text-xs text-gray-400">PF</div>
          </div>
          <div className="bg-gray-900/50 rounded p-2 text-center">
            <div className="text-purple-400 font-semibold">{pattern.avg_rr.toFixed(2)}</div>
            <div className="text-xs text-gray-400">Avg R:R</div>
          </div>
        </div>
      </div>

      {/* Expanded Details */}
      {isSelected && (
        <div className="border-t border-gray-700 p-4 space-y-3">
          {/* Market Conditions */}
          <div>
            <div className="text-xs text-gray-400 mb-2 font-semibold">Market Conditions</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-gray-900/50 rounded p-2">
                <div className="text-gray-400 text-xs">Volatility</div>
                <div className="text-white capitalize">{pattern.volatility_regime}</div>
              </div>
              {pattern.trend_direction && (
                <div className="bg-gray-900/50 rounded p-2">
                  <div className="text-gray-400 text-xs">Trend</div>
                  <div className="text-white capitalize">{pattern.trend_direction}</div>
                </div>
              )}
            </div>
          </div>

          {/* Optimal Timeframes */}
          {pattern.optimal_timeframes && pattern.optimal_timeframes.length > 0 && (
            <div>
              <div className="text-xs text-gray-400 mb-2 font-semibold">Optimal Timeframes</div>
              <div className="flex flex-wrap gap-2">
                {pattern.optimal_timeframes.map((tf, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 text-xs border border-emerald-500/30"
                  >
                    {tf}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Discovery Info */}
          <div className="flex items-center justify-between text-xs text-gray-400 pt-2 border-t border-gray-700">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              <span>
                Discovered {new Date(pattern.discovery_date).toLocaleDateString()}
              </span>
            </div>
            {pattern.last_occurrence_at && (
              <span>
                Last seen {new Date(pattern.last_occurrence_at).toLocaleDateString()}
              </span>
            )}
          </div>

          {/* Statistical Significance */}
          {pattern.statistical_significance > 0 && (
            <div className="bg-emerald-900/20 border border-emerald-500/30 rounded p-2">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                <span className="text-emerald-400 text-xs font-semibold">
                  Statistically Significant
                </span>
                <span className="text-gray-400 text-xs">
                  ({pattern.statistical_significance.toFixed(1)}% confidence)
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
