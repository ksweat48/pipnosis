import React from 'react';
import { BarChart3, TrendingUp, Clock, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import type { CandleGenerationMetrics } from '@/services/system-monitoring-service';

interface CandleGenerationStatsCardProps {
  metrics: CandleGenerationMetrics[];
}

export function CandleGenerationStatsCard({ metrics }: CandleGenerationStatsCardProps) {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <CheckCircle className="text-green-500" size={14} />;
      case 'stale':
        return <AlertTriangle className="text-yellow-500" size={14} />;
      case 'inactive':
        return <XCircle className="text-red-500" size={14} />;
      default:
        return <Clock className="text-gray-500" size={14} />;
    }
  };

  const getStatusBadge = (status: string) => {
    const badges = {
      active: 'bg-green-500/20 text-green-400',
      stale: 'bg-yellow-500/20 text-yellow-400',
      inactive: 'bg-red-500/20 text-red-400',
    };
    return badges[status as keyof typeof badges] || 'bg-gray-500/20 text-gray-400';
  };

  const formatTimeSince = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h`;
  };

  const totalActiveCandles = metrics.reduce((sum, m) => sum + m.active_candles, 0);
  const totalTicks = metrics.reduce((sum, m) => sum + m.total_ticks, 0);
  const activeTimeframes = metrics.filter(m => m.status === 'active').length;

  return (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
      <div className="flex items-center gap-3 mb-4">
        <BarChart3 className="text-blue-500" size={24} />
        <h3 className="text-lg font-bold text-white">Candle Generation</h3>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-900 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="text-emerald-400" size={16} />
            <span className="text-xs text-gray-400">Active Candles</span>
          </div>
          <div className="text-2xl font-bold text-white">{totalActiveCandles}</div>
          <div className="text-xs text-gray-500 mt-1">In progress</div>
        </div>

        <div className="bg-gray-900 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="text-blue-400" size={16} />
            <span className="text-xs text-gray-400">Total Ticks</span>
          </div>
          <div className="text-2xl font-bold text-white">{totalTicks.toLocaleString()}</div>
          <div className="text-xs text-gray-500 mt-1">Processed</div>
        </div>

        <div className="bg-gray-900 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="text-green-400" size={16} />
            <span className="text-xs text-gray-400">Active Timeframes</span>
          </div>
          <div className="text-2xl font-bold text-white">
            {activeTimeframes}/{metrics.length}
          </div>
          <div className="text-xs text-gray-500 mt-1">Running</div>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-300 mb-3">Timeframe Status</h4>
        <div className="space-y-2">
          {metrics.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-sm">
              No active candle generation
            </div>
          ) : (
            metrics.map(metric => (
              <div
                key={metric.timeframe}
                className="bg-gray-900 rounded-lg p-3 border border-gray-700/50"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(metric.status)}
                    <span className="text-sm font-medium text-white">
                      {metric.timeframe}
                    </span>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${getStatusBadge(metric.status)}`}>
                      {metric.status}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">
                    {formatTimeSince(metric.seconds_since_update)} ago
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-3 text-xs">
                  <div>
                    <div className="text-gray-500">Symbols</div>
                    <div className="text-white font-medium">{metric.symbols_tracked}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Active</div>
                    <div className="text-white font-medium">{metric.active_candles}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Ticks</div>
                    <div className="text-white font-medium">{metric.total_ticks.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Avg/Candle</div>
                    <div className="text-white font-medium">{metric.avg_ticks_per_candle}</div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
