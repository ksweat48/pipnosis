import React, { useState, useEffect } from 'react';
import { Power, Settings, Activity, Clock, TrendingUp, AlertCircle, CheckCircle, Lock, Zap } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { autoTradingScanner, AutoTradingStatus } from '@/services/auto-trading-scanner';
import { supabase } from '@/lib/supabase';

export const AutoTradingPanel: React.FC = () => {
  const { user } = useAuth();
  const [status, setStatus] = useState<AutoTradingStatus | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isCheckingAdmin, setIsCheckingAdmin] = useState(true);

  useEffect(() => {
    if (user?.id) {
      checkAdminStatus();
      loadStatus();
      const interval = setInterval(loadStatus, 30000);
      return () => clearInterval(interval);
    }
  }, [user?.id]);

  const checkAdminStatus = async () => {
    if (!user?.id) return;

    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      if (!error && data) {
        setIsAdmin(data.role === 'admin');
      }
    } catch (error) {
      console.error('Failed to check admin status:', error);
    } finally {
      setIsCheckingAdmin(false);
    }
  };

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

  if (isCheckingAdmin) {
    return (
      <div className="glass-card p-6">
        <div className="flex items-center justify-center py-8">
          <div className="h-8 w-8 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="glass-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-yellow-500/20">
            <Lock className="h-6 w-6 text-yellow-400" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">Auto Trading</h3>
            <p className="text-sm font-medium text-yellow-400">Admin Access Only</p>
          </div>
        </div>

        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-400 mt-0.5 flex-shrink-0" />
            <div className="space-y-2">
              <p className="text-yellow-400 text-sm font-bold">Testing & Training Mode</p>
              <p className="text-white/70 text-xs">
                Auto-trading is currently in testing mode for continuous AI improvement and learning.
                This feature is temporarily restricted to admin users only while the system trains on live market data.
              </p>
              <p className="text-white/60 text-xs mt-2">
                The AI is executing trades, analyzing outcomes, and improving its decision-making algorithms.
                This data will enhance trading accuracy for all users once testing is complete.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
              <span className="text-white/60 text-xs uppercase tracking-wide">Total Trades</span>
            </div>
            <p className="text-white text-2xl font-bold">
              {status.tradesTakenToday}
            </p>
            <p className="text-white/50 text-xs mt-1">Continuous Mode</p>
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

      <div className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/30 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <Zap className="h-5 w-5 text-purple-400 mt-0.5 flex-shrink-0" />
          <div className="space-y-2">
            <p className="text-purple-400 text-sm font-bold">Admin Testing Mode - Continuous Learning</p>
            <ul className="text-white/70 text-xs space-y-1">
              <li>• Runs continuously 24/7 until manually stopped</li>
              <li>• No daily trade limits - executes as many quality trades as found</li>
              <li>• Scans markets every 2-3 minutes for opportunities</li>
              <li>• All trades feed into AI learning system</li>
              <li>• Objective: Improve decision-making and accuracy</li>
              <li>• Uses FxFlowScalperV2 + AI hybrid strategy</li>
            </ul>
            <p className="text-emerald-400 text-xs font-semibold mt-3">This data improves trading accuracy for the entire platform</p>
          </div>
        </div>
      </div>
    </div>
  );
};
