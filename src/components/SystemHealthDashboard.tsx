import React, { useState, useEffect } from 'react';
import { Activity, CheckCircle, AlertTriangle, XCircle, TrendingUp, Clock, Gauge, Zap } from 'lucide-react';
import type { SystemDashboard, SystemAlert, RateLimitStats } from '@/services/system-monitoring-service';
import { systemMonitoringService } from '@/services/system-monitoring-service';

interface SystemHealthDashboardProps {
  dashboard: SystemDashboard | null;
  alerts: SystemAlert[];
}

export function SystemHealthDashboard({ dashboard, alerts }: SystemHealthDashboardProps) {
  const [rateLimitStats, setRateLimitStats] = useState<RateLimitStats | null>(null);

  useEffect(() => {
    const updateRateLimitStats = () => {
      try {
        const stats = systemMonitoringService.getRateLimitStats();
        setRateLimitStats(stats);
      } catch (error) {
        console.error('Error fetching rate limit stats:', error);
      }
    };

    updateRateLimitStats();
    const interval = setInterval(updateRateLimitStats, 1000);

    return () => clearInterval(interval);
  }, []);

  if (!dashboard) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <div className="text-center py-8 text-gray-500">
          Loading system health data...
        </div>
      </div>
    );
  }

  const getSystemStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle className="text-green-500" size={32} />;
      case 'degraded':
        return <AlertTriangle className="text-yellow-500" size={32} />;
      case 'unhealthy':
        return <XCircle className="text-red-500" size={32} />;
      default:
        return <Activity className="text-gray-500" size={32} />;
    }
  };

  const getSystemStatusBadge = (status: string) => {
    const badges = {
      healthy: 'bg-green-500/20 text-green-400 border-green-500/30',
      degraded: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      unhealthy: 'bg-red-500/20 text-red-400 border-red-500/30',
    };
    return badges[status as keyof typeof badges] || 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  };

  const getUptimeColor = (uptime: number) => {
    if (uptime >= 95) return 'text-green-500';
    if (uptime >= 80) return 'text-yellow-500';
    return 'text-red-500';
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const getAlertIcon = (severity: string) => {
    if (severity === 'error') {
      return <XCircle className="text-red-500" size={16} />;
    }
    return <AlertTriangle className="text-yellow-500" size={16} />;
  };

  return (
    <div className="space-y-6">
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <div className="flex items-center gap-3 mb-6">
          <Activity className="text-emerald-500" size={24} />
          <h3 className="text-lg font-bold text-white">System Health Overview</h3>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-gray-900 rounded-lg p-6 border-2 border-gray-700">
            <div className="flex items-center justify-between mb-4">
              {getSystemStatusIcon(dashboard.system_status)}
              <div className={`px-4 py-2 rounded-lg border font-semibold text-lg ${getSystemStatusBadge(dashboard.system_status)}`}>
                {dashboard.system_status.toUpperCase()}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">24h Uptime</span>
                <span className={`text-xl font-bold ${getUptimeColor(dashboard.system_uptime_24h)}`}>
                  {dashboard.system_uptime_24h.toFixed(2)}%
                </span>
              </div>

              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    dashboard.system_uptime_24h >= 95 ? 'bg-green-500' :
                    dashboard.system_uptime_24h >= 80 ? 'bg-yellow-500' :
                    'bg-red-500'
                  }`}
                  style={{ width: `${dashboard.system_uptime_24h}%` }}
                />
              </div>
            </div>
          </div>

          <div className="bg-gray-900 rounded-lg p-6">
            <h4 className="text-sm font-semibold text-gray-300 mb-4">Quick Stats</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle className="text-green-400" size={14} />
                  <span className="text-xs text-gray-400">Successful Jobs</span>
                </div>
                <div className="text-xl font-bold text-white">
                  {dashboard.successful_executions_last_10min}
                </div>
                <div className="text-xs text-gray-500">Last 10 min</div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-1">
                  <XCircle className="text-red-400" size={14} />
                  <span className="text-xs text-gray-400">Failed Jobs</span>
                </div>
                <div className="text-xl font-bold text-white">
                  {dashboard.failed_executions_last_10min}
                </div>
                <div className="text-xs text-gray-500">Last 10 min</div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="text-blue-400" size={14} />
                  <span className="text-xs text-gray-400">Active Jobs</span>
                </div>
                <div className="text-xl font-bold text-white">
                  {dashboard.active_cron_jobs?.length || 0}
                </div>
                <div className="text-xs text-gray-500">Cron jobs</div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="text-purple-400" size={14} />
                  <span className="text-xs text-gray-400">Last Update</span>
                </div>
                <div className="text-xl font-bold text-white">
                  {formatTimestamp(dashboard.timestamp)}
                </div>
                <div className="text-xs text-gray-500">Local time</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {rateLimitStats && (
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center gap-3 mb-6">
            <Gauge className="text-blue-500" size={24} />
            <h3 className="text-lg font-bold text-white">Rate Limit Monitor</h3>
            {rateLimitStats.is_throttling && (
              <span className="px-2 py-1 text-xs font-medium bg-red-500/20 text-red-400 rounded animate-pulse">
                THROTTLING
              </span>
            )}
            {rateLimitStats.is_approaching_limit && !rateLimitStats.is_throttling && (
              <span className="px-2 py-1 text-xs font-medium bg-yellow-500/20 text-yellow-400 rounded">
                APPROACHING LIMIT
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-gray-900 rounded-lg p-6">
              <h4 className="text-sm font-semibold text-gray-300 mb-4">Current Usage</h4>

              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-400">Credit Usage</span>
                    <span className={`text-lg font-bold ${
                      rateLimitStats.current_usage_percentage > 90 ? 'text-red-400' :
                      rateLimitStats.current_usage_percentage > 80 ? 'text-yellow-400' :
                      'text-green-400'
                    }`}>
                      {rateLimitStats.current_usage_percentage.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        rateLimitStats.current_usage_percentage > 90 ? 'bg-red-500' :
                        rateLimitStats.current_usage_percentage > 80 ? 'bg-yellow-500' :
                        'bg-green-500'
                      }`}
                      style={{ width: `${Math.min(rateLimitStats.current_usage_percentage, 100)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-gray-500">
                      {rateLimitStats.credits_used} / {rateLimitStats.credits_limit} credits
                    </span>
                    <span className="text-xs text-gray-500">
                      {rateLimitStats.calls_remaining} calls remaining
                    </span>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-400">Projected Usage</span>
                    <span className={`text-lg font-bold ${
                      rateLimitStats.projected_usage_percentage > 90 ? 'text-red-400' :
                      rateLimitStats.projected_usage_percentage > 80 ? 'text-yellow-400' :
                      'text-green-400'
                    }`}>
                      {rateLimitStats.projected_usage_percentage.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        rateLimitStats.projected_usage_percentage > 90 ? 'bg-red-500' :
                        rateLimitStats.projected_usage_percentage > 80 ? 'bg-yellow-500' :
                        'bg-green-500'
                      }`}
                      style={{ width: `${Math.min(rateLimitStats.projected_usage_percentage, 100)}%` }}
                    />
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    Based on current rate over 10 seconds
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-gray-900 rounded-lg p-6">
              <h4 className="text-sm font-semibold text-gray-300 mb-4">Performance Metrics</h4>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="text-yellow-400" size={16} />
                    <span className="text-sm text-gray-400">Calls/Second</span>
                  </div>
                  <span className="text-xl font-bold text-white">
                    {rateLimitStats.calls_per_second.toFixed(2)}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="text-blue-400" size={16} />
                    <span className="text-sm text-gray-400">Credits/Second</span>
                  </div>
                  <span className="text-xl font-bold text-white">
                    {(rateLimitStats.credits_used / 10).toFixed(0)}
                  </span>
                </div>

                <div className="mt-6 p-3 bg-gray-800 rounded-lg border border-gray-700">
                  <div className="text-xs text-gray-400 mb-1">Status</div>
                  <div className={`text-sm font-semibold ${
                    rateLimitStats.is_throttling ? 'text-red-400' :
                    rateLimitStats.is_approaching_limit ? 'text-yellow-400' :
                    'text-green-400'
                  }`}>
                    {rateLimitStats.is_throttling ? 'System is throttling requests' :
                     rateLimitStats.is_approaching_limit ? 'Approaching rate limit' :
                     'Operating normally'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {alerts.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="text-yellow-500" size={24} />
            <h3 className="text-lg font-bold text-white">Recent Alerts</h3>
            <span className="px-2 py-1 text-xs font-medium bg-yellow-500/20 text-yellow-400 rounded">
              {alerts.length}
            </span>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {alerts.map((alert, index) => (
              <div
                key={index}
                className={`p-3 rounded-lg border ${
                  alert.severity === 'error'
                    ? 'bg-red-500/10 border-red-500/30'
                    : 'bg-yellow-500/10 border-yellow-500/30'
                }`}
              >
                <div className="flex items-start gap-3">
                  {getAlertIcon(alert.severity)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className={`text-sm font-medium ${
                        alert.severity === 'error' ? 'text-red-200' : 'text-yellow-200'
                      }`}>
                        {alert.alert_title}
                      </span>
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        {formatTimestamp(alert.alert_time)}
                      </span>
                    </div>
                    <p className={`text-xs ${
                      alert.severity === 'error' ? 'text-red-300' : 'text-yellow-300'
                    }`}>
                      {alert.alert_message}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
