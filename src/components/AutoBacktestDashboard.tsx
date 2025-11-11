import React, { useState, useEffect } from 'react';
import { Play, Square, Clock, Activity, AlertTriangle, CheckCircle, Pause, TrendingUp, Settings as SettingsIcon, List } from 'lucide-react';
import { autoBacktestAPI, AutoBacktestState, QueueStats } from '../services/auto-backtest-api';
import { useAuth } from '../hooks/useAuth';

export default function AutoBacktestDashboard() {
  const { user } = useAuth();
  const [state, setState] = useState<AutoBacktestState | null>(null);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState<any>(null);
  const [configSaving, setConfigSaving] = useState(false);

  useEffect(() => {
    if (user) {
      loadState();
      loadConfig();
      const interval = setInterval(loadState, 3000);
      return () => clearInterval(interval);
    }
  }, [user]);

  const loadConfig = async () => {
    if (!user) return;
    try {
      const currentConfig = await autoBacktestAPI.getConfig(user.id);
      setConfig(currentConfig);
    } catch (err: any) {
      console.error('[Auto-Backtest Dashboard] Error loading config:', err);
    }
  };

  const handleSaveConfig = async () => {
    if (!user || !config) return;
    setConfigSaving(true);
    try {
      const success = await autoBacktestAPI.updateConfig(user.id, config);
      if (success) {
        console.log('[Auto-Backtest Dashboard] Config saved successfully');
        setShowSettings(false);
      } else {
        setError('Failed to save configuration');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save configuration');
    } finally {
      setConfigSaving(false);
    }
  };

  const loadState = async () => {
    if (!user) return;
    try {
      const response = await autoBacktestAPI.getStatus();
      if (response.success && response.controller) {
        setState(response.controller);
        setQueueStats(response.queueStats || null);
        setError(null);
      } else {
        setState(null);
        setQueueStats(null);
      }
    } catch (err: any) {
      console.error('[Auto-Backtest Dashboard] Error loading state:', err);
      setError('Failed to load controller state. Please try refreshing the page.');
    }
  };

  const handleStart = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const response = await autoBacktestAPI.start();
      if (response.success) {
        console.log('[Auto-Backtest Dashboard] Started successfully');
      } else {
        setError(response.error || 'Failed to start');
      }
      await loadState();
    } catch (err: any) {
      setError(err.message || 'Failed to start auto-backtest');
      console.error('[Auto-Backtest Dashboard] Error starting:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const response = await autoBacktestAPI.stop();
      if (response.success) {
        console.log('[Auto-Backtest Dashboard] Stopped successfully');
      } else {
        setError(response.error || 'Failed to stop');
      }
      await loadState();
    } catch (err: any) {
      setError(err.message || 'Failed to stop auto-backtest');
      console.error('[Auto-Backtest Dashboard] Error stopping:', err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'running':
        return 'text-green-400';
      case 'cooldown':
        return 'text-blue-400';
      case 'paused_for_live_trade':
        return 'text-yellow-400';
      case 'stopped':
        return 'text-gray-400';
      default:
        return 'text-gray-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <Activity className="w-5 h-5 text-green-400 animate-pulse" />;
      case 'cooldown':
        return <Clock className="w-5 h-5 text-blue-400" />;
      case 'paused_for_live_trade':
        return <Pause className="w-5 h-5 text-yellow-400" />;
      case 'stopped':
        return <Square className="w-5 h-5 text-gray-400" />;
      default:
        return <AlertTriangle className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStatusText = (status: string): string => {
    switch (status) {
      case 'running':
        return 'Running Auto-Backtests';
      case 'cooldown':
        return 'In Cooldown Period';
      case 'paused_for_live_trade':
        return 'Paused for Live Trade';
      case 'stopped':
        return 'Stopped';
      default:
        return 'Unknown';
    }
  };

  const getCooldownRemaining = (): string => {
    if (!state?.cooldownEndsAt) return '';
    const now = new Date();
    const end = new Date(state.cooldownEndsAt);
    const diffMs = end.getTime() - now.getTime();
    if (diffMs <= 0) return 'Ending soon...';
    const minutes = Math.ceil(diffMs / 60000);
    return `${minutes} min remaining`;
  };

  const getStressColor = (score: number): string => {
    if (score >= 80) return 'text-red-400';
    if (score >= 60) return 'text-yellow-400';
    return 'text-green-400';
  };

  const getStressBgColor = (score: number): string => {
    if (score >= 80) return 'bg-red-500';
    if (score >= 60) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  return (
    <div className="bg-gradient-to-br from-purple-900/30 to-blue-900/30 backdrop-blur-sm border-2 border-purple-500/30 rounded-lg shadow-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-6 h-6 text-purple-400" />
          <h2 className="text-2xl font-bold text-white">Auto-Backtest System</h2>
          <span className="px-3 py-1 bg-purple-600 text-white text-xs font-bold rounded-full">
            INTELLIGENT
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-2 px-4 py-3 bg-gray-700 text-white font-semibold rounded-lg hover:bg-gray-600 transition-colors"
          >
            <SettingsIcon className="w-5 h-5" />
            Settings
          </button>
          {state?.isActive ? (
            <button
              onClick={handleStop}
              disabled={loading}
              className="flex items-center gap-2 px-6 py-3 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
            >
              <Square className="w-5 h-5" />
              Stop Auto-Backtest
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={loading}
              className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
            >
              <Play className="w-5 h-5" />
              Start Auto-Backtest
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-900/20 border-l-4 border-red-400 rounded">
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {state ? (
        <div className="space-y-6">
          {/* Status Banner */}
          <div className={`p-4 rounded-lg border-2 ${
            state.isActive ? 'bg-green-900/20 border-green-500/30' : 'bg-gray-800/50 border-gray-600/30'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {getStatusIcon(state.status)}
                <div>
                  <p className={`text-lg font-bold ${getStatusColor(state.status)}`}>
                    {getStatusText(state.status)}
                  </p>
                  {state.cooldownActive && state.cooldownEndsAt && (
                    <p className="text-sm text-blue-300 mt-1">
                      {getCooldownRemaining()} • Reason: {state.cooldownReason}
                    </p>
                  )}
                  {state.pausedForLiveTrade && (
                    <p className="text-sm text-yellow-300 mt-1">
                      System paused while live demo trade is active
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Total Backtests */}
            <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
              <p className="text-sm text-gray-400 mb-1">Total Backtests</p>
              <p className="text-3xl font-bold text-white">{state.totalBacktestsCompleted}</p>
            </div>

            {/* Current Cycle */}
            <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
              <p className="text-sm text-gray-400 mb-1">Current Cycle</p>
              <p className="text-3xl font-bold text-white">
                {state.currentCycleCount}
                <span className="text-lg text-gray-400"> / 100</span>
              </p>
              {state.currentCycleCount >= 80 && (
                <p className="text-xs text-yellow-400 mt-1">Approaching cooldown</p>
              )}
            </div>

            {/* System Stress */}
            <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
              <p className="text-sm text-gray-400 mb-1">System Stress</p>
              <div className="flex items-baseline gap-2">
                <p className={`text-3xl font-bold ${getStressColor(state.systemStressScore)}`}>
                  {state.systemStressScore}
                </p>
                <span className="text-lg text-gray-400">%</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2 mt-2">
                <div
                  className={`${getStressBgColor(state.systemStressScore)} h-2 rounded-full transition-all duration-300`}
                  style={{ width: `${state.systemStressScore}%` }}
                ></div>
              </div>
            </div>

            {/* Status Badge */}
            <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
              <p className="text-sm text-gray-400 mb-1">Training Status</p>
              <div className="flex items-center gap-2 mt-2">
                {state.isActive ? (
                  <>
                    <CheckCircle className="w-6 h-6 text-green-400" />
                    <span className="text-lg font-bold text-green-400">Active</span>
                  </>
                ) : (
                  <>
                    <Square className="w-6 h-6 text-gray-400" />
                    <span className="text-lg font-bold text-gray-400">Inactive</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Features Overview */}
          <div className="bg-gradient-to-r from-purple-900/20 to-blue-900/20 p-4 rounded-lg border border-purple-500/20">
            <h3 className="text-sm font-semibold text-purple-300 mb-3">Intelligent Auto-Training Features</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-gray-300">
              <div className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                <span>Randomized 1-3 day backtests with mixed market conditions</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                <span>All pairs tested (EURUSD, XAUUSD, GBPUSD, USDJPY, US30)</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                <span>Dynamic cooldown after 100 backtests (15 min auto-resume)</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                <span>Auto-pauses during live demo trades</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                <span>Early cooldown if system stress exceeds 80%</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                <span>Real-time health monitoring and auto-adjustments</span>
              </div>
            </div>
          </div>

          {/* Queue Stats */}
          {queueStats && (
            <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
              <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                <List className="w-4 h-4" />
                Job Queue Status
              </h3>
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-yellow-400">{queueStats.pending}</p>
                  <p className="text-xs text-gray-400 mt-1">Pending</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-blue-400">{queueStats.processing}</p>
                  <p className="text-xs text-gray-400 mt-1">Processing</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-green-400">{queueStats.completed}</p>
                  <p className="text-xs text-gray-400 mt-1">Completed</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-red-400">{queueStats.failed}</p>
                  <p className="text-xs text-gray-400 mt-1">Failed</p>
                </div>
              </div>
            </div>
          )}

          {/* Server Mode Info Box */}
          <div className="bg-gradient-to-r from-green-900/20 to-blue-900/20 border-l-4 border-green-400 p-4 rounded">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-green-200 mb-1">
                  Server-Side Automation Active
                </p>
                <p className="text-xs text-gray-300">
                  The auto-backtest system runs independently on Supabase servers. You can close this browser tab -
                  the system will continue running in the background. Jobs are queued every 30 seconds and executed every 15 seconds.
                </p>
              </div>
            </div>
          </div>

          {/* Info Box */}
          <div className="bg-blue-900/20 border-l-4 border-blue-400 p-4 rounded">
            <p className="text-sm text-blue-200">
              <strong>How it works:</strong> The system runs continuous synthetic backtests to rapidly train the AI.
              It automatically randomizes test parameters (duration, risk levels, market scenarios) to provide diverse learning experiences.
              After 100 consecutive backtests, it takes a 15-minute cooldown and resumes automatically.
              The system intelligently pauses if database stress is high or if you start a live demo trade.
            </p>
          </div>
        </div>
      ) : (
        <div className="text-center py-8">
          <p className="text-gray-400">No auto-backtest session active. Click Start to begin.</p>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && config && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-700">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <SettingsIcon className="w-6 h-6" />
                  Auto-Backtest Configuration
                </h3>
                <button
                  onClick={() => setShowSettings(false)}
                  className="text-gray-400 hover:text-white"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Max Consecutive Runs */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Max Consecutive Backtests Before Cooldown
                </label>
                <input
                  type="number"
                  min="10"
                  max="200"
                  value={config.max_consecutive_runs}
                  onChange={(e) => setConfig({ ...config, max_consecutive_runs: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-md"
                />
                <p className="text-xs text-gray-400 mt-1">Default: 100 backtests</p>
              </div>

              {/* Cooldown Duration */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Standard Cooldown Duration (minutes)
                </label>
                <input
                  type="number"
                  min="5"
                  max="60"
                  value={config.standard_cooldown_minutes}
                  onChange={(e) => setConfig({ ...config, standard_cooldown_minutes: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-md"
                />
                <p className="text-xs text-gray-400 mt-1">Default: 15 minutes</p>
              </div>

              {/* Stress Threshold */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Max System Stress Score (%)
                </label>
                <input
                  type="number"
                  min="50"
                  max="100"
                  value={config.max_stress_score}
                  onChange={(e) => setConfig({ ...config, max_stress_score: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-md"
                />
                <p className="text-xs text-gray-400 mt-1">Trigger early cooldown when exceeded. Default: 80%</p>
              </div>

              {/* Database Response Threshold */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Max Database Response Time (ms)
                </label>
                <input
                  type="number"
                  min="1000"
                  max="10000"
                  step="500"
                  value={config.max_db_response_ms}
                  onChange={(e) => setConfig({ ...config, max_db_response_ms: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-md"
                />
                <p className="text-xs text-gray-400 mt-1">Trigger early cooldown when exceeded. Default: 5000ms</p>
              </div>

              {/* Duration Range */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Min Backtest Duration (days)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="7"
                    value={config.min_duration_days}
                    onChange={(e) => setConfig({ ...config, min_duration_days: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Max Backtest Duration (days)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="7"
                    value={config.max_duration_days}
                    onChange={(e) => setConfig({ ...config, max_duration_days: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-md"
                  />
                </div>
              </div>

              {/* Delay Between Runs */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Min Delay Between Runs (seconds)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={config.delay_between_runs_min_seconds}
                    onChange={(e) => setConfig({ ...config, delay_between_runs_min_seconds: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Max Delay Between Runs (seconds)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={config.delay_between_runs_max_seconds}
                    onChange={(e) => setConfig({ ...config, delay_between_runs_max_seconds: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-md"
                  />
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-gray-700 flex justify-end gap-3">
              <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveConfig}
                disabled={configSaving}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:bg-gray-600"
              >
                {configSaving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
