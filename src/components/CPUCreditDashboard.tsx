import React, { useState, useEffect } from 'react';
import { Activity, AlertTriangle, CheckCircle, TrendingUp, Zap } from 'lucide-react';
import { pollingConfigService } from '@/services/polling-config-service';

export function CPUCreditDashboard() {
  const [creditUsage, setCreditUsage] = useState({
    used: 0,
    limit: 5000,
    percentage: 0,
    callsRemaining: 100,
  });

  const [usageStats, setUsageStats] = useState({
    creditsPerSecond: 0,
    callsPerSecond: 0,
    projectedUsage: 0,
  });

  const [queueStatus, setQueueStatus] = useState({
    queueLength: 0,
    inFlightCount: 0,
    cacheSize: 0,
    priorityBreakdown: {
      critical: 0,
      high: 0,
      normal: 0,
      low: 0,
    },
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setCreditUsage(pollingConfigService.getCreditUsage());
      setUsageStats(pollingConfigService.getUsageStats());
      setQueueStatus({ queueLength: 0, inFlightCount: 0, cacheSize: 0 }); // No longer using queue
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const getStatusColor = () => {
    if (creditUsage.percentage < 60) return 'text-green-400';
    if (creditUsage.percentage < 80) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getStatusIcon = () => {
    if (creditUsage.percentage < 60) return <CheckCircle className="w-5 h-5 text-green-400" />;
    if (creditUsage.percentage < 80) return <Activity className="w-5 h-5 text-yellow-400" />;
    return <AlertTriangle className="w-5 h-5 text-red-400" />;
  };

  const getStatusText = () => {
    if (creditUsage.percentage < 60) return 'Healthy';
    if (creditUsage.percentage < 80) return 'Moderate';
    return 'High Usage';
  };

  return (
    <div className="glass-card p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white mb-1">API Usage Monitor</h2>
          <p className="text-sm text-gray-400">MetaAPI CPU credit consumption</p>
        </div>
        <Zap className="w-6 h-6 text-yellow-400" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-black/40 rounded-lg p-4 border border-white/10">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-400">Current Usage (10s window)</span>
            {getStatusIcon()}
          </div>
          <div className="space-y-2">
            <div className="flex items-end gap-2">
              <span className={`text-3xl font-bold ${getStatusColor()}`}>
                {creditUsage.percentage.toFixed(1)}%
              </span>
              <span className="text-sm text-gray-500 mb-1">{getStatusText()}</span>
            </div>
            <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  creditUsage.percentage < 60
                    ? 'bg-green-400'
                    : creditUsage.percentage < 80
                    ? 'bg-yellow-400'
                    : 'bg-red-400'
                }`}
                style={{ width: `${Math.min(creditUsage.percentage, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>{creditUsage.used} / {creditUsage.limit} credits</span>
              <span>{creditUsage.callsRemaining} calls remaining</span>
            </div>
          </div>
        </div>

        <div className="bg-black/40 rounded-lg p-4 border border-white/10">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-400">Real-time Statistics</span>
            <TrendingUp className="w-4 h-4 text-blue-400" />
          </div>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-gray-500">Credits/Second</span>
                <span className="text-sm font-semibold text-white">
                  {usageStats.creditsPerSecond.toFixed(1)}
                </span>
              </div>
              <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full bg-blue-400 transition-all duration-300"
                  style={{ width: `${Math.min((usageStats.creditsPerSecond / 1000) * 100, 100)}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-gray-500">Calls/Second</span>
                <span className="text-sm font-semibold text-white">
                  {usageStats.callsPerSecond.toFixed(2)}
                </span>
              </div>
              <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full bg-purple-400 transition-all duration-300"
                  style={{ width: `${Math.min((usageStats.callsPerSecond / 20) * 100, 100)}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-gray-500">Projected Usage</span>
                <span className="text-sm font-semibold text-white">
                  {usageStats.projectedUsage.toFixed(1)}%
                </span>
              </div>
              <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full bg-emerald-400 transition-all duration-300"
                  style={{ width: `${Math.min(usageStats.projectedUsage, 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-black/40 rounded-lg p-3 border border-white/10">
          <div className="text-xs text-gray-500 mb-1">Queue Length</div>
          <div className="text-2xl font-bold text-white">{queueStatus.queueLength}</div>
        </div>

        <div className="bg-black/40 rounded-lg p-3 border border-white/10">
          <div className="text-xs text-gray-500 mb-1">In Flight</div>
          <div className="text-2xl font-bold text-white">{queueStatus.inFlightCount}</div>
        </div>

        <div className="bg-black/40 rounded-lg p-3 border border-white/10">
          <div className="text-xs text-gray-500 mb-1">Cached Prices</div>
          <div className="text-2xl font-bold text-white">{queueStatus.cacheSize}</div>
        </div>

        <div className="bg-black/40 rounded-lg p-3 border border-white/10">
          <div className="text-xs text-gray-500 mb-1">Critical Queue</div>
          <div className="text-2xl font-bold text-red-400">{queueStatus.priorityBreakdown.critical}</div>
        </div>
      </div>

      <div className="bg-black/40 rounded-lg p-4 border border-white/10">
        <div className="text-sm font-medium text-gray-300 mb-3">Priority Queue Breakdown</div>
        <div className="space-y-2">
          {Object.entries(queueStatus.priorityBreakdown).map(([priority, count]) => (
            <div key={priority} className="flex items-center gap-3">
              <div className="w-20 text-xs text-gray-500 capitalize">{priority}</div>
              <div className="flex-1 bg-white/10 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    priority === 'critical'
                      ? 'bg-red-400'
                      : priority === 'high'
                      ? 'bg-orange-400'
                      : priority === 'normal'
                      ? 'bg-blue-400'
                      : 'bg-gray-400'
                  }`}
                  style={{
                    width: `${
                      queueStatus.queueLength > 0 ? (count / queueStatus.queueLength) * 100 : 0
                    }%`,
                  }}
                />
              </div>
              <div className="w-8 text-right text-sm text-white font-semibold">{count}</div>
            </div>
          ))}
        </div>
      </div>

      {creditUsage.percentage > 80 && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-medium text-red-400 mb-1">High API Usage Warning</div>
              <p className="text-xs text-gray-400">
                You're approaching the rate limit. Consider reducing polling speed or the number of
                monitored symbols. The system will automatically throttle requests if necessary.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
        <h3 className="text-sm font-medium text-blue-400 mb-2">Rate Limit Guidelines</h3>
        <div className="text-xs text-gray-400 space-y-1">
          <p>• Limit: 5,000 CPU credits per 10 seconds</p>
          <p>• Cost: 50 credits per price request</p>
          <p>• Maximum: 100 requests per 10 seconds (~10 requests/second)</p>
          <p>• System automatically manages priority and throttling</p>
        </div>
      </div>
    </div>
  );
}
