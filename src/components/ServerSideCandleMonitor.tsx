import React, { useState, useEffect } from 'react';
import { Activity, CheckCircle, XCircle, AlertCircle, TrendingUp } from 'lucide-react';
import { candleSystemMonitor, CandleSystemHealth, PriceDataStatus } from '@/services/candle-system-monitor';

export const ServerSideCandleMonitor: React.FC = () => {
  const [systemHealth, setSystemHealth] = useState<CandleSystemHealth | null>(null);
  const [priceStatus, setPriceStatus] = useState<PriceDataStatus[]>([]);
  const [serverSideActive, setServerSideActive] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMonitoringData();

    const interval = setInterval(() => {
      loadMonitoringData();
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  const loadMonitoringData = async () => {
    try {
      const [health, prices, serverCheck] = await Promise.all([
        candleSystemMonitor.getSystemHealth(),
        candleSystemMonitor.getPriceDataStatus(),
        candleSystemMonitor.checkServerSideAggregation()
      ]);

      setSystemHealth(health);
      setPriceStatus(prices);
      setServerSideActive(serverCheck.isActive);
    } catch (error) {
      console.error('Error loading monitoring data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
      case 'ACTIVE':
        return 'text-green-400';
      case 'degraded':
      case 'STALE':
        return 'text-yellow-400';
      case 'unhealthy':
      case 'INACTIVE':
      case 'NO_DATA':
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
      case 'ACTIVE':
        return <CheckCircle className="w-5 h-5" />;
      case 'degraded':
      case 'STALE':
        return <AlertCircle className="w-5 h-5" />;
      default:
        return <XCircle className="w-5 h-5" />;
    }
  };

  if (loading) {
    return (
      <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 p-6">
        <div className="flex items-center justify-center">
          <div className="animate-spin h-8 w-8 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-400" />
            Server-Side Candle System
          </h3>
          {serverSideActive ? (
            <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-sm flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              Active
            </span>
          ) : (
            <span className="px-3 py-1 bg-yellow-500/20 text-yellow-400 rounded-full text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              Inactive
            </span>
          )}
        </div>

        {serverSideActive ? (
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-4">
            <p className="text-green-300 text-sm font-medium">
              ✅ Server-side candle aggregation is running
            </p>
            <p className="text-green-300/70 text-xs mt-1">
              Candles will continue to be collected even when your browser is closed
            </p>
          </div>
        ) : (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-4">
            <p className="text-yellow-300 text-sm font-medium">
              ⚠️ Server-side aggregation not detected
            </p>
            <p className="text-yellow-300/70 text-xs mt-1">
              Candles will only be collected while your browser is open
            </p>
          </div>
        )}

        {systemHealth && (
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div className="bg-slate-900/50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-400 text-sm">Overall Status</span>
                <span className={`${getStatusColor(systemHealth.system_status)} flex items-center gap-1`}>
                  {getStatusIcon(systemHealth.system_status)}
                </span>
              </div>
              <div className="text-white font-semibold capitalize">
                {systemHealth.system_status}
              </div>
            </div>

            <div className="bg-slate-900/50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-400 text-sm">Recent Ticks</span>
                <TrendingUp className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-white font-semibold">
                {systemHealth.price_data.recent_ticks}
              </div>
              <div className="text-slate-400 text-xs mt-1">
                Last {Math.round(systemHealth.price_data.seconds_since_last_tick)}s ago
              </div>
            </div>

            <div className="bg-slate-900/50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-400 text-sm">Recent Candles</span>
                <Activity className="w-4 h-4 text-blue-400" />
              </div>
              <div className="text-white font-semibold">
                {systemHealth.candle_data.recent_candles}
              </div>
              <div className="text-slate-400 text-xs mt-1">
                Last {Math.round(systemHealth.candle_data.seconds_since_last_candle)}s ago
              </div>
            </div>

            <div className="bg-slate-900/50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-400 text-sm">System Load</span>
                <Activity className="w-4 h-4 text-purple-400" />
              </div>
              <div className="text-white font-semibold">
                {systemHealth.system_status === 'healthy' ? 'Normal' : 'Check Logs'}
              </div>
            </div>
          </div>
        )}
      </div>

      {priceStatus.length > 0 && (
        <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 p-6">
          <h4 className="text-md font-semibold text-white mb-4">Price Feed Status</h4>
          <div className="grid grid-cols-1 gap-2">
            {priceStatus.map((status) => (
              <div
                key={status.symbol}
                className="flex items-center justify-between bg-slate-900/50 rounded-lg p-3"
              >
                <div className="flex items-center gap-3">
                  <span className={getStatusColor(status.status)}>
                    {getStatusIcon(status.status)}
                  </span>
                  <span className="text-white font-medium">{status.symbol}</span>
                </div>
                <div className="text-right">
                  <div className={`text-sm font-medium ${getStatusColor(status.status)}`}>
                    {status.status}
                  </div>
                  {status.seconds_since_last_price !== null && (
                    <div className="text-xs text-slate-400">
                      {Math.round(status.seconds_since_last_price)}s ago
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
