import React, { useState, useEffect } from 'react';
import { Power, Settings, Activity, Clock, TrendingUp, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { autoTradingScanner, AutoTradingStatus } from '@/services/auto-trading-scanner';

export const AutoTradingPanel: React.FC = () => {
  const { user } = useAuth();
  const [status, setStatus] = useState<AutoTradingStatus | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (user?.id) {
      loadStatus();
      const interval = setInterval(loadStatus, 30000);
      return () => clearInterval(interval);
    }
  }, [user?.id]);

  const loadStatus = async () => {
    if (!user?.id) return;
    const currentStatus = await autoTradingScanner.getAutoTradingStatus(user.id);
    setStatus(currentStatus);
  };

  const handleStart = async () => {
    if (!user?.id) return;

    setIsStarting(true);
    setMessage(null);

    const result = await autoTradingScanner.startAutoTrading(user.id);

    if (result.success) {
      setMessage({ type: 'success', text: result.message });
      await loadStatus();
    } else {
      setMessage({ type: 'error', text: result.message });
    }

    setIsStarting(false);
  };

  const handleStop = async () => {
    if (!user?.id) return;

    setIsStopping(true);
    setMessage(null);

    const result = await autoTradingScanner.stopAutoTrading(user.id);

    if (result.success) {
      setMessage({ type: 'success', text: result.message });
      await loadStatus();
    } else {
      setMessage({ type: 'error', text: result.message });
    }

    setIsStopping(false);
  };

  const getStatusColor = () => {
    if (!status) return 'text-gray-400';
    if (status.emergencyStop) return 'text-red-400';
    if (status.enabled && status.scanningActive) return 'text-green-400';
    return 'text-yellow-400';
  };

  const getStatusText = () => {
    if (!status) return 'Not Initialized';
    if (status.emergencyStop) return 'Emergency Stopped';
    if (status.enabled && status.scanningActive) return 'Active - Scanning';
    if (status.enabled) return 'Enabled';
    return 'Disabled';
  };

  return (
    <div className="glass-card p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-3 rounded-2xl ${status?.enabled ? 'bg-green-500/20' : 'bg-gray-500/20'}`}>
            <Power className={`h-6 w-6 ${getStatusColor()}`} />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">Auto Trading</h3>
            <p className={`text-sm font-medium ${getStatusColor()}`}>{getStatusText()}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {status?.enabled ? (
            <button
              onClick={handleStop}
              disabled={isStopping}
              className="px-6 py-3 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-xl font-bold hover:from-red-600 hover:to-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg hover:shadow-xl flex items-center gap-2"
            >
              {isStopping ? (
                <>
                  <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Stopping...
                </>
              ) : (
                <>
                  <Power className="h-4 w-4" />
                  Stop
                </>
              )}
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={isStarting}
              className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-xl font-bold hover:from-emerald-600 hover:to-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg hover:shadow-xl flex items-center gap-2"
            >
              {isStarting ? (
                <>
                  <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Power className="h-4 w-4" />
                  Start
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className={`p-4 rounded-xl flex items-start gap-3 ${
          message.type === 'success' ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'
        }`}>
          {message.type === 'success' ? (
            <CheckCircle className="h-5 w-5 text-green-400 mt-0.5 flex-shrink-0" />
          ) : (
            <AlertCircle className="h-5 w-5 text-red-400 mt-0.5 flex-shrink-0" />
          )}
          <p className={`text-sm font-medium ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
            {message.text}
          </p>
        </div>
      )}

      {status && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white/5 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="h-4 w-4 text-blue-400" />
              <span className="text-white/60 text-xs uppercase tracking-wide">Trades Today</span>
            </div>
            <p className="text-white text-2xl font-bold">
              {status.tradesTakenToday} / {status.maxDailyTrades}
            </p>
          </div>

          <div className="bg-white/5 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-green-400" />
              <span className="text-white/60 text-xs uppercase tracking-wide">Daily P&L</span>
            </div>
            <p className={`text-2xl font-bold ${status.dailyPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {status.dailyPnl >= 0 ? '+' : ''}${status.dailyPnl.toFixed(2)}
            </p>
          </div>

          <div className="bg-white/5 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="h-4 w-4 text-purple-400" />
              <span className="text-white/60 text-xs uppercase tracking-wide">Last Scan</span>
            </div>
            <p className="text-white text-sm font-medium">
              {status.lastScanTime
                ? new Date(status.lastScanTime).toLocaleTimeString()
                : 'Never'}
            </p>
          </div>

          <div className="bg-white/5 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="h-4 w-4 text-yellow-400" />
              <span className="text-white/60 text-xs uppercase tracking-wide">Scanning</span>
            </div>
            <p className="text-white text-sm font-medium">
              {status.scanningActive ? (
                <span className="text-green-400 flex items-center gap-1">
                  <span className="h-2 w-2 bg-green-400 rounded-full animate-pulse" />
                  Active
                </span>
              ) : (
                <span className="text-gray-400">Inactive</span>
              )}
            </p>
          </div>
        </div>
      )}

      <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="space-y-2">
            <p className="text-blue-400 text-sm font-bold">How Auto Trading Works</p>
            <ul className="text-white/70 text-xs space-y-1">
              <li>• Scans for opportunities every 5 minutes</li>
              <li>• Maximum 6 trades per day</li>
              <li>• Searches for up to 1 hour before notifying if no trade found</li>
              <li>• Uses AI + FxFlowScalperV2 strategy for best signals</li>
              <li>• Automatically stops if daily loss limit exceeded</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
