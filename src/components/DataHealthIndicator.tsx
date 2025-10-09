import React, { useEffect, useState } from 'react';
import { Database, AlertCircle, CheckCircle } from 'lucide-react';
import { dbHealthMonitor, DatabaseHealthStatus, DatabaseHealthMetrics } from '../services/db-health-monitor';

export const DataHealthIndicator: React.FC = () => {
  const [metrics, setMetrics] = useState<DatabaseHealthMetrics | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    const handleUpdate = (newMetrics: DatabaseHealthMetrics) => {
      setMetrics(newMetrics);
    };

    dbHealthMonitor.on('health-update', handleUpdate);

    const currentMetrics = dbHealthMonitor.getMetrics();
    setMetrics(currentMetrics);

    return () => {
      dbHealthMonitor.off('health-update', handleUpdate);
    };
  }, []);

  if (!metrics) return null;

  const getStatusColor = (status: DatabaseHealthStatus): string => {
    switch (status) {
      case 'healthy':
        return 'bg-emerald-500';
      case 'degraded':
        return 'bg-yellow-500';
      case 'critical':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getStatusText = (status: DatabaseHealthStatus): string => {
    switch (status) {
      case 'healthy':
        return 'Data Healthy';
      case 'degraded':
        return 'Data Degraded';
      case 'critical':
        return 'Data Critical';
      default:
        return 'Data Unknown';
    }
  };

  const getStatusIcon = (status: DatabaseHealthStatus) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle className="h-3 w-3 text-emerald-400" />;
      case 'degraded':
      case 'critical':
        return <AlertCircle className="h-3 w-3 text-red-400" />;
      default:
        return <Database className="h-3 w-3 text-gray-400" />;
    }
  };

  const shouldShowWarning = metrics.status === 'degraded' || metrics.status === 'critical';

  return (
    <div className="relative">
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="flex items-center space-x-2 px-2 py-1 rounded-lg hover:bg-white/5 transition-colors"
        title={getStatusText(metrics.status)}
      >
        <div className={`w-2 h-2 rounded-full ${getStatusColor(metrics.status)} ${metrics.status === 'healthy' ? 'animate-pulse' : ''}`} />
        {shouldShowWarning && (
          <span className="text-xs text-white/70">{getStatusText(metrics.status)}</span>
        )}
      </button>

      {showDetails && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-slate-900/95 backdrop-blur-sm border border-white/20 rounded-lg shadow-xl z-50 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              {getStatusIcon(metrics.status)}
              <span className="text-sm font-semibold text-white">{getStatusText(metrics.status)}</span>
            </div>
            <div className={`w-3 h-3 rounded-full ${getStatusColor(metrics.status)}`} />
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-white/60">Connectivity:</span>
              <span className={metrics.connectivity ? 'text-emerald-400' : 'text-red-400'}>
                {metrics.connectivity ? 'Connected' : 'Disconnected'}
              </span>
            </div>

            {metrics.latency !== null && (
              <div className="flex justify-between">
                <span className="text-white/60">Latency:</span>
                <span className="text-white">{metrics.latency.toFixed(0)}ms</span>
              </div>
            )}

            <div className="flex justify-between">
              <span className="text-white/60">Error Rate:</span>
              <span className={metrics.errorRate > 20 ? 'text-red-400' : 'text-white'}>
                {metrics.errorRate.toFixed(1)}%
              </span>
            </div>

            {metrics.consecutiveFailures > 0 && (
              <div className="flex justify-between">
                <span className="text-white/60">Failed Attempts:</span>
                <span className="text-red-400">{metrics.consecutiveFailures}</span>
              </div>
            )}

            {metrics.lastSuccessfulWrite && (
              <div className="flex justify-between">
                <span className="text-white/60">Last Write:</span>
                <span className="text-white">
                  {new Date(metrics.lastSuccessfulWrite).toLocaleTimeString()}
                </span>
              </div>
            )}

            {metrics.lastError && (
              <div className="mt-2 pt-2 border-t border-white/10">
                <div className="text-white/60 mb-1">Error Details:</div>
                <div className="text-red-400 text-xs break-words">
                  {dbHealthMonitor.getDetailedErrorMessage()}
                </div>
                {dbHealthMonitor.getActionableMessage() && (
                  <div className="mt-2 p-2 bg-blue-500/10 border border-blue-500/30 rounded text-xs text-blue-300 break-words">
                    {dbHealthMonitor.getActionableMessage()}
                  </div>
                )}
                {metrics.errorCode && (
                  <div className="text-white/40 text-xs mt-2">
                    Code: {metrics.errorCode}
                  </div>
                )}
                {metrics.errorType && (
                  <div className="text-white/40 text-xs mt-1 capitalize">
                    Type: {metrics.errorType.replace('_', ' ')}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-3 pt-3 border-t border-white/10 text-xs text-white/50">
            Updated: {new Date(metrics.checkedAt).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
};
