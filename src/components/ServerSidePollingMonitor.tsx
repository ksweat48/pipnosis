import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Activity, Clock, Database, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

interface DataSourceStats {
  source: string;
  count: number;
  lastTimestamp: string;
  ageSeconds: number;
}

interface FunctionHealthStatus {
  name: string;
  isHealthy: boolean;
  lastExecution: string | null;
  ageSeconds: number;
  status: 'active' | 'stale' | 'dead' | 'unknown';
}

export function ServerSidePollingMonitor() {
  const [stats, setStats] = useState<DataSourceStats[]>([]);
  const [functionHealth, setFunctionHealth] = useState<FunctionHealthStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const checkDataSources = async () => {
    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

      const { data: recentData, error } = await supabase
        .from('realtime_prices')
        .select('source, created_at')
        .gte('created_at', fiveMinutesAgo)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching realtime_prices:', error);
        return;
      }

      const sourceMap = new Map<string, { count: number; lastTimestamp: string }>();

      recentData?.forEach(row => {
        const existing = sourceMap.get(row.source);
        if (!existing || row.created_at > existing.lastTimestamp) {
          sourceMap.set(row.source, {
            count: (existing?.count || 0) + 1,
            lastTimestamp: row.created_at
          });
        }
      });

      const now = Date.now();
      const statsData = Array.from(sourceMap.entries()).map(([source, data]) => ({
        source,
        count: data.count,
        lastTimestamp: data.lastTimestamp,
        ageSeconds: Math.floor((now - new Date(data.lastTimestamp).getTime()) / 1000)
      }));

      setStats(statsData);

      const serverSideSource = statsData.find(s => s.source === 'netlify_continuous_collector');

      const health: FunctionHealthStatus[] = [
        {
          name: 'continuous-price-collector',
          isHealthy: serverSideSource ? serverSideSource.ageSeconds < 120 : false,
          lastExecution: serverSideSource?.lastTimestamp || null,
          ageSeconds: serverSideSource?.ageSeconds || -1,
          status: serverSideSource
            ? (serverSideSource.ageSeconds < 120 ? 'active' : serverSideSource.ageSeconds < 300 ? 'stale' : 'dead')
            : 'unknown'
        }
      ];

      setFunctionHealth(health);
    } catch (error) {
      console.error('Error checking data sources:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkDataSources();

    if (autoRefresh) {
      const interval = setInterval(checkDataSources, 10000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'stale':
        return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      case 'dead':
        return <XCircle className="w-5 h-5 text-red-500" />;
      default:
        return <AlertTriangle className="w-5 h-5 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500/10 border-green-500/20';
      case 'stale':
        return 'bg-yellow-500/10 border-yellow-500/20';
      case 'dead':
        return 'bg-red-500/10 border-red-500/20';
      default:
        return 'bg-gray-500/10 border-gray-500/20';
    }
  };

  if (loading) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-5 h-5 text-blue-400" />
          <h3 className="text-lg font-semibold text-white">Server-Side Polling Monitor</h3>
        </div>
        <p className="text-slate-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-400" />
          <h3 className="text-lg font-semibold text-white">Server-Side Polling Monitor</h3>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-2 focus:ring-blue-500"
            />
            Auto-refresh (10s)
          </label>
          <button
            onClick={checkDataSources}
            className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm transition-colors"
          >
            Refresh Now
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
            <Database className="w-4 h-4" />
            Scheduled Function Health
          </h4>

          <div className="space-y-2">
            {functionHealth.map((func) => (
              <div
                key={func.name}
                className={`p-4 rounded-lg border ${getStatusColor(func.status)}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {getStatusIcon(func.status)}
                    <div>
                      <div className="font-medium text-white">{func.name}</div>
                      <div className="text-sm text-slate-400">
                        Schedule: Every minute (netlify.toml)
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    {func.lastExecution ? (
                      <>
                        <div className="text-sm text-slate-300">
                          Last: {new Date(func.lastExecution).toLocaleTimeString()}
                        </div>
                        <div className="text-xs text-slate-500">
                          {func.ageSeconds}s ago
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-red-400">No data found</div>
                    )}
                  </div>
                </div>

                {func.status === 'unknown' && (
                  <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded">
                    <p className="text-sm text-yellow-400">
                      ⚠️ No server-side data detected. Scheduled function may not be running.
                    </p>
                    <ul className="mt-2 text-xs text-yellow-300 space-y-1">
                      <li>• Check Netlify dashboard → Functions → Scheduled</li>
                      <li>• Verify environment variables are set in Netlify</li>
                      <li>• Check function logs for errors</li>
                      <li>• Ensure Netlify plan supports scheduled functions</li>
                    </ul>
                  </div>
                )}

                {func.status === 'stale' && (
                  <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded">
                    <p className="text-sm text-yellow-400">
                      Function execution delayed. Last run {func.ageSeconds}s ago (expected {"<"}120s).
                    </p>
                  </div>
                )}

                {func.status === 'dead' && (
                  <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded">
                    <p className="text-sm text-red-400">
                      🚨 Function appears to be dead. Last run {func.ageSeconds}s ago.
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Data Sources (Last 5 Minutes)
          </h4>

          {stats.length === 0 ? (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-sm text-red-400">
                ⚠️ No price data found in the last 5 minutes. System may not be collecting data.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {stats.map((stat) => (
                <div
                  key={stat.source}
                  className="p-3 bg-slate-700/50 border border-slate-600 rounded-lg"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-white">{stat.source}</div>
                      <div className="text-xs text-slate-400 mt-1">
                        {stat.count} price updates
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-slate-300">
                        {new Date(stat.lastTimestamp).toLocaleTimeString()}
                      </div>
                      <div className="text-xs text-slate-500">
                        {stat.ageSeconds}s ago
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
          <p className="text-sm text-blue-300">
            <strong>Expected Behavior:</strong> If the page is closed, the "netlify_continuous_collector"
            source should continue adding data every minute. If you only see browser-based sources,
            the scheduled function is not running.
          </p>
        </div>
      </div>
    </div>
  );
}
