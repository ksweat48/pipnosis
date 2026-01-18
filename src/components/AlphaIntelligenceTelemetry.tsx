/**
 * Alpha Intelligence Telemetry Dashboard
 *
 * Visualizes regime-based thesis caching performance
 * Shows cost savings, cache hit rates, and regime analytics
 */

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Activity, TrendingUp, DollarSign, Clock, Database, Zap } from 'lucide-react';

interface CacheMetrics {
  totalLookups: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  avgCacheAge: number;
  totalCostSaved: number;
  uniqueRegimes: number;
  thesesGenerated: number;
}

interface RegimePerformance {
  regime: string;
  hitCount: number;
  missCount: number;
  hitRate: number;
  avgAge: number;
}

export function AlphaIntelligenceTelemetry() {
  const [metrics, setMetrics] = useState<CacheMetrics | null>(null);
  const [regimePerformance, setRegimePerformance] = useState<RegimePerformance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMetrics();
    const interval = setInterval(loadMetrics, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  async function loadMetrics() {
    try {
      // Load cache statistics
      const { data: cacheStats } = await supabase
        .from('cache_statistics')
        .select('*')
        .eq('cache_tier', 'alpha_thesis')
        .order('created_at', { ascending: false })
        .limit(100);

      if (cacheStats && cacheStats.length > 0) {
        const totalLookups = cacheStats.reduce((sum, s) => sum + (s.total_lookups || 0), 0);
        const cacheHits = cacheStats.reduce((sum, s) => sum + (s.cache_hits || 0), 0);
        const cacheMisses = cacheStats.reduce((sum, s) => sum + (s.cache_misses || 0), 0);
        const totalLlmCallsSaved = cacheStats.reduce((sum, s) => sum + (s.total_llm_calls_saved || 0), 0);

        const hitRate = totalLookups > 0 ? (cacheHits / totalLookups) * 100 : 0;
        const avgAge = cacheStats.reduce((sum, s) => sum + (s.avg_cache_age_seconds || 0), 0) / cacheStats.length;
        const costSaved = totalLlmCallsSaved * 0.20; // $0.20 per Alpha call

        // Count unique regimes
        const { data: theses } = await supabase
          .from('alpha_thesis_cache')
          .select('regime_signature_hash')
          .order('created_at', { ascending: false })
          .limit(1000);

        const uniqueRegimes = new Set(theses?.map(t => t.regime_signature_hash) || []).size;

        setMetrics({
          totalLookups,
          cacheHits,
          cacheMisses,
          hitRate,
          avgCacheAge: avgAge,
          totalCostSaved: costSaved,
          uniqueRegimes,
          thesesGenerated: cacheStats.length
        });
      }

      // Load regime-specific performance
      const { data: regimeStats } = await supabase
        .from('alpha_thesis_cache')
        .select('htf_bias, micro_regime, created_at')
        .order('created_at', { ascending: false })
        .limit(100);

      if (regimeStats) {
        const regimeMap = new Map<string, { hits: number; misses: number; ages: number[] }>();

        regimeStats.forEach(stat => {
          const regime = `${stat.htf_bias}_${stat.micro_regime}`;
          if (!regimeMap.has(regime)) {
            regimeMap.set(regime, { hits: 0, misses: 0, ages: [] });
          }
          const data = regimeMap.get(regime)!;
          data.hits++;
          const ageMinutes = (Date.now() - new Date(stat.created_at).getTime()) / 1000 / 60;
          data.ages.push(ageMinutes);
        });

        const performance: RegimePerformance[] = Array.from(regimeMap.entries())
          .map(([regime, data]) => ({
            regime,
            hitCount: data.hits,
            missCount: data.misses,
            hitRate: data.hits > 0 ? (data.hits / (data.hits + data.misses)) * 100 : 0,
            avgAge: data.ages.reduce((sum, age) => sum + age, 0) / data.ages.length
          }))
          .sort((a, b) => b.hitCount - a.hitCount)
          .slice(0, 8);

        setRegimePerformance(performance);
      }

      setLoading(false);
    } catch (error) {
      console.error('Failed to load cache metrics:', error);
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <div className="flex items-center gap-3 mb-4">
          <Activity className="w-5 h-5 text-blue-400" />
          <h3 className="text-lg font-semibold text-white">Alpha Intelligence Telemetry</h3>
        </div>
        <div className="text-gray-400 text-center py-8">Loading metrics...</div>
      </div>
    );
  }

  if (!metrics) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Main Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {/* Cache Hit Rate */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-green-400" />
            <span className="text-xs text-gray-400">Hit Rate</span>
          </div>
          <div className="text-2xl font-bold text-white">{metrics.hitRate.toFixed(1)}%</div>
          <div className="text-xs text-gray-400 mt-1">
            {metrics.cacheHits}/{metrics.totalLookups} hits
          </div>
        </div>

        {/* Cost Saved */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-green-400" />
            <span className="text-xs text-gray-400">Cost Saved</span>
          </div>
          <div className="text-2xl font-bold text-green-400">
            ${metrics.totalCostSaved.toFixed(2)}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {metrics.cacheHits} calls avoided
          </div>
        </div>

        {/* Avg Cache Age */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-blue-400" />
            <span className="text-xs text-gray-400">Avg Age</span>
          </div>
          <div className="text-2xl font-bold text-white">
            {Math.round(metrics.avgCacheAge / 60)}m
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {Math.round(metrics.avgCacheAge)}s average
          </div>
        </div>

        {/* Unique Regimes */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Database className="w-4 h-4 text-purple-400" />
            <span className="text-xs text-gray-400">Regimes</span>
          </div>
          <div className="text-2xl font-bold text-white">{metrics.uniqueRegimes}</div>
          <div className="text-xs text-gray-400 mt-1">
            unique signatures
          </div>
        </div>

        {/* Total Lookups */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-blue-400" />
            <span className="text-xs text-gray-400">Lookups</span>
          </div>
          <div className="text-2xl font-bold text-white">{metrics.totalLookups}</div>
          <div className="text-xs text-gray-400 mt-1">
            total queries
          </div>
        </div>

        {/* Cache Misses */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-orange-400" />
            <span className="text-xs text-gray-400">Misses</span>
          </div>
          <div className="text-2xl font-bold text-orange-400">{metrics.cacheMisses}</div>
          <div className="text-xs text-gray-400 mt-1">
            fresh generations
          </div>
        </div>
      </div>

      {/* Regime Performance Table */}
      {regimePerformance.length > 0 && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <h4 className="text-sm font-semibold text-white mb-3">
            Top Regime Performance
          </h4>
          <div className="space-y-2">
            {regimePerformance.map((regime, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2 bg-gray-900 rounded border border-gray-700"
              >
                <div className="flex-1">
                  <div className="text-sm text-white font-medium">
                    {regime.regime.replace(/_/g, ' ')}
                  </div>
                  <div className="text-xs text-gray-400">
                    {regime.hitCount} uses • {Math.round(regime.avgAge)}min avg age
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-green-400">
                    {regime.hitRate.toFixed(0)}% hit rate
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Performance Insights */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <h4 className="text-sm font-semibold text-white mb-3">Performance Insights</h4>
        <div className="space-y-2 text-sm">
          {metrics.hitRate > 60 && (
            <div className="flex items-start gap-2 text-green-400">
              <span className="mt-0.5">✓</span>
              <span>Excellent cache performance - {metrics.hitRate.toFixed(0)}% of requests served from cache</span>
            </div>
          )}
          {metrics.totalCostSaved > 5 && (
            <div className="flex items-start gap-2 text-green-400">
              <span className="mt-0.5">✓</span>
              <span>Significant cost savings - ${metrics.totalCostSaved.toFixed(2)} saved from {metrics.cacheHits} cached responses</span>
            </div>
          )}
          {metrics.avgCacheAge < 600 && (
            <div className="flex items-start gap-2 text-blue-400">
              <span className="mt-0.5">ℹ</span>
              <span>Fresh cache - Average thesis age {Math.round(metrics.avgCacheAge / 60)} minutes</span>
            </div>
          )}
          {metrics.uniqueRegimes > 10 && (
            <div className="flex items-start gap-2 text-purple-400">
              <span className="mt-0.5">ℹ</span>
              <span>Diverse coverage - {metrics.uniqueRegimes} unique market regimes tracked</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
