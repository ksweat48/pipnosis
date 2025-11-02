import React, { useEffect, useState } from 'react';
import { globalPollingCoordinator, CoordinatorStatus } from '@/services/global-polling-coordinator';
import { Activity, Pause, Clock, TrendingUp } from 'lucide-react';
import { getTimeUntilMarketChange } from '@/utils/marketHours';

export function GlobalPollingStatus() {
  const [status, setStatus] = useState<CoordinatorStatus | null>(null);
  const [timeUntilChange, setTimeUntilChange] = useState<{ hours: number; minutes: number; isOpening: boolean } | null>(null);

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
    return 'text-orange-500';
  };

  const getStatusText = () => {
    if (!status.isRunning) return 'Offline';
    if (status.isPaused) {
      if (status.pauseReason === 'market_closed') return 'Paused - Market Closed';
      if (status.pauseReason === 'manual') return 'Paused - Manual';
    }
    if (status.activePairs > 0) return 'Live';
    return 'Connecting...';
  };

  const getStatusIcon = () => {
    if (!status.isRunning) return <Clock className="w-3 h-3" />;
    if (status.isPaused) return <Pause className="w-3 h-3" />;
    if (status.activePairs > 0) return <Activity className="w-3 h-3 animate-pulse" />;
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
        <div className={`text-xs font-semibold ${getStatusColor()}`}>
          {getStatusText()}
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
        </div>
      )}

      {status.isPaused && status.pauseReason === 'market_closed' && timeUntilChange && timeUntilChange.isOpening && (
        <div className="text-xs text-gray-400 border-t border-white/5 pt-2">
          Market opens in {timeUntilChange.hours}h {timeUntilChange.minutes}m
        </div>
      )}

      {!status.marketOpen && !status.isPaused && (
        <div className="text-xs text-yellow-500/80 border-t border-white/5 pt-2">
          ⚠️ Polling during market closed hours
        </div>
      )}
    </div>
  );
}
