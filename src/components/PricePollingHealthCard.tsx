import React from 'react';
import { TrendingUp, Activity, Clock, AlertTriangle } from 'lucide-react';
import type { PricePollingStats, PriceDataFreshness } from '@/services/system-monitoring-service';

interface PricePollingHealthCardProps {
  stats: PricePollingStats;
  freshness: PriceDataFreshness[];
}

export function PricePollingHealthCard({ stats, freshness }: PricePollingHealthCardProps) {
  const getSuccessRateColor = (rate: number) => {
    if (rate >= 95) return 'text-green-500';
    if (rate >= 80) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getSuccessRateBg = (rate: number) => {
    if (rate >= 95) return 'bg-green-500/20';
    if (rate >= 80) return 'bg-yellow-500/20';
    return 'bg-red-500/20';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return 'text-green-500';
      case 'STALE':
        return 'text-yellow-500';
      case 'INACTIVE':
      case 'NO_DATA':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  };

  const getStatusBadge = (status: string) => {
    const colors = {
      ACTIVE: 'bg-green-500/20 text-green-400',
      STALE: 'bg-yellow-500/20 text-yellow-400',
      INACTIVE: 'bg-red-500/20 text-red-400',
      NO_DATA: 'bg-gray-500/20 text-gray-400',
    };

    return colors[status as keyof typeof colors] || colors.NO_DATA;
  };

  const formatTimeSince = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds)}s ago`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
    return `${Math.round(seconds / 3600)}h ago`;
  };

  return (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
      <div className="flex items-center gap-3 mb-4">
        <TrendingUp className="text-emerald-500" size={24} />
        <h3 className="text-lg font-bold text-white">Price Polling Health</h3>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-gray-900 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="text-blue-400" size={16} />
            <span className="text-xs text-gray-400">Total Polls</span>
          </div>
          <div className="text-2xl font-bold text-white">{stats.total_polls}</div>
          <div className="text-xs text-gray-500 mt-1">Last hour</div>
        </div>

        <div className="bg-gray-900 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity className={getSuccessRateColor(stats.success_rate)} size={16} />
            <span className="text-xs text-gray-400">Success Rate</span>
          </div>
          <div className={`text-2xl font-bold ${getSuccessRateColor(stats.success_rate)}`}>
            {stats.success_rate.toFixed(1)}%
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {stats.successful_polls} / {stats.total_polls}
          </div>
        </div>

        <div className="bg-gray-900 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="text-purple-400" size={16} />
            <span className="text-xs text-gray-400">Avg Duration</span>
          </div>
          <div className="text-2xl font-bold text-white">
            {stats.avg_duration_ms.toFixed(0)}ms
          </div>
          <div className="text-xs text-gray-500 mt-1">Per poll</div>
        </div>

        <div className="bg-gray-900 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="text-orange-400" size={16} />
            <span className="text-xs text-gray-400">Last Poll</span>
          </div>
          <div className="text-2xl font-bold text-white">
            {stats.seconds_since_last_poll}s
          </div>
          <div className="text-xs text-gray-500 mt-1">ago</div>
        </div>
      </div>

      {stats.failed_polls > 0 && (
        <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-start gap-2">
          <AlertTriangle className="text-yellow-500 flex-shrink-0 mt-0.5" size={16} />
          <div className="text-xs text-yellow-200">
            {stats.failed_polls} failed poll{stats.failed_polls !== 1 ? 's' : ''} in the last hour
          </div>
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold text-gray-300 mb-3">Symbol Status</h4>
        <div className="space-y-2">
          {freshness.map(item => (
            <div
              key={item.symbol}
              className="flex items-center justify-between p-3 bg-gray-900 rounded-lg"
            >
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${
                  item.status === 'ACTIVE' ? 'bg-green-500 animate-pulse' :
                  item.status === 'STALE' ? 'bg-yellow-500' :
                  'bg-red-500'
                }`} />
                <span className="text-sm font-medium text-white">{item.symbol}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400">
                  {formatTimeSince(item.seconds_since_last_price)}
                </span>
                <span className={`px-2 py-1 text-xs font-medium rounded ${getStatusBadge(item.status)}`}>
                  {item.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
