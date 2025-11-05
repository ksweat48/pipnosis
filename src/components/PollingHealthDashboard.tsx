import React, { useEffect, useState } from 'react';
import { Activity, CheckCircle, XCircle, AlertTriangle, RefreshCw, Wifi, WifiOff, Clock, TrendingUp } from 'lucide-react';
import { globalPollingCoordinator, CoordinatorStatus } from '@/services/global-polling-coordinator';
import { backgroundCandleAggregator } from '@/services/background-candle-aggregator';

interface AggregatorStatus {
  isRunning: boolean;
  activeCandleStates: number;
  saveQueueLength: number;
  listenerCount: number;
  symbols: number;
  timeframes: number;
  totalCombinations: number;
  reconnectAttempts: number;
  lastMessageTime: Date | null;
  timeSinceLastMessageMs: number | null;
  connectionHealthy: boolean;
}

export function PollingHealthDashboard() {
  const [coordinatorStatus, setCoordinatorStatus] = useState<CoordinatorStatus | null>(null);
  const [aggregatorStatus, setAggregatorStatus] = useState<AggregatorStatus | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showDetails, setShowDetails] = useState(true);

  useEffect(() => {
    const updateStatus = () => {
      setCoordinatorStatus(globalPollingCoordinator.getCoordinatorStatus());
      setAggregatorStatus(backgroundCandleAggregator.getStatus());
    };

    updateStatus();
    const interval = setInterval(updateStatus, 5000);

    const unsubscribe = globalPollingCoordinator.onStatusChange(setCoordinatorStatus);

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    globalPollingCoordinator.restartPolling();
    setTimeout(() => setIsRefreshing(false), 2000);
  };

  const formatTime = (date: Date | null): string => {
    if (!date) return 'Never';
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 5) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  };

  const getOverallHealth = (): 'healthy' | 'degraded' | 'critical' => {
    if (!coordinatorStatus || !aggregatorStatus) return 'critical';

    const activeRatio = coordinatorStatus.activePairs / coordinatorStatus.totalPairs;
    const hasRecentSuccess = coordinatorStatus.lastSuccessfulPoll &&
      (Date.now() - coordinatorStatus.lastSuccessfulPoll.getTime()) < 30000;

    if (coordinatorStatus.isRunning && activeRatio >= 0.8 && hasRecentSuccess && aggregatorStatus.connectionHealthy) {
      return 'healthy';
    } else if (coordinatorStatus.isRunning && activeRatio >= 0.5) {
      return 'degraded';
    }
    return 'critical';
  };

  const overallHealth = getOverallHealth();

  if (!coordinatorStatus || !aggregatorStatus) {
    return (
      <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-6">
        <div className="flex items-center gap-3">
          <div className="animate-spin">
            <RefreshCw size={20} className="text-gray-400" />
          </div>
          <span className="text-gray-400">Loading polling status...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            {overallHealth === 'healthy' && (
              <CheckCircle className="text-green-500 animate-pulse" size={24} />
            )}
            {overallHealth === 'degraded' && (
              <AlertTriangle className="text-yellow-500 animate-pulse" size={24} />
            )}
            {overallHealth === 'critical' && (
              <XCircle className="text-red-500 animate-pulse" size={24} />
            )}
            <div>
              <h3 className="text-lg font-semibold text-white">
                Persistent Polling Health Monitor
              </h3>
              <p className="text-sm text-gray-400">
                {overallHealth === 'healthy' && 'All systems operational'}
                {overallHealth === 'degraded' && 'Some issues detected'}
                {overallHealth === 'critical' && 'Critical issues present'}
              </p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-600 text-white rounded-lg transition-colors"
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
            <span className="text-sm font-medium">Restart Polling</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400 text-sm">Active Pairs</span>
              <Activity className="text-emerald-500" size={16} />
            </div>
            <div className="text-2xl font-bold text-white">
              {coordinatorStatus.activePairs}/{coordinatorStatus.totalPairs}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {Math.round((coordinatorStatus.activePairs / coordinatorStatus.totalPairs) * 100)}% operational
            </div>
          </div>

          <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400 text-sm">Success Rate</span>
              <TrendingUp className="text-blue-500" size={16} />
            </div>
            <div className="text-2xl font-bold text-white">
              {coordinatorStatus.totalSuccesses > 0
                ? Math.round((coordinatorStatus.totalSuccesses / (coordinatorStatus.totalSuccesses + coordinatorStatus.totalErrors)) * 100)
                : 0}%
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {coordinatorStatus.totalSuccesses} success / {coordinatorStatus.totalErrors} errors
            </div>
          </div>

          <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400 text-sm">Last Update</span>
              <Clock className="text-yellow-500" size={16} />
            </div>
            <div className="text-xl font-bold text-white">
              {formatTime(coordinatorStatus.lastSuccessfulPoll)}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Most recent successful poll
            </div>
          </div>

          <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400 text-sm">Realtime Feed</span>
              {aggregatorStatus.connectionHealthy ? (
                <Wifi className="text-green-500" size={16} />
              ) : (
                <WifiOff className="text-red-500" size={16} />
              )}
            </div>
            <div className="text-xl font-bold text-white">
              {aggregatorStatus.connectionHealthy ? 'Connected' : 'Degraded'}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {aggregatorStatus.timeSinceLastMessageMs !== null
                ? `${Math.round(aggregatorStatus.timeSinceLastMessageMs / 1000)}s since last message`
                : 'No messages yet'}
            </div>
          </div>
        </div>

        <div className="bg-gray-900/30 rounded-lg p-4 border border-gray-700/50 mb-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Market Status:</span>
              <span className={`ml-2 font-medium ${
                coordinatorStatus.marketOpen ? 'text-green-400' : 'text-red-400'
              }`}>
                {coordinatorStatus.marketOpen ? 'Open' : 'Closed'}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Polling Status:</span>
              <span className={`ml-2 font-medium ${
                coordinatorStatus.isRunning && !coordinatorStatus.isPaused
                  ? 'text-green-400'
                  : 'text-yellow-400'
              }`}>
                {coordinatorStatus.isPaused ? 'Paused' : 'Running'}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Active Candles:</span>
              <span className="ml-2 font-medium text-blue-400">
                {aggregatorStatus.activeCandleStates}/{aggregatorStatus.totalCombinations}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Reconnect Attempts:</span>
              <span className={`ml-2 font-medium ${
                aggregatorStatus.reconnectAttempts === 0 ? 'text-green-400' : 'text-yellow-400'
              }`}>
                {aggregatorStatus.reconnectAttempts}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={() => setShowDetails(!showDetails)}
          className="w-full text-center text-sm text-gray-400 hover:text-gray-300 transition-colors py-2"
        >
          {showDetails ? '▼ Hide Details' : '▶ Show Details'}
        </button>

        {showDetails && (
          <div className="mt-4 space-y-3 max-h-96 overflow-y-auto">
            <div className="text-sm font-semibold text-gray-300 mb-2">Per-Pair Status</div>
            {coordinatorStatus.pairStatuses.map(pair => (
              <div
                key={pair.symbol}
                className={`bg-gray-900/50 rounded-lg p-3 border ${
                  pair.status === 'active'
                    ? 'border-green-500/30'
                    : pair.status === 'stale'
                    ? 'border-yellow-500/30'
                    : 'border-red-500/30'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {pair.status === 'active' && <CheckCircle className="text-green-500" size={16} />}
                    {pair.status === 'stale' && <AlertTriangle className="text-yellow-500" size={16} />}
                    {pair.status === 'error' && <XCircle className="text-red-500" size={16} />}
                    {pair.status === 'starting' && <Activity className="text-gray-500 animate-pulse" size={16} />}
                    <span className="font-mono font-semibold text-white">{pair.symbol}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    {pair.lastPrice && (
                      <span className="text-emerald-400 font-mono">
                        {pair.lastPrice.bid.toFixed(5)}
                      </span>
                    )}
                    <span className="text-gray-500">
                      ✓{pair.successCount} ✗{pair.errorCount}
                    </span>
                    {pair.lastSuccessfulPoll && (
                      <span className="text-gray-400">
                        {formatTime(pair.lastSuccessfulPoll)}
                      </span>
                    )}
                  </div>
                </div>
                {pair.lastError && pair.status === 'error' && (
                  <div className="mt-2 text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">
                    {pair.lastError}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {coordinatorStatus.isPaused && (
          <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <div className="flex items-center gap-2 text-yellow-500">
              <AlertTriangle size={16} />
              <span className="text-sm font-medium">
                Polling Paused: {coordinatorStatus.pauseReason === 'market_closed' ? 'Market Closed' : 'Manual Pause'}
              </span>
            </div>
          </div>
        )}

        <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <div className="flex items-center gap-2 text-blue-400 text-sm">
            <Activity size={14} />
            <span className="font-medium">
              Polling is persistent and continues regardless of page visibility or navigation.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
