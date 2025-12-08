/**
 * Chart Health Monitor Component
 *
 * Real-time system health visibility for charts.
 * Shows candle delivery rate, polling status, memory usage, etc.
 *
 * ZERO RISK: Read-only monitoring component.
 */

import { useState, useEffect } from 'react';
import { Activity, Database, Wifi, WifiOff, AlertTriangle, CheckCircle, Clock, MemoryStick } from 'lucide-react';
import { BULLETPROOF_CONFIG } from '@/config/chart-bulletproofing';
import { chartMemoryManager } from '@/services/chart-memory-manager';
import { networkResilienceManager } from '@/services/network-resilience-manager';
import { chartMutexManager } from '@/services/chart-mutex-manager';
import { databaseResilienceWrapper } from '@/services/database-resilience-wrapper';
import { chartFailsafeManager } from '@/services/chart-failsafe-manager';

interface ChartHealthMonitorProps {
  symbol: string;
  timeframe: string;
  visible?: boolean;
}

export function ChartHealthMonitor({ symbol, timeframe, visible = false }: ChartHealthMonitorProps) {
  const [expanded, setExpanded] = useState(visible);
  const [health, setHealth] = useState({
    online: true,
    dbCache: 0,
    networkCache: 0,
    memoryUsage: 0,
    activeLocks: 0,
    failureCount: 0,
    lastUpdate: Date.now(),
  });

  useEffect(() => {
    if (!BULLETPROOF_CONFIG.enableHealthMonitoring) {
      return;
    }

    const updateHealth = () => {
      const networkState = networkResilienceManager.getNetworkState();
      const dbCache = databaseResilienceWrapper.getCacheStats();
      const memoryStats = chartMemoryManager.getStats();
      const memoryUsage = chartMemoryManager.getMemoryUsage();
      const activeLocks = chartMutexManager.getActiveLocks();
      const failsafeStats = chartFailsafeManager.getCacheStats();

      setHealth({
        online: networkState.online,
        dbCache: dbCache.size,
        networkCache: memoryStats.totalItems,
        memoryUsage: memoryUsage.percentage || 0,
        activeLocks: activeLocks.length,
        failureCount: chartFailsafeManager.getFailureCount(symbol, timeframe),
        lastUpdate: Date.now(),
      });
    };

    updateHealth();
    const interval = setInterval(updateHealth, BULLETPROOF_CONFIG.healthCheckIntervalMs);

    return () => clearInterval(interval);
  }, [symbol, timeframe]);

  if (!BULLETPROOF_CONFIG.enableHealthMonitoring) {
    return null;
  }

  const getHealthColor = () => {
    if (!health.online) return 'text-red-500';
    if (health.failureCount > 0) return 'text-yellow-500';
    return 'text-green-500';
  };

  const getHealthIcon = () => {
    if (!health.online) return <WifiOff className="w-4 h-4" />;
    if (health.failureCount > 0) return <AlertTriangle className="w-4 h-4" />;
    return <CheckCircle className="w-4 h-4" />;
  };

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className={`fixed bottom-20 right-4 p-3 rounded-full shadow-lg bg-gray-800 border border-gray-700 ${getHealthColor()} hover:scale-110 transition-transform z-50`}
        title="Chart Health Monitor"
      >
        <Activity className="w-5 h-5" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-20 right-4 w-80 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50">
      <div className="p-4 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-400" />
          <h3 className="font-semibold text-white">Chart Health</h3>
        </div>
        <button
          onClick={() => setExpanded(false)}
          className="text-gray-400 hover:text-white transition-colors"
        >
          ×
        </button>
      </div>

      <div className="p-4 space-y-3">
        {/* Overall Status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getHealthIcon()}
            <span className="text-sm text-gray-300">Overall Status</span>
          </div>
          <span className={`text-sm font-medium ${getHealthColor()}`}>
            {!health.online ? 'Offline' : health.failureCount > 0 ? 'Degraded' : 'Healthy'}
          </span>
        </div>

        {/* Network Status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {health.online ? (
              <Wifi className="w-4 h-4 text-green-500" />
            ) : (
              <WifiOff className="w-4 h-4 text-red-500" />
            )}
            <span className="text-sm text-gray-300">Network</span>
          </div>
          <span className={`text-sm ${health.online ? 'text-green-500' : 'text-red-500'}`}>
            {health.online ? 'Connected' : 'Offline'}
          </span>
        </div>

        {/* Database Cache */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-blue-400" />
            <span className="text-sm text-gray-300">DB Cache</span>
          </div>
          <span className="text-sm text-gray-400">{health.dbCache} items</span>
        </div>

        {/* Memory Usage */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MemoryStick className="w-4 h-4 text-purple-400" />
            <span className="text-sm text-gray-300">Memory</span>
          </div>
          <span className="text-sm text-gray-400">
            {health.memoryUsage > 0 ? `${health.memoryUsage.toFixed(1)}%` : 'N/A'}
          </span>
        </div>

        {/* Active Locks */}
        {health.activeLocks > 0 && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-yellow-400" />
              <span className="text-sm text-gray-300">Active Locks</span>
            </div>
            <span className="text-sm text-yellow-400">{health.activeLocks}</span>
          </div>
        )}

        {/* Failure Count */}
        {health.failureCount > 0 && (
          <div className="flex items-center justify-between p-2 bg-yellow-500/10 rounded border border-yellow-500/20">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-500" />
              <span className="text-sm text-yellow-500">Failures</span>
            </div>
            <span className="text-sm text-yellow-500 font-medium">{health.failureCount}</span>
          </div>
        )}

        {/* Symbol/Timeframe */}
        <div className="pt-3 border-t border-gray-700 text-xs text-gray-500">
          {symbol} {timeframe}
        </div>
      </div>
    </div>
  );
}
