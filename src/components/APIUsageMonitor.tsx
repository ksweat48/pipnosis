import { useState, useEffect } from 'react';
import { AlertTriangle, Activity, TrendingUp, Database, Zap, CheckCircle, XCircle, Clock } from 'lucide-react';
import { systemLoadMonitor, LoadSnapshot, LoadSummary, SystemAlert } from '@/services/system-load-monitor';
import { pollingConfigService } from '@/services/polling-config-service';
import { globalPollingCoordinator } from '@/services/global-polling-coordinator';

export default function APIUsageMonitor() {
  const [loadSummary, setLoadSummary] = useState<LoadSummary | null>(null);
  const [recentMetrics, setRecentMetrics] = useState<LoadSnapshot[]>([]);
  const [activeAlerts, setActiveAlerts] = useState<SystemAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      loadData();
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const [summary, metrics, alerts] = await Promise.all([
        systemLoadMonitor.getLoadSummary(),
        systemLoadMonitor.getRecentMetrics(15),
        systemLoadMonitor.getActiveAlerts()
      ]);

      setLoadSummary(summary);
      setRecentMetrics(metrics);
      setActiveAlerts(alerts);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Error loading API usage data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getCurrentMetrics = () => {
    const creditUsage = pollingConfigService.getCreditUsage();
    const coordinatorStatus = globalPollingCoordinator.getCoordinatorStatus();

    return {
      cpuUsage: creditUsage.percentage,
      callsRemaining: creditUsage.callsRemaining,
      queueLength: 0, // No longer using queue (read-only from DB)
      activePairs: coordinatorStatus.activePairs,
      totalPairs: coordinatorStatus.totalPairs,
      inFlightRequests: 0, // No longer using queue
      cacheSize: 0 // No longer using queue
    };
  };

  const current = getCurrentMetrics();
  const loadReduction = systemLoadMonitor.calculateLoadReduction();
  const loadStatus = systemLoadMonitor.getLoadStatus();

  const getStatusColor = (percentage: number) => {
    if (percentage >= 95) return 'text-red-600 bg-red-50';
    if (percentage >= 85) return 'text-orange-600 bg-orange-50';
    if (percentage >= 70) return 'text-yellow-600 bg-yellow-50';
    return 'text-green-600 bg-green-50';
  };

  const getStatusBadge = (status: string) => {
    const colors = {
      healthy: 'bg-green-100 text-green-800',
      warning: 'bg-yellow-100 text-yellow-800',
      critical: 'bg-red-100 text-red-800'
    };
    return colors[status as keyof typeof colors] || colors.healthy;
  };

  const getSeverityColor = (severity: string) => {
    const colors = {
      info: 'bg-blue-100 text-blue-800',
      warning: 'bg-yellow-100 text-yellow-800',
      critical: 'bg-red-100 text-red-800'
    };
    return colors[severity as keyof typeof colors] || colors.info;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-gray-500">Loading API usage data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">API Usage Monitor</h2>
          <p className="text-sm text-gray-600 mt-1">Real-time MetaAPI rate limit and system load tracking</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusBadge(loadStatus)}`}>
            {loadStatus.toUpperCase()}
          </span>
          <div className="text-xs text-gray-500">
            Last updated: {lastUpdated.toLocaleTimeString()}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-600">CPU Credits</span>
            <Zap className="w-4 h-4 text-blue-500" />
          </div>
          <div className={`text-2xl font-bold ${getStatusColor(current.cpuUsage).split(' ')[0]}`}>
            {current.cpuUsage.toFixed(1)}%
          </div>
          <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                current.cpuUsage >= 95 ? 'bg-red-500' :
                current.cpuUsage >= 85 ? 'bg-orange-500' :
                current.cpuUsage >= 70 ? 'bg-yellow-500' :
                'bg-green-500'
              }`}
              style={{ width: `${Math.min(current.cpuUsage, 100)}%` }}
            />
          </div>
          <div className="text-xs text-gray-500 mt-2">
            {current.callsRemaining} calls remaining
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-600">Active Pairs</span>
            <TrendingUp className="w-4 h-4 text-green-500" />
          </div>
          <div className="text-2xl font-bold text-gray-900">
            {current.activePairs} / {current.totalPairs}
          </div>
          <div className="text-xs text-gray-500 mt-2">
            Optimized from 12 to 5 pairs
          </div>
          <div className="text-xs text-green-600 mt-1 font-medium">
            {loadReduction.reduction.percentage}% load reduction
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-600">Request Queue</span>
            <Activity className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-2xl font-bold text-gray-900">
            {current.queueLength}
          </div>
          <div className="text-xs text-gray-500 mt-2">
            {current.inFlightRequests} in-flight
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {current.cacheSize} cached
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-600">Active Alerts</span>
            <AlertTriangle className={`w-4 h-4 ${activeAlerts.length > 0 ? 'text-red-500' : 'text-gray-400'}`} />
          </div>
          <div className={`text-2xl font-bold ${activeAlerts.length > 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {activeAlerts.length}
          </div>
          <div className="text-xs text-gray-500 mt-2">
            {activeAlerts.length === 0 ? 'All systems normal' : 'Action may be needed'}
          </div>
        </div>
      </div>

      {loadSummary && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Load Averages</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <div className="text-sm text-gray-600 mb-1">Current CPU Usage</div>
              <div className="text-3xl font-bold text-gray-900">
                {loadSummary.current.cpu_usage_percentage.toFixed(1)}%
              </div>
              <div className="text-sm text-gray-500 mt-1">
                {loadSummary.current.api_calls_per_second.toFixed(2)} calls/sec
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-600 mb-1">Last Hour Average</div>
              <div className="text-3xl font-bold text-gray-900">
                {loadSummary.averages.cpu_usage_1h.toFixed(1)}%
              </div>
              <div className="text-sm text-gray-500 mt-1">Sustained load level</div>
            </div>
            <div>
              <div className="text-sm text-gray-600 mb-1">24 Hour Average</div>
              <div className="text-3xl font-bold text-gray-900">
                {loadSummary.averages.cpu_usage_24h.toFixed(1)}%
              </div>
              <div className="text-sm text-gray-500 mt-1">Daily average</div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-blue-900 mb-2 flex items-center gap-2">
          <Database className="w-4 h-4" />
          System Optimization Summary
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-blue-700 font-medium">Before Optimization</div>
            <div className="text-blue-600 mt-1">{loadReduction.before.pairs} trading pairs</div>
            <div className="text-blue-600">~{loadReduction.before.estimatedLoad}% CPU load</div>
          </div>
          <div>
            <div className="text-blue-700 font-medium">After Optimization</div>
            <div className="text-blue-600 mt-1">{loadReduction.after.pairs} trading pairs</div>
            <div className="text-blue-600">~{loadReduction.after.estimatedLoad}% CPU load</div>
          </div>
          <div>
            <div className="text-blue-700 font-medium">Improvement</div>
            <div className="text-green-600 mt-1 font-semibold">-{loadReduction.reduction.pairs} pairs removed</div>
            <div className="text-green-600 font-semibold">-{loadReduction.reduction.percentage}% load reduction</div>
            <div className="text-green-600 font-semibold">{loadReduction.headroom}% headroom available</div>
          </div>
        </div>
        <div className="mt-3 text-xs text-blue-700">
          Active pairs: <span className="font-mono font-semibold">XAUUSD, US30, EURUSD, USDJPY, GBPUSD</span>
        </div>
      </div>

      {activeAlerts.length > 0 && (
        <div className="bg-white rounded-lg border border-red-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            Active Alerts
          </h3>
          <div className="space-y-3">
            {activeAlerts.map((alert) => (
              <div
                key={alert.id}
                className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200"
              >
                <div className="flex-shrink-0">
                  {alert.severity === 'critical' ? (
                    <XCircle className="w-5 h-5 text-red-500" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-yellow-500" />
                  )}
                </div>
                <div className="flex-grow">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2 py-1 text-xs font-medium rounded ${getSeverityColor(alert.severity)}`}>
                      {alert.severity.toUpperCase()}
                    </span>
                    <span className="text-xs text-gray-500">
                      {new Date(alert.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-sm font-medium text-gray-900">{alert.message}</div>
                  <div className="text-xs text-gray-600 mt-1">
                    Threshold: {alert.threshold_value} | Actual: {alert.actual_value}
                  </div>
                  {alert.email_sent && (
                    <div className="text-xs text-green-600 mt-1 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      Email sent to admin
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {recentMetrics.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Recent Metrics (Last 15 Minutes)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-2 text-left text-gray-600 font-medium">CPU Usage</th>
                  <th className="px-4 py-2 text-left text-gray-600 font-medium">API Calls/sec</th>
                  <th className="px-4 py-2 text-left text-gray-600 font-medium">Error Rate</th>
                  <th className="px-4 py-2 text-left text-gray-600 font-medium">Queue Length</th>
                  <th className="px-4 py-2 text-left text-gray-600 font-medium">Cache Hit Rate</th>
                </tr>
              </thead>
              <tbody>
                {recentMetrics.slice(-10).reverse().map((metric, index) => (
                  <tr key={index} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <span className={`font-medium ${
                        metric.cpuUsagePercentage >= 85 ? 'text-red-600' :
                        metric.cpuUsagePercentage >= 70 ? 'text-yellow-600' :
                        'text-gray-900'
                      }`}>
                        {metric.cpuUsagePercentage.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-900">{metric.apiCallsPerSecond.toFixed(2)}</td>
                    <td className="px-4 py-2">
                      <span className={`font-medium ${
                        metric.errorRate >= 10 ? 'text-red-600' : 'text-gray-900'
                      }`}>
                        {metric.errorRate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-900">{metric.requestQueueLength}</td>
                    <td className="px-4 py-2 text-gray-900">{metric.cacheHitRate.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-2">MetaAPI Rate Limits</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-gray-600">
          <div>
            <div className="font-medium text-gray-700">10-Second Window</div>
            <div className="mt-1">5,000 CPU credits max</div>
            <div>100 API calls max</div>
          </div>
          <div>
            <div className="font-medium text-gray-700">Per API Call</div>
            <div className="mt-1">50 CPU credits per price fetch</div>
            <div>20 calls/second recommended</div>
          </div>
          <div>
            <div className="font-medium text-gray-700">Current Configuration</div>
            <div className="mt-1">5 critical pairs only</div>
            <div>Balanced polling mode</div>
          </div>
        </div>
      </div>
    </div>
  );
}
