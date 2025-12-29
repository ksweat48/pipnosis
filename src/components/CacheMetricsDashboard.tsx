import React, { useState, useEffect } from 'react';
import { Database, Activity, TrendingUp, Clock, Zap, RefreshCw, AlertCircle } from 'lucide-react';
import { sharedIntelligenceCoordinator, CacheStats } from '../services/shared-intelligence-coordinator';
import { cacheWarmingService } from '../services/cache-warming-service';

interface Props {
  onClose?: () => void;
}

export function CacheMetricsDashboard({ onClose }: Props) {
  const [stats, setStats] = useState<CacheStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [warming, setWarming] = useState(false);
  const [lastWarmed, setLastWarmed] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStats();
    setLastWarmed(cacheWarmingService.getLastWarmTime());
  }, []);

  async function loadStats() {
    setLoading(true);
    setError(null);
    try {
      const data = await sharedIntelligenceCoordinator.getCacheStats(24);
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  }

  async function handleWarmCache() {
    setWarming(true);
    setError(null);
    try {
      await cacheWarmingService.cleanupAndWarm();
      setLastWarmed(new Date());
      await loadStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to warm cache');
    } finally {
      setWarming(false);
    }
  }

  async function handleCleanup() {
    setLoading(true);
    try {
      const result = await sharedIntelligenceCoordinator.cleanupExpiredCache();
      console.log('Cleanup result:', result);
      await loadStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cleanup');
    } finally {
      setLoading(false);
    }
  }

  const totalLookups = stats.reduce((sum, s) => sum + s.totalLookups, 0);
  const totalHits = stats.reduce((sum, s) => sum + s.cacheHits, 0);
  const totalSaved = stats.reduce((sum, s) => sum + s.totalLlmCallsSaved, 0);
  const overallHitRate = totalLookups > 0 ? (totalHits / totalLookups) * 100 : 0;

  const estimatedCostSaved = totalSaved * 0.002;

  return (
    <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-cyan-500/20 rounded-lg">
            <Database className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Intelligence Cache</h2>
            <p className="text-sm text-slate-400">Shared LLM response caching</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCleanup}
            disabled={loading}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            Cleanup
          </button>
          <button
            onClick={handleWarmCache}
            disabled={warming || loading}
            className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {warming ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Warming...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                Warm Cache
              </>
            )}
          </button>
          <button
            onClick={loadStats}
            disabled={loading}
            className="p-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-700/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
            <Activity className="w-4 h-4" />
            Hit Rate
          </div>
          <div className="text-2xl font-bold text-white">
            {overallHitRate.toFixed(1)}%
          </div>
          <div className="text-xs text-slate-500">
            {totalHits.toLocaleString()} / {totalLookups.toLocaleString()} lookups
          </div>
        </div>

        <div className="bg-slate-700/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
            <TrendingUp className="w-4 h-4" />
            LLM Calls Saved
          </div>
          <div className="text-2xl font-bold text-emerald-400">
            {totalSaved.toLocaleString()}
          </div>
          <div className="text-xs text-slate-500">
            ~${estimatedCostSaved.toFixed(2)} saved
          </div>
        </div>

        <div className="bg-slate-700/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
            <Clock className="w-4 h-4" />
            Last Warmed
          </div>
          <div className="text-lg font-semibold text-white">
            {lastWarmed ? formatTimeAgo(lastWarmed) : 'Never'}
          </div>
          <div className="text-xs text-slate-500">
            {lastWarmed ? lastWarmed.toLocaleTimeString() : '-'}
          </div>
        </div>

        <div className="bg-slate-700/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
            <Database className="w-4 h-4" />
            Cache Tiers
          </div>
          <div className="text-2xl font-bold text-white">
            {stats.length}
          </div>
          <div className="text-xs text-slate-500">
            Omega, Alpha, Scout
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-slate-300">Cache Tier Breakdown</h3>

        {loading ? (
          <div className="text-center py-8 text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading statistics...
          </div>
        ) : stats.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            <Database className="w-6 h-6 mx-auto mb-2 opacity-50" />
            No cache data yet. Run cache warming to populate.
          </div>
        ) : (
          <div className="space-y-2">
            {stats.map((tier) => (
              <div
                key={tier.cacheTier}
                className="bg-slate-700/30 rounded-lg p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${getTierColor(tier.cacheTier)}`} />
                    <span className="font-medium text-white capitalize">
                      {tier.cacheTier} Cache
                    </span>
                  </div>
                  <span className={`text-sm font-semibold ${getHitRateColor(tier.hitRate)}`}>
                    {tier.hitRate.toFixed(1)}% hit rate
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-slate-400">Lookups</div>
                    <div className="text-white font-medium">{tier.totalLookups.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Hits / Misses</div>
                    <div className="text-white font-medium">
                      <span className="text-emerald-400">{tier.cacheHits.toLocaleString()}</span>
                      {' / '}
                      <span className="text-amber-400">{tier.cacheMisses.toLocaleString()}</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Avg Age</div>
                    <div className="text-white font-medium">
                      {tier.avgCacheAgeSeconds > 0 ? `${tier.avgCacheAgeSeconds.toFixed(0)}s` : '-'}
                    </div>
                  </div>
                </div>

                <div className="mt-2 h-2 bg-slate-600 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${getTierColor(tier.cacheTier)} transition-all duration-500`}
                    style={{ width: `${tier.hitRate}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 p-4 bg-slate-700/30 rounded-lg">
        <h4 className="text-sm font-medium text-slate-300 mb-2">How It Works</h4>
        <ul className="text-xs text-slate-400 space-y-1">
          <li>- Omega brains analyze markets once, results shared with all users</li>
          <li>- Cache keys use ATR-relative price buckets for intelligent reuse</li>
          <li>- TTL varies by timeframe: M5=8min, M15=15min, H1=30min</li>
          <li>- Scout runs globally, not per-user, for significant savings</li>
        </ul>
      </div>
    </div>
  );
}

function getTierColor(tier: string): string {
  switch (tier) {
    case 'omega':
      return 'bg-cyan-500';
    case 'alpha':
      return 'bg-amber-500';
    case 'scout':
      return 'bg-emerald-500';
    default:
      return 'bg-slate-500';
  }
}

function getHitRateColor(rate: number): string {
  if (rate >= 90) return 'text-emerald-400';
  if (rate >= 70) return 'text-amber-400';
  return 'text-red-400';
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
