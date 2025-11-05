import React, { useState, useEffect } from 'react';
import { Activity, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { persistentPricePollingService } from '@/services/persistent-price-polling-service';

export function PersistentPollingStatus() {
  const [status, setStatus] = useState(persistentPricePollingService.getStatus());
  const [health, setHealth] = useState<{
    healthy: boolean;
    details: any;
  } | null>(null);

  useEffect(() => {
    const unsubscribe = persistentPricePollingService.onStatusChange(setStatus);

    const checkHealth = async () => {
      const healthStatus = await persistentPricePollingService.checkServiceHealth();
      setHealth(healthStatus);
    };

    checkHealth();
    const interval = setInterval(checkHealth, 10000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  const formatTime = (date: Date | null): string => {
    if (!date) return 'Never';
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  };

  const getStatusColor = () => {
    if (!status.isRunning) return 'text-gray-500';
    if (health?.healthy) return 'text-green-500';
    return 'text-yellow-500';
  };

  const getStatusIcon = () => {
    if (!status.isRunning) return <AlertCircle size={16} />;
    if (health?.healthy) return <CheckCircle size={16} />;
    return <Activity size={16} />;
  };

  return (
    <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={getStatusColor()}>{getStatusIcon()}</div>
          <h3 className="text-sm font-semibold text-white">
            Persistent Price Polling
          </h3>
        </div>
        <div className={`px-2 py-1 rounded text-xs font-medium ${
          status.isRunning
            ? 'bg-green-500/20 text-green-400'
            : 'bg-gray-500/20 text-gray-400'
        }`}>
          {status.isRunning ? 'Active' : 'Inactive'}
        </div>
      </div>

      <div className="space-y-2 text-xs text-gray-400">
        <div className="flex items-center justify-between">
          <span>Total Polls:</span>
          <span className="text-white font-medium">{status.pollCount}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Successful:</span>
          <span className="text-green-400 font-medium">{status.successCount}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Failed:</span>
          <span className="text-red-400 font-medium">{status.errorCount}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Last Poll:</span>
          <span className="text-white font-medium flex items-center gap-1">
            <Clock size={12} />
            {formatTime(status.lastPollTime)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Last Success:</span>
          <span className="text-white font-medium flex items-center gap-1">
            <Clock size={12} />
            {formatTime(status.lastSuccessTime)}
          </span>
        </div>
        {health?.details && (
          <div className="flex items-center justify-between">
            <span>Success Rate:</span>
            <span className={`font-medium ${
              health.details.successRate > 80 ? 'text-green-400' :
              health.details.successRate > 50 ? 'text-yellow-400' :
              'text-red-400'
            }`}>
              {health.details.successRate.toFixed(1)}%
            </span>
          </div>
        )}
      </div>

      {status.lastError && (
        <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
          <div className="font-semibold mb-1">Last Error:</div>
          <div className="opacity-80 truncate">{status.lastError}</div>
        </div>
      )}

      {health && !health.healthy && (
        <div className="mt-3 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-xs text-yellow-400">
          <div className="flex items-center gap-1 font-semibold mb-1">
            <AlertCircle size={12} />
            Service Health Warning
          </div>
          <div className="opacity-80">
            {!health.details.pollingActive && 'Polling is not active. '}
            {health.details.lastSuccessAge && health.details.lastSuccessAge > 30000 &&
              `No successful polls in ${Math.floor(health.details.lastSuccessAge / 1000)}s. `}
            {health.details.successRate < 50 &&
              `Success rate is low (${health.details.successRate.toFixed(1)}%).`}
          </div>
        </div>
      )}
    </div>
  );
}
