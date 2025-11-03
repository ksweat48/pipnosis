import React, { useEffect, useState } from 'react';
import { globalPollingCoordinator, CoordinatorStatus } from '@/services/global-polling-coordinator';
import { Activity, Pause, Clock, TrendingUp, RefreshCw, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { getTimeUntilMarketChange } from '@/utils/marketHours';

export function GlobalPollingStatus() {
  const [status, setStatus] = useState<CoordinatorStatus | null>(null);
  const [timeUntilChange, setTimeUntilChange] = useState<{ hours: number; minutes: number; isOpening: boolean } | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);

  useEffect(() => {
    const unsubscribe = globalPollingCoordinator.onStatusChange((newStatus) => {
      setStatus(newStatus);
    });

    const updateTimer = setInterval(() => {
      setTimeUntilChange(getTimeUntilMarketChange());
    }, 1000);

    return () => {
      unsubscribe();
      clearInterval(updateTimer);
    };
  }, []);

  if (!status) {
    return null;
  }

  const getStatusColor = () => {
    if (!status.isRunning) return 'text-gray-500';
    if (status.isPaused) return 'text-yellow-500';
    if (status.activePairs > 0) return 'text-green-500';
    if (status.totalErrors > status.totalSuccesses && status.totalErrors > 10) return 'text-red-500';
    return 'text-orange-500';
  };

  const getStatusText = () => {
    if (!status.isRunning) return 'Offline';
    if (status.isPaused) {
      if (status.pauseReason === 'market_closed') return 'Paused - Market Closed';
      if (status.pauseReason === 'manual') return 'Paused - Manual';
    }
    if (status.activePairs > 0) return 'Live';
    if (status.totalErrors > 10 && status.totalSuccesses === 0) return 'Connection Issues';
    return 'Connecting...';
  };

  const getStatusIcon = () => {
    if (!status.isRunning) return <Clock className="w-3 h-3" />;
    if (status.isPaused) return <Pause className="w-3 h-3" />;
    if (status.activePairs > 0) return <Activity className="w-3 h-3 animate-pulse" />;
    if (status.totalErrors > 10 && status.totalSuccesses === 0) return <AlertCircle className="w-3 h-3" />;
    return <TrendingUp className="w-3 h-3" />;
  };

  const formatLastPoll = () => {
    if (!status.lastSuccessfulPoll) return 'Never';
    const secondsAgo = Math.floor((Date.now() - status.lastSuccessfulPoll.getTime()) / 1000);
    if (secondsAgo < 10) return 'Just now';
    if (secondsAgo < 60) return `${secondsAgo}s ago`;
    const minutesAgo = Math.floor(secondsAgo / 60);
    if (minutesAgo < 60) return `${minutesAgo}m ago`;
    const hoursAgo = Math.floor(minutesAgo / 60);
    return `${hoursAgo}h ago`;
  };

  const handleRestart = async () => {
    setIsRestarting(true);
    try {
      globalPollingCoordinator.restartPolling();
      setTimeout(() => setIsRestarting(false), 2000);
    } catch (error) {
      console.error('Failed to restart polling:', error);
      setIsRestarting(false);
    }
  };

  const getPairStatusIcon = (pairStatus: string) => {
    switch (pairStatus) {
      case 'active':
        return <CheckCircle className="w-3 h-3 text-green-500" />;
      case 'stale':
        return <Clock className="w-3 h-3 text-yellow-500" />;
      case 'error':
        return <XCircle className="w-3 h-3 text-red-500" />;
      default:
        return <Activity className="w-3 h-3 text-gray-500 animate-pulse" />;
    }
  };

  return (
    <div className="glass-card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={getStatusColor()}>
            {getStatusIcon()}
          </div>
          <div className="text-xs font-medium text-gray-300">
            Market Data
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`text-xs font-semibold ${getStatusColor()}`}>
            {getStatusText()}
          </div>
          {status.isRunning && !status.isPaused && (
            <button
              onClick={handleRestart}
              disabled={isRestarting}
              className="p-1 hover:bg-white/10 rounded transition-colors disabled:opacity-50"
              title="Restart polling"
            >
              <RefreshCw className={`w-3 h-3 text-gray-400 ${isRestarting ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {status.isRunning && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="text-gray-500">Active Pairs</div>
            <div className="text-gray-300 font-medium">
              {status.activePairs}/{status.totalPairs}
            </div>
          </div>
          <div>
            <div className="text-gray-500">Last Tick</div>
            <div className="text-gray-300 font-medium">
              {formatLastPoll()}
            </div>
          </div>
          <div>
            <div className="text-gray-500">Successes</div>
            <div className="text-green-400 font-medium">
              {status.totalSuccesses}
            </div>
          </div>
          <div>
            <div className="text-gray-500">Errors</div>
            <div className="text-red-400 font-medium">
              {status.totalErrors}
            </div>
          </div>
        </div>
      )}

      {status.isRunning && status.totalErrors > 10 && status.totalSuccesses === 0 && (
        <div className="text-xs text-red-400 border-t border-white/5 pt-2">
          <div className="font-medium mb-1">Connection Issues Detected</div>
          <div className="text-gray-400">Click the refresh button to restart polling</div>
        </div>
      )}

      {status.isRunning && status.pairStatuses && (
        <div className="border-t border-white/5 pt-2">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-xs text-gray-400 hover:text-gray-300 transition-colors w-full text-left"
          >
            {showDetails ? '▼' : '▶'} Pair Status Details
          </button>

          {showDetails && (
            <div className="mt-2 space-y-1 max-h-60 overflow-y-auto">
              {status.pairStatuses.map(pair => (
                <div
                  key={pair.symbol}
                  className="flex items-center justify-between text-xs p-1.5 rounded bg-white/5"
                >
                  <div className="flex items-center gap-2">
                    {getPairStatusIcon(pair.status)}
                    <span className="text-gray-300 font-medium w-16">{pair.symbol}</span>
                  </div>
                  <div className="flex items-center gap-3 text-gray-400">
                    {pair.lastPrice && (
                      <span className="text-emerald-400 text-[10px]">
                        {pair.lastPrice.bid.toFixed(5)}
                      </span>
                    )}
                    {pair.status === 'error' && pair.lastError && (
                      <span className="text-red-400 text-[10px] max-w-[100px] truncate" title={pair.lastError}>
                        {pair.lastError}
                      </span>
                    )}
                    {pair.status === 'stale' && (
                      <span className="text-yellow-400 text-[10px]">
                        Retrying...
                      </span>
                    )}
                    <span className="text-[10px]">
                      ✓{pair.successCount} ✗{pair.errorCount}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {status.isPaused && status.pauseReason === 'market_closed' && timeUntilChange && timeUntilChange.isOpening && (
        <div className="text-xs text-gray-400 border-t border-white/5 pt-2">
          Market opens in {timeUntilChange.hours}h {timeUntilChange.minutes}m
        </div>
      )}

      {!status.marketOpen && !status.isPaused && (
        <div className="text-xs text-yellow-500/80 border-t border-white/5 pt-2">
          Polling during market closed hours
        </div>
      )}
    </div>
  );
}
