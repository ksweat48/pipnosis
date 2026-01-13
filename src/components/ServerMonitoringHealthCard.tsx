/**
 * Server Monitoring Health Card
 *
 * Displays real-time health status of server-side entry monitoring
 * Shows alerts when monitoring degrades
 */

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { AlertTriangle, CheckCircle, Clock, TrendingUp, XCircle } from 'lucide-react';

interface HealthStatus {
  is_healthy: boolean;
  last_check_age_seconds: number;
  recent_success_rate: number;
  active_alerts: number;
  details: {
    last_check_timestamp: string | null;
    status: 'healthy' | 'degraded';
    recommendation: string;
  };
}

interface Alert {
  id: string;
  alert_type: string;
  severity: 'warning' | 'error' | 'critical';
  message: string;
  details: any;
  created_at: string;
  acknowledged: boolean;
}

export function ServerMonitoringHealthCard() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHealth();
    fetchAlerts();

    // Refresh every 30 seconds
    const interval = setInterval(() => {
      fetchHealth();
      fetchAlerts();
    }, 30000);

    // Subscribe to realtime alerts
    const subscription = supabase
      .channel('server_monitoring_alerts')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'server_monitoring_alerts',
          filter: `acknowledged=eq.false`
        },
        () => {
          fetchAlerts();
        }
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      subscription.unsubscribe();
    };
  }, []);

  const fetchHealth = async () => {
    try {
      const { data, error } = await supabase.rpc('get_server_monitoring_health_status');

      if (error) {
        console.error('Failed to fetch server monitoring health:', error);
        return;
      }

      if (data && data.length > 0) {
        setHealth(data[0]);
      }
    } catch (error) {
      console.error('Error fetching health:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAlerts = async () => {
    try {
      const { data, error } = await supabase
        .from('server_monitoring_alerts')
        .select('*')
        .eq('acknowledged', false)
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) {
        console.error('Failed to fetch alerts:', error);
        return;
      }

      setAlerts(data || []);
    } catch (error) {
      console.error('Error fetching alerts:', error);
    }
  };

  const acknowledgeAlert = async (alertId: string) => {
    try {
      const { error } = await supabase
        .from('server_monitoring_alerts')
        .update({
          acknowledged: true,
          acknowledged_at: new Date().toISOString()
        })
        .eq('id', alertId);

      if (error) {
        console.error('Failed to acknowledge alert:', error);
        return;
      }

      setAlerts(prev => prev.filter(a => a.id !== alertId));
    } catch (error) {
      console.error('Error acknowledging alert:', error);
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-700 rounded w-1/3 mb-2"></div>
          <div className="h-3 bg-gray-700 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (!health) {
    return null;
  }

  const statusColor = health.is_healthy
    ? 'text-green-400'
    : health.details.status === 'degraded'
    ? 'text-yellow-400'
    : 'text-red-400';

  const StatusIcon = health.is_healthy
    ? CheckCircle
    : health.details.status === 'degraded'
    ? AlertTriangle
    : XCircle;

  return (
    <div className="space-y-3">
      {/* Health Status Card */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <StatusIcon className={`w-5 h-5 ${statusColor}`} />
            <h3 className="text-sm font-medium text-white">Server Monitoring</h3>
          </div>
          <span className={`text-xs font-medium ${statusColor}`}>
            {health.details.status.toUpperCase()}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="flex items-center gap-1 text-gray-400 text-xs mb-1">
              <Clock className="w-3 h-3" />
              <span>Last Check</span>
            </div>
            <div className="text-sm font-medium text-white">
              {health.last_check_age_seconds < 60
                ? `${health.last_check_age_seconds}s ago`
                : `${Math.floor(health.last_check_age_seconds / 60)}m ago`}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1 text-gray-400 text-xs mb-1">
              <TrendingUp className="w-3 h-3" />
              <span>Success Rate</span>
            </div>
            <div className="text-sm font-medium text-white">
              {health.recent_success_rate.toFixed(1)}%
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1 text-gray-400 text-xs mb-1">
              <AlertTriangle className="w-3 h-3" />
              <span>Alerts</span>
            </div>
            <div className="text-sm font-medium text-white">
              {health.active_alerts}
            </div>
          </div>
        </div>

        {!health.is_healthy && (
          <div className="mt-3 pt-3 border-t border-gray-700">
            <p className="text-xs text-gray-400">{health.details.recommendation}</p>
          </div>
        )}
      </div>

      {/* Active Alerts */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map(alert => (
            <div
              key={alert.id}
              className={`bg-gray-800 rounded-lg p-3 border ${
                alert.severity === 'critical'
                  ? 'border-red-500'
                  : alert.severity === 'error'
                  ? 'border-orange-500'
                  : 'border-yellow-500'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle
                      className={`w-4 h-4 flex-shrink-0 ${
                        alert.severity === 'critical'
                          ? 'text-red-400'
                          : alert.severity === 'error'
                          ? 'text-orange-400'
                          : 'text-yellow-400'
                      }`}
                    />
                    <span className="text-xs font-medium text-white truncate">
                      {alert.alert_type.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">{alert.message}</p>
                  {alert.details?.recommended_action && (
                    <p className="text-xs text-gray-500 mt-1">
                      {alert.details.recommended_action}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => acknowledgeAlert(alert.id)}
                  className="text-xs text-gray-400 hover:text-white transition-colors flex-shrink-0"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
