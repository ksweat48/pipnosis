/**
 * Governance Alert Center Component
 *
 * Displays governance alerts for admins with:
 * - Real-time alert feed
 * - Severity filtering
 * - Mark as read/dismiss functionality
 * - Deep links to violation details
 * - Unread count badge
 *
 * Part of Phase 3.3: Governance Monitoring Alerts
 */

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { governanceAlertService, type AlertSeverity } from '../../services/governance-alert-service';
import { AlertCircle, AlertTriangle, Info, Zap, CheckCircle, X, Filter } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface GovernanceAlert {
  id: string;
  alert_type: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  metadata: any;
  violation_id: string | null;
  component_name: string | null;
  channels_sent: string[];
  read_by: string[];
  dismissed_by: string[];
  dismissed_at: string | null;
  action_url: string | null;
  created_at: string;
}

export function GovernanceAlertCenter() {
  const [alerts, setAlerts] = useState<GovernanceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSeverity, setSelectedSeverity] = useState<AlertSeverity | 'ALL'>('ALL');
  const [showDismissed, setShowDismissed] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    loadAlerts();

    // Subscribe to real-time updates
    const subscription = supabase
      .channel('governance_alerts')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'governance_alerts'
        },
        () => {
          loadAlerts();
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const loadAlerts = async () => {
    try {
      setLoading(true);
      const data = await governanceAlertService.getRecentAlerts(100);
      setAlerts(data);
    } catch (error) {
      console.error('Failed to load alerts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkAsRead = async (alertId: string) => {
    try {
      await governanceAlertService.markAsRead(alertId);
      await loadAlerts();
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  };

  const handleDismiss = async (alertId: string) => {
    try {
      await governanceAlertService.dismissAlert(alertId);
      await loadAlerts();
    } catch (error) {
      console.error('Failed to dismiss alert:', error);
    }
  };

  const handleAlertClick = (alert: GovernanceAlert) => {
    // Mark as read
    handleMarkAsRead(alert.id);

    // Navigate to action URL if provided
    if (alert.action_url) {
      navigate(alert.action_url);
    }
  };

  const getSeverityIcon = (severity: AlertSeverity) => {
    switch (severity) {
      case 'CRITICAL':
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      case 'HIGH':
        return <AlertTriangle className="w-5 h-5 text-orange-500" />;
      case 'MEDIUM':
        return <Zap className="w-5 h-5 text-yellow-500" />;
      case 'LOW':
        return <Info className="w-5 h-5 text-blue-500" />;
    }
  };

  const getSeverityColor = (severity: AlertSeverity) => {
    switch (severity) {
      case 'CRITICAL':
        return 'border-red-500 bg-red-50';
      case 'HIGH':
        return 'border-orange-500 bg-orange-50';
      case 'MEDIUM':
        return 'border-yellow-500 bg-yellow-50';
      case 'LOW':
        return 'border-blue-500 bg-blue-50';
    }
  };

  const getTimeAgo = (timestamp: string) => {
    const now = new Date();
    const then = new Date(timestamp);
    const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  const filteredAlerts = alerts.filter(alert => {
    if (!showDismissed && alert.dismissed_at) return false;
    if (selectedSeverity !== 'ALL' && alert.severity !== selectedSeverity) return false;
    return true;
  });

  const unreadCount = alerts.filter(a => !a.dismissed_at && (!a.read_by || a.read_by.length === 0)).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with Filters */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">Governance Alerts</h3>
          {unreadCount > 0 && (
            <span className="px-2 py-1 text-xs font-bold text-white bg-red-500 rounded-full">
              {unreadCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Severity Filter */}
          <div className="flex items-center gap-1 border rounded-lg p-1">
            <Filter className="w-4 h-4 text-gray-500" />
            <select
              value={selectedSeverity}
              onChange={(e) => setSelectedSeverity(e.target.value as AlertSeverity | 'ALL')}
              className="text-sm border-none focus:ring-0 cursor-pointer bg-transparent"
            >
              <option value="ALL">All</option>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
          </div>

          {/* Show Dismissed Toggle */}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={showDismissed}
              onChange={(e) => setShowDismissed(e.target.checked)}
              className="rounded border-gray-300"
            />
            Show dismissed
          </label>
        </div>
      </div>

      {/* Alert List */}
      <div className="space-y-2">
        {filteredAlerts.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <CheckCircle className="w-12 h-12 mx-auto mb-2 text-green-500" />
            <p>No alerts to display</p>
            <p className="text-sm">All systems are running smoothly!</p>
          </div>
        ) : (
          filteredAlerts.map((alert) => {
            const isUnread = !alert.read_by || alert.read_by.length === 0;
            const isDismissed = alert.dismissed_at !== null;

            return (
              <div
                key={alert.id}
                className={`border-l-4 rounded-lg p-4 transition-all ${getSeverityColor(alert.severity)} ${
                  isUnread ? 'shadow-md' : 'opacity-75'
                } ${isDismissed ? 'opacity-50' : ''} ${
                  alert.action_url ? 'cursor-pointer hover:shadow-lg' : ''
                }`}
                onClick={() => alert.action_url && handleAlertClick(alert)}
              >
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div className="flex-shrink-0 mt-0.5">
                    {getSeverityIcon(alert.severity)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold text-gray-900">{alert.title}</h4>
                          {isUnread && !isDismissed && (
                            <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
                          )}
                          {isDismissed && (
                            <span className="px-1.5 py-0.5 text-xs bg-gray-200 text-gray-600 rounded">
                              Dismissed
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-700 mt-1">{alert.message}</p>

                        {/* Metadata */}
                        <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                          <span>{getTimeAgo(alert.created_at)}</span>
                          {alert.component_name && (
                            <span className="px-2 py-0.5 bg-gray-200 rounded">
                              {alert.component_name}
                            </span>
                          )}
                          {alert.channels_sent && alert.channels_sent.length > 0 && (
                            <span className="flex items-center gap-1">
                              via {alert.channels_sent.join(', ')}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1">
                        {!isDismissed && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDismiss(alert.id);
                            }}
                            className="p-1 hover:bg-gray-200 rounded transition-colors"
                            title="Dismiss"
                          >
                            <X className="w-4 h-4 text-gray-600" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Stats */}
      {filteredAlerts.length > 0 && (
        <div className="text-sm text-gray-500 text-center pt-2 border-t">
          Showing {filteredAlerts.length} of {alerts.length} alerts
        </div>
      )}
    </div>
  );
}
