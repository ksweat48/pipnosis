import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { AlertTriangle, CheckCircle, TrendingUp, Activity, Clock } from 'lucide-react';

interface HealthSummary {
  symbol: string;
  total_attempts: number;
  successful: number;
  failed: number;
  success_rate: number;
  avg_latency_ms: number;
  primary_source_used: string;
  fallback_count: number;
}

interface RecentFailure {
  symbol: string;
  source_attempted: string;
  attempt_number: number;
  error_message: string;
  created_at: string;
}

export function PriceCollectionHealthDashboard() {
  const [healthData, setHealthData] = useState<HealthSummary[]>([]);
  const [recentFailures, setRecentFailures] = useState<RecentFailure[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState(60); // minutes

  useEffect(() => {
    loadHealthData();
    const interval = setInterval(loadHealthData, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [timeRange]);

  async function loadHealthData() {
    try {
      // Get health summary
      const { data: summary, error: summaryError } = await supabase
        .rpc('get_price_collection_health_summary', { minutes_back: timeRange });

      if (summaryError) throw summaryError;
      setHealthData(summary || []);

      // Get recent failures
      const { data: failures, error: failuresError } = await supabase
        .rpc('get_recent_price_collection_failures', { limit_count: 10 });

      if (failuresError) throw failuresError;
      setRecentFailures(failures || []);

    } catch (error) {
      console.error('[PriceCollectionHealth] Error loading data:', error);
    } finally {
      setLoading(false);
    }
  }

  const overallSuccessRate = healthData.length > 0
    ? (healthData.reduce((sum, h) => sum + (h.success_rate * h.total_attempts), 0) / healthData.reduce((sum, h) => sum + h.total_attempts, 0))
    : 0;

  const totalFallbacks = healthData.reduce((sum, h) => sum + h.fallback_count, 0);
  const avgLatency = healthData.length > 0
    ? Math.round(healthData.reduce((sum, h) => sum + h.avg_latency_ms, 0) / healthData.length)
    : 0;

  if (loading) {
    return (
      <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-lg p-6">
        <div className="flex items-center space-x-2 mb-4">
          <Activity className="w-5 h-5 text-blue-400" />
          <h3 className="text-lg font-semibold">Price Collection Health</h3>
        </div>
        <div className="text-slate-400">Loading health metrics...</div>
      </div>
    );
  }

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-lg p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Activity className="w-5 h-5 text-blue-400" />
          <h3 className="text-lg font-semibold">Price Collection Health</h3>
        </div>
        <select
          value={timeRange}
          onChange={(e) => setTimeRange(parseInt(e.target.value))}
          className="px-3 py-1 bg-slate-700/50 border border-slate-600 rounded text-sm"
        >
          <option value={15}>Last 15 minutes</option>
          <option value={60}>Last hour</option>
          <option value={240}>Last 4 hours</option>
          <option value={1440}>Last 24 hours</option>
        </select>
      </div>

      {/* Overall Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-700/30 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-400">Success Rate</span>
            {overallSuccessRate >= 95 ? (
              <CheckCircle className="w-4 h-4 text-green-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-yellow-400" />
            )}
          </div>
          <div className={`text-2xl font-bold ${overallSuccessRate >= 95 ? 'text-green-400' : 'text-yellow-400'}`}>
            {overallSuccessRate.toFixed(1)}%
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Target: 95%+
          </div>
        </div>

        <div className="bg-slate-700/30 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-400">Avg Latency</span>
            <Clock className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-blue-400">
            {avgLatency}ms
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Response time
          </div>
        </div>

        <div className="bg-slate-700/30 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-400">Fallbacks</span>
            <TrendingUp className="w-4 h-4 text-orange-400" />
          </div>
          <div className="text-2xl font-bold text-orange-400">
            {totalFallbacks}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Source switches
          </div>
        </div>

        <div className="bg-slate-700/30 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-400">Symbols</span>
            <Activity className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-bold text-purple-400">
            {healthData.length}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Monitored
          </div>
        </div>
      </div>

      {/* Per-Symbol Health */}
      <div>
        <h4 className="text-sm font-medium text-slate-300 mb-3">Per-Symbol Health</h4>
        <div className="space-y-2">
          {healthData.map((health) => (
            <div
              key={health.symbol}
              className="bg-slate-700/20 rounded p-3 flex items-center justify-between"
            >
              <div className="flex items-center space-x-4">
                <span className="font-medium text-white w-20">{health.symbol}</span>
                <div className="flex items-center space-x-2">
                  <div className={`text-sm font-medium ${health.success_rate >= 95 ? 'text-green-400' : health.success_rate >= 85 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {health.success_rate.toFixed(1)}%
                  </div>
                  <div className="text-xs text-slate-500">
                    ({health.successful}/{health.total_attempts})
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-6 text-sm">
                <div className="text-slate-400">
                  {health.avg_latency_ms}ms
                </div>
                <div className="text-slate-500">
                  {health.primary_source_used || 'N/A'}
                </div>
                {health.fallback_count > 0 && (
                  <div className="text-orange-400">
                    {health.fallback_count} fallback{health.fallback_count > 1 ? 's' : ''}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Failures */}
      {recentFailures.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-slate-300 mb-3">Recent Failures</h4>
          <div className="space-y-2">
            {recentFailures.map((failure, index) => (
              <div
                key={index}
                className="bg-red-900/10 border border-red-900/20 rounded p-3 text-sm"
              >
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-center space-x-2">
                    <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                    <span className="font-medium text-red-400">{failure.symbol}</span>
                    <span className="text-slate-500">-</span>
                    <span className="text-slate-400">{failure.source_attempted}</span>
                    {failure.attempt_number > 1 && (
                      <span className="text-xs text-orange-400">
                        (Attempt {failure.attempt_number})
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-slate-500">
                    {new Date(failure.created_at).toLocaleTimeString()}
                  </span>
                </div>
                {failure.error_message && (
                  <div className="text-xs text-slate-500 ml-6">
                    {failure.error_message}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
