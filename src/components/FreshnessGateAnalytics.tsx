import React, { useState, useEffect } from 'react';
import {
  Shield,
  Activity,
  TrendingUp,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Clock,
  Target,
  BarChart3,
  Lightbulb
} from 'lucide-react';
import {
  freshnessAnalyticsService,
  BlockCategoryStats,
  AutoRefreshStats,
  SymbolBlockBreakdown,
  BlockTrend
} from '../services/freshness-analytics-service';

interface Props {
  hours?: number;
}

export function FreshnessGateAnalytics({ hours = 24 }: Props) {
  const [blockStats, setBlockStats] = useState<BlockCategoryStats[]>([]);
  const [autoRefreshStats, setAutoRefreshStats] = useState<AutoRefreshStats | null>(null);
  const [symbolBreakdown, setSymbolBreakdown] = useState<SymbolBlockBreakdown[]>([]);
  const [trends, setTrends] = useState<BlockTrend[]>([]);
  const [recommendations, setRecommendations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAllStats();
  }, [hours]);

  async function loadAllStats() {
    setLoading(true);
    setError(null);
    try {
      const [blocks, refresh, symbols, blockTrends] = await Promise.all([
        freshnessAnalyticsService.getBlockCategoryStats(hours),
        freshnessAnalyticsService.getAutoRefreshStats(hours),
        freshnessAnalyticsService.getSymbolBlockBreakdown(hours),
        freshnessAnalyticsService.getBlockTrends(hours)
      ]);

      setBlockStats(blocks);
      setAutoRefreshStats(refresh);
      setSymbolBreakdown(symbols);
      setTrends(blockTrends);

      const recs = freshnessAnalyticsService.generateRecommendations(blocks, refresh, symbols);
      setRecommendations(recs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }

  const totalBlocks = blockStats.reduce((sum, stat) => sum + stat.totalBlocks, 0);

  if (loading) {
    return (
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin text-slate-400" />
          <span className="ml-3 text-slate-400">Loading freshness analytics...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <div className="flex items-center gap-2 text-red-400">
          <AlertTriangle className="w-5 h-5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/20 rounded-lg">
              <Shield className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Freshness Gate Analytics</h2>
              <p className="text-sm text-slate-400">Last {hours} hours</p>
            </div>
          </div>
          <button
            onClick={loadAllStats}
            className="p-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-slate-700/50 rounded-lg p-4">
            <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
              <AlertTriangle className="w-4 h-4" />
              Total Blocks
            </div>
            <div className="text-2xl font-bold text-white">{totalBlocks.toLocaleString()}</div>
            <div className="text-xs text-slate-500">
              {blockStats.length} categories
            </div>
          </div>

          {autoRefreshStats && (
            <>
              <div className="bg-slate-700/50 rounded-lg p-4">
                <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
                  <RefreshCw className="w-4 h-4" />
                  Auto-Refresh
                </div>
                <div className="text-2xl font-bold text-emerald-400">
                  {autoRefreshStats.successRate.toFixed(0)}%
                </div>
                <div className="text-xs text-slate-500">
                  {autoRefreshStats.refreshSucceeded} / {autoRefreshStats.refreshAttempted} succeeded
                </div>
              </div>

              <div className="bg-slate-700/50 rounded-lg p-4">
                <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
                  <Target className="w-4 h-4" />
                  Rescue Rate
                </div>
                <div className="text-2xl font-bold text-cyan-400">
                  {autoRefreshStats.rescueRate.toFixed(0)}%
                </div>
                <div className="text-xs text-slate-500">
                  {autoRefreshStats.refreshSucceeded} trades saved
                </div>
              </div>

              <div className="bg-slate-700/50 rounded-lg p-4">
                <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
                  <AlertTriangle className="w-4 h-4" />
                  Hard Blocks
                </div>
                <div className="text-2xl font-bold text-red-400">
                  {autoRefreshStats.hardBlocks}
                </div>
                <div className="text-xs text-slate-500">
                  Could not be refreshed
                </div>
              </div>
            </>
          )}
        </div>

        {recommendations.length > 0 && (
          <div className="mb-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <div className="flex items-center gap-2 text-blue-400 font-medium mb-3">
              <Lightbulb className="w-5 h-5" />
              Recommendations
            </div>
            <ul className="space-y-2">
              {recommendations.map((rec, idx) => (
                <li key={idx} className="text-sm text-slate-300 flex items-start gap-2">
                  <span className="text-blue-400 mt-0.5">•</span>
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {blockStats.length > 0 && (
          <div className="space-y-4 mb-6">
            <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Block Category Distribution
            </h3>
            <div className="space-y-2">
              {blockStats.map((stat) => (
                <div key={stat.blockCategory} className="bg-slate-700/30 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full ${freshnessAnalyticsService.getCategoryColor(stat.blockCategory)}`} />
                      <span className="font-medium text-white">
                        {freshnessAnalyticsService.getCategoryLabel(stat.blockCategory)}
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-slate-300">
                      {stat.percentage.toFixed(1)}%
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-sm mb-2">
                    <div>
                      <div className="text-slate-400">Count</div>
                      <div className="text-white font-medium">{stat.totalBlocks.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Avg Stale Time</div>
                      <div className="text-white font-medium">
                        {stat.avgStaleSeconds > 0 ? `${stat.avgStaleSeconds.toFixed(0)}s` : 'N/A'}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400">Symbols</div>
                      <div className="text-white font-medium">
                        {stat.symbolsAffected.length}
                      </div>
                    </div>
                  </div>
                  <div className="h-2 bg-slate-600 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${freshnessAnalyticsService.getCategoryColor(stat.blockCategory)} transition-all duration-500`}
                      style={{ width: `${stat.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {symbolBreakdown.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Per-Symbol Block Analysis
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs text-slate-400 border-b border-slate-700">
                    <th className="pb-2">Symbol</th>
                    <th className="pb-2">Total</th>
                    <th className="pb-2">Omega</th>
                    <th className="pb-2">Alpha</th>
                    <th className="pb-2">Drift</th>
                    <th className="pb-2">Price</th>
                    <th className="pb-2">Most Common</th>
                  </tr>
                </thead>
                <tbody>
                  {symbolBreakdown.slice(0, 10).map((symbol) => (
                    <tr key={symbol.symbol} className="text-sm border-b border-slate-700/50">
                      <td className="py-2 font-medium text-white">{symbol.symbol}</td>
                      <td className="py-2 text-slate-300">{symbol.totalBlocks}</td>
                      <td className="py-2 text-cyan-400">{symbol.staleOmega}</td>
                      <td className="py-2 text-amber-400">{symbol.staleAlpha}</td>
                      <td className="py-2 text-red-400">{symbol.priceDrift}</td>
                      <td className="py-2 text-orange-400">{symbol.stalePrice}</td>
                      <td className="py-2 text-slate-300 text-xs">{symbol.mostCommonCause}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {trends.length > 0 && (
          <div className="mt-6 space-y-4">
            <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Block Trends (Hourly)
            </h3>
            <div className="space-y-2">
              {trends.slice(0, 12).map((trend) => {
                const hourLabel = new Date(trend.hourBucket).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit'
                });
                const maxBlocks = Math.max(...trends.map(t => t.totalBlocks));
                const barWidth = maxBlocks > 0 ? (trend.totalBlocks / maxBlocks) * 100 : 0;

                return (
                  <div key={trend.hourBucket} className="bg-slate-700/30 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-slate-400">{hourLabel}</span>
                      <div className="flex items-center gap-4 text-xs">
                        <span className="text-slate-300">
                          Total: <span className="font-medium text-white">{trend.totalBlocks}</span>
                        </span>
                        <span className="text-amber-400">
                          Stale: {trend.staleBlocks}
                        </span>
                        <span className="text-red-400">
                          Drift: {trend.driftBlocks}
                        </span>
                        {trend.refreshSuccessRate > 0 && (
                          <span className="text-emerald-400">
                            Refresh: {trend.refreshSuccessRate.toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="h-2 bg-slate-600 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-500 to-red-500 transition-all duration-500"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
