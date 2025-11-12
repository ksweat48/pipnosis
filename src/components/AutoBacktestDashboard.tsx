import React, { useState, useEffect } from 'react';
import { Play, Square, Clock, Activity, AlertTriangle, CheckCircle, Pause, TrendingUp, Settings as SettingsIcon, List, Bell, BellOff, Zap } from 'lucide-react';
import { autoBacktestAPI, AutoBacktestState, QueueStats, BacktestProgress, SystemPerformanceMetrics } from '../services/auto-backtest-api';
import { useAuth } from '../hooks/useAuth';
import ActiveBacktestCard from './ActiveBacktestCard';
import BacktestPhaseIndicator from './BacktestPhaseIndicator';
import LiveExecutionLog from './LiveExecutionLog';
import { backtestNotificationService } from '../services/backtest-notification-service';
import { autoBacktestJobMonitor } from '../services/auto-backtest-job-monitor';
import { manualBacktestTrigger } from '../services/manual-backtest-trigger';
import { autoBacktestBrowserExecutor } from '../services/auto-backtest-browser-executor';

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
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  // Progress tracking states
  const [activeBacktests, setActiveBacktests] = useState<BacktestProgress[]>([]);
  const [recentCompleted, setRecentCompleted] = useState<any[]>([]);
  const [systemMetrics, setSystemMetrics] = useState<SystemPerformanceMetrics | null>(null);
  const [selectedBacktest, setSelectedBacktest] = useState<string | null>(null);
  const [executionLogs, setExecutionLogs] = useState<any[]>([]);
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [notificationPrefs, setNotificationPrefs] = useState(backtestNotificationService.getPreferences());
  const [previousActiveCount, setPreviousActiveCount] = useState(0);
  const [manualTriggerLoading, setManualTriggerLoading] = useState(false);
  const [manualTriggerMessage, setManualTriggerMessage] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      console.log('[Auto-Backtest Dashboard] 🚀 Component mounted, initializing...');
      console.log('[Auto-Backtest Dashboard] User ID:', user.id);
      loadState();
      loadConfig();
      loadProgressData();

      // Request notification permission on mount
      backtestNotificationService.requestPermission();

      const stateInterval = setInterval(() => {
        console.log('[Auto-Backtest Dashboard] ⏰ State polling tick');
        loadState();
      }, 3000);
      const progressInterval = setInterval(() => {
        console.log('[Auto-Backtest Dashboard] ⏰ Progress polling tick');
        loadProgressData();
      }, 1000); // Poll progress every 1 second for faster updates

      return () => {
        console.log('[Auto-Backtest Dashboard] 🛑 Component unmounting, cleaning up intervals');
        clearInterval(stateInterval);
        clearInterval(progressInterval);

        // Stop executors when dashboard unmounts
        autoBacktestJobMonitor.stop();
        autoBacktestBrowserExecutor.stop();
      };
    }
  }, [user]);

  // Detect completed backtests and trigger notifications
  useEffect(() => {
    if (activeBacktests.length < previousActiveCount) {
      // A backtest completed - check recent completed for details
      checkForNewCompletions();
    }
    setPreviousActiveCount(activeBacktests.length);
  }, [activeBacktests]);

  const checkForNewCompletions = async () => {
    if (!user) return;
    const completed = await autoBacktestAPI.getRecentCompletedBacktests(user.id, 5);

    // Check if there's a newly completed backtest
    const latestCompleted = completed[0];
    if (latestCompleted && latestCompleted.status === 'completed') {
      const timeDiff = new Date().getTime() - new Date(latestCompleted.completed_at).getTime();
      if (timeDiff < 10000) { // Within last 10 seconds
        await backtestNotificationService.notifyBacktestComplete(
          latestCompleted.backtest_id,
          latestCompleted.current_win_rate || 0,
          latestCompleted.trades_executed || 0
        );
      }
    } else if (latestCompleted && latestCompleted.status === 'failed') {
      const timeDiff = new Date().getTime() - new Date(latestCompleted.completed_at).getTime();
      if (timeDiff < 10000) {
        await backtestNotificationService.notifyBacktestFailed(
          latestCompleted.backtest_id,
          latestCompleted.error_message || 'Unknown error'
        );
      }
    }
  };

  const loadConfig = async () => {
    if (!user) return;
    setConfigLoading(true);
    setConfigError(null);
    try {
      console.log('[Auto-Backtest Dashboard] Loading config...');
      const currentConfig = await autoBacktestAPI.getConfig(user.id);

      if (!currentConfig) {
        console.warn('[Auto-Backtest Dashboard] No config returned, using defaults');
        const defaultConfig = {
          max_consecutive_runs: 100,
          standard_cooldown_minutes: 15,
          max_stress_score: 80,
          max_db_response_ms: 5000,
          min_duration_days: 1,
          max_duration_days: 3,
          delay_between_runs_min_seconds: 2,
          delay_between_runs_max_seconds: 5
        };
        setConfig(defaultConfig);
      } else {
        console.log('[Auto-Backtest Dashboard] Config loaded successfully');
        setConfig(currentConfig);
      }
    } catch (err: any) {
      console.error('[Auto-Backtest Dashboard] Error loading config:', err);
      setConfigError(err.message || 'Failed to load configuration');

      const defaultConfig = {
        max_consecutive_runs: 100,
        standard_cooldown_minutes: 15,
        max_stress_score: 80,
        max_db_response_ms: 5000,
        min_duration_days: 1,
        max_duration_days: 3,
        delay_between_runs_min_seconds: 2,
        delay_between_runs_max_seconds: 5
      };
      setConfig(defaultConfig);
    } finally {
      setConfigLoading(false);
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
      console.log('[Auto-Backtest Dashboard] 📊 Loading controller state...');
      const response = await autoBacktestAPI.getStatus();
      console.log('[Auto-Backtest Dashboard] ✅ Status response:', response);

      if (response.success && response.controller) {
        console.log('[Auto-Backtest Dashboard] Controller state:', {
          status: response.controller.status,
          isActive: response.controller.isActive,
          totalBacktests: response.controller.totalBacktestsCompleted,
          currentCycle: response.controller.currentCycleCount,
          cooldownActive: response.controller.cooldownActive,
          pausedForLiveTrade: response.controller.pausedForLiveTrade
        });
        setState(response.controller);
        setQueueStats(response.queueStats || null);
        console.log('[Auto-Backtest Dashboard] Queue stats:', response.queueStats);
        setError(null);
      } else {
        console.warn('[Auto-Backtest Dashboard] ⚠️ No controller state returned');
        setState(null);
        setQueueStats(null);
      }
    } catch (err: any) {
      console.error('[Auto-Backtest Dashboard] ❌ Error loading state:', err);
      setError('Failed to load controller state. Please try refreshing the page.');
    }
  };

  const loadProgressData = async () => {
    if (!user) return;
    try {
      console.log('[Auto-Backtest Dashboard] 📈 Loading progress data...');

      // Load active backtests progress
      const active = await autoBacktestAPI.getActiveBacktestsProgress(user.id);
      console.log(`[Auto-Backtest Dashboard] Active backtests found: ${active.length}`);
      if (active.length > 0) {
        console.log('[Auto-Backtest Dashboard] Active backtest details:', active.map(b => ({
          id: b.backtestId,
          phase: b.phase,
          progress: `${b.progressPercentage}%`,
          step: b.currentStep,
          status: b.status
        })));
      }
      setActiveBacktests(active);

      // Load recent completed backtests
      const completed = await autoBacktestAPI.getRecentCompletedBacktests(user.id, 10);
      console.log(`[Auto-Backtest Dashboard] Recent completed backtests: ${completed.length}`);
      setRecentCompleted(completed);

      // Load system performance metrics
      const metrics = await autoBacktestAPI.getSystemPerformanceMetrics(user.id);
      console.log('[Auto-Backtest Dashboard] System metrics:', metrics);
      setSystemMetrics(metrics);

      // Detect stuck backtests
      await autoBacktestAPI.detectStuckBacktests();

      // Load execution logs if a backtest is selected
      if (selectedBacktest) {
        const logs = await autoBacktestAPI.getExecutionLogs(selectedBacktest, 50);
        console.log(`[Auto-Backtest Dashboard] Execution logs for ${selectedBacktest}: ${logs.length} entries`);
        setExecutionLogs(logs);
      }
    } catch (err: any) {
      console.error('[Auto-Backtest Dashboard] ❌ Error loading progress data:', err);
    }
  };

  const handleStart = async () => {
    if (!user) return;
    console.log('[Auto-Backtest Dashboard] 🚀 START button clicked');
    setLoading(true);
    setError(null);
    try {
      console.log('[Auto-Backtest Dashboard] Calling start API...');
      const response = await autoBacktestAPI.start();
      console.log('[Auto-Backtest Dashboard] Start response:', response);
      if (response.success) {
        console.log('[Auto-Backtest Dashboard] ✅ Started successfully');

        // Start the browser-based executor (runs automatically in browser)
        console.log('[Auto-Backtest Dashboard] 🔧 Starting browser executor...');
        await autoBacktestBrowserExecutor.start(user.id);
        console.log('[Auto-Backtest Dashboard] ✅ Browser executor started - will run automatically every 10 seconds');
      } else {
        console.error('[Auto-Backtest Dashboard] ❌ Start failed:', response.error);
        setError(response.error || 'Failed to start');
      }
      await loadState();
    } catch (err: any) {
      setError(err.message || 'Failed to start auto-backtest');
      console.error('[Auto-Backtest Dashboard] ❌ Exception during start:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    if (!user) return;
    console.log('[Auto-Backtest Dashboard] 🛑 STOP button clicked');
    setLoading(true);
    setError(null);
    try {
      // Stop the browser executor first
      console.log('[Auto-Backtest Dashboard] 🔧 Stopping browser executor...');
      autoBacktestBrowserExecutor.stop();

      console.log('[Auto-Backtest Dashboard] Calling stop API...');
      const response = await autoBacktestAPI.stop();
      console.log('[Auto-Backtest Dashboard] Stop response:', response);
      if (response.success) {
        console.log('[Auto-Backtest Dashboard] ✅ Stopped successfully');
      } else {
        console.error('[Auto-Backtest Dashboard] ❌ Stop failed:', response.error);
        setError(response.error || 'Failed to stop');
      }
      await loadState();
    } catch (err: any) {
      setError(err.message || 'Failed to stop auto-backtest');
      console.error('[Auto-Backtest Dashboard] ❌ Exception during stop:', err);
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

  const handleManualTrigger = async () => {
    if (!user) return;
    setManualTriggerLoading(true);
    setManualTriggerMessage(null);
    try {
      console.log('[Manual Trigger] 🎯 User clicked manual trigger');
      const result = await manualBacktestTrigger.runCompleteCycle();
      console.log('[Manual Trigger] Result:', result);
      setManualTriggerMessage(result.message);
      if (result.success) {
        await loadProgressData();
      }
    } catch (err: any) {
      setManualTriggerMessage(`Error: ${err.message}`);
    } finally {
      setManualTriggerLoading(false);
      setTimeout(() => setManualTriggerMessage(null), 10000);
    }
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
            onClick={() => {
              console.log('[Auto-Backtest Dashboard] Settings button clicked');
              console.log('[Auto-Backtest Dashboard] Current config:', config);
              console.log('[Auto-Backtest Dashboard] Config loading:', configLoading);
              if (!config && !configLoading) {
                console.warn('[Auto-Backtest Dashboard] No config available, reloading...');
                loadConfig();
              }
              setShowSettings(true);
            }}
            disabled={configLoading}
            className="flex items-center gap-2 px-4 py-3 bg-gray-700 text-white font-semibold rounded-lg hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={configLoading ? 'Loading configuration...' : 'Configure auto-backtest settings'}
          >
            {configLoading ? (
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
            ) : (
              <SettingsIcon className="w-5 h-5" />
            )}
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
              <div className="w-full bg-gray-700 rounded-full h-2 mt-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${state.currentCycleCount}%` }}
                />
              </div>
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

          {/* System Performance Metrics */}
          {systemMetrics && systemMetrics.totalActiveBacktests > 0 && (
            <div className="bg-gradient-to-r from-purple-900/20 to-blue-900/20 p-4 rounded-lg border border-purple-500/30">
              <h3 className="text-sm font-semibold text-purple-300 mb-3">System Performance</h3>
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-purple-400">{systemMetrics.totalActiveBacktests}</p>
                  <p className="text-xs text-gray-400 mt-1">Active</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-blue-400">{systemMetrics.totalCandlesProcessed.toLocaleString()}</p>
                  <p className="text-xs text-gray-400 mt-1">Candles</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-green-400">{systemMetrics.avgMemoryUsageMb}MB</p>
                  <p className="text-xs text-gray-400 mt-1">Avg Memory</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-yellow-400">{systemMetrics.avgProcessingSpeed}/s</p>
                  <p className="text-xs text-gray-400 mt-1">Processing</p>
                </div>
              </div>
            </div>
          )}

          {/* Active Backtests */}
          {activeBacktests.length > 0 ? (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Activity className="w-5 h-5 text-green-400 animate-pulse" />
                Currently Running ({activeBacktests.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeBacktests.map((backtest) => (
                  <ActiveBacktestCard
                    key={backtest.backtestId}
                    progress={backtest}
                    onViewDetails={setSelectedBacktest}
                  />
                ))}
              </div>
            </div>
          ) : state?.isActive && (
            <div className="bg-yellow-900/20 border-l-4 border-yellow-400 p-4 rounded">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-yellow-200 mb-1">
                    No Active Backtests Detected
                  </p>
                  <p className="text-xs text-yellow-300 mb-3">
                    The auto-backtest system is running, but no backtests are currently being processed.
                    This usually means the cron jobs aren't triggering properly. Use the manual trigger below to force execution.
                  </p>
                  <button
                    onClick={handleManualTrigger}
                    disabled={manualTriggerLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-yellow-600 text-white text-sm font-semibold rounded-lg hover:bg-yellow-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
                  >
                    {manualTriggerLoading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        Running...
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4" />
                        Trigger Backtest Now
                      </>
                    )}
                  </button>
                  {manualTriggerMessage && (
                    <p className="text-xs text-white mt-2 p-2 bg-black/30 rounded">
                      {manualTriggerMessage}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Recent Completed Backtests */}
          {recentCompleted.length > 0 && (
            <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">Recently Completed</h3>
              <div className="space-y-2">
                {recentCompleted.slice(0, 5).map((backtest) => (
                  <div key={backtest.id} className="bg-gray-900/50 p-3 rounded border border-gray-700/50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {backtest.status === 'completed' ? (
                        <CheckCircle className="w-4 h-4 text-green-400" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-red-400" />
                      )}
                      <div>
                        <p className="text-sm text-white font-medium">
                          {backtest.trades_executed || 0} trades
                        </p>
                        <p className="text-xs text-gray-400">
                          {new Date(backtest.completed_at).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold ${backtest.current_win_rate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                        {backtest.current_win_rate?.toFixed(1) || 0}% WR
                      </p>
                      <p className="text-xs text-gray-400">
                        {Math.floor((new Date(backtest.completed_at).getTime() - new Date(backtest.started_at).getTime()) / 1000)}s
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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

          {/* Queue Stats with Progress */}
          {queueStats && (
            <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
              <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                <List className="w-4 h-4" />
                Job Queue Status
              </h3>
              <div className="grid grid-cols-4 gap-4 mb-4">
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
              {/* Overall Progress Bar */}
              {(queueStats.pending + queueStats.processing + queueStats.completed + queueStats.failed) > 0 && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Overall Progress</span>
                    <span>{Math.round((queueStats.completed / (queueStats.pending + queueStats.processing + queueStats.completed + queueStats.failed)) * 100)}%</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
                    <div className="h-full flex">
                      <div
                        className="bg-green-500 transition-all duration-300"
                        style={{ width: `${(queueStats.completed / (queueStats.pending + queueStats.processing + queueStats.completed + queueStats.failed)) * 100}%` }}
                        title={`${queueStats.completed} completed`}
                      />
                      <div
                        className="bg-blue-500 animate-pulse transition-all duration-300"
                        style={{ width: `${(queueStats.processing / (queueStats.pending + queueStats.processing + queueStats.completed + queueStats.failed)) * 100}%` }}
                        title={`${queueStats.processing} processing`}
                      />
                      <div
                        className="bg-red-500 transition-all duration-300"
                        style={{ width: `${(queueStats.failed / (queueStats.pending + queueStats.processing + queueStats.completed + queueStats.failed)) * 100}%` }}
                        title={`${queueStats.failed} failed`}
                      />
                    </div>
                  </div>
                  {queueStats.processing > 0 && (
                    <p className="text-xs text-blue-400 animate-pulse">🔄 {queueStats.processing} backtest{queueStats.processing > 1 ? 's' : ''} currently running...</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Diagnostic Information Panel */}
          <div className="bg-gradient-to-r from-blue-900/20 to-purple-900/20 border border-blue-500/30 p-4 rounded-lg">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-blue-300">System Diagnostics</h3>
              <div className="flex gap-2">
                <button
                  onClick={handleManualTrigger}
                  disabled={manualTriggerLoading}
                  className="text-xs text-green-400 hover:text-green-300 px-3 py-1 bg-green-900/30 rounded flex items-center gap-1 disabled:opacity-50"
                >
                  <Zap className="w-3 h-3" />
                  Trigger Now
                </button>
                <button
                  onClick={() => {
                    console.log('===== MANUAL DIAGNOSTIC DUMP =====');
                    console.log('Current State:', state);
                    console.log('Queue Stats:', queueStats);
                    console.log('Active Backtests:', activeBacktests);
                    console.log('Recent Completed:', recentCompleted);
                    console.log('System Metrics:', systemMetrics);
                    console.log('================================');
                  }}
                  className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 bg-blue-900/30 rounded"
                >
                  Dump to Console
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-gray-900/50 p-2 rounded">
                <p className="text-gray-400 mb-1">Last State Update</p>
                <p className="text-white font-mono">{state?.startedAt ? new Date(state.startedAt).toLocaleTimeString() : 'Never'}</p>
              </div>
              <div className="bg-gray-900/50 p-2 rounded">
                <p className="text-gray-400 mb-1">Last Health Check</p>
                <p className="text-white font-mono">{state ? new Date().toLocaleTimeString() : 'N/A'}</p>
              </div>
              <div className="bg-gray-900/50 p-2 rounded">
                <p className="text-gray-400 mb-1">Active Backtests</p>
                <p className={`font-bold ${activeBacktests.length > 0 ? 'text-green-400' : 'text-gray-400'}`}>
                  {activeBacktests.length}
                </p>
              </div>
              <div className="bg-gray-900/50 p-2 rounded">
                <p className="text-gray-400 mb-1">Queue Status</p>
                <p className={`font-bold ${queueStats && (queueStats.pending > 0 || queueStats.processing > 0) ? 'text-blue-400' : 'text-gray-400'}`}>
                  {queueStats ? `${queueStats.pending + queueStats.processing} Active` : 'Unknown'}
                </p>
              </div>
            </div>
            <div className="mt-3 p-2 bg-blue-900/20 rounded border border-blue-500/20">
              <p className="text-xs text-blue-200">
                <strong>Debug Mode:</strong> Check your browser console (F12) for detailed system logs.
                All auto-backtest operations are logged with timestamps and status information.
              </p>
            </div>
          </div>

          {/* Browser Automation Info Box */}
          <div className="bg-gradient-to-r from-green-900/20 to-blue-900/20 border-l-4 border-green-400 p-4 rounded">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5 animate-pulse" />
              <div>
                <p className="text-sm font-semibold text-green-200 mb-1">
                  Browser-Based Automation Active
                </p>
                <p className="text-xs text-gray-300">
                  The system automatically creates and executes backtest jobs every 10 seconds while this dashboard is open.
                  Keep this tab open for continuous AI training. Jobs are processed directly in the database for maximum reliability.
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
      {showSettings && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] p-4" onClick={(e) => {
          if (e.target === e.currentTarget) {
            console.log('[Auto-Backtest Dashboard] Backdrop clicked, closing modal');
            setShowSettings(false);
          }
        }}>
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
              {/* Config Error Display */}
              {configError && (
                <div className="bg-yellow-900/20 border-l-4 border-yellow-400 p-4 rounded">
                  <p className="text-sm text-yellow-300">
                    <strong>Warning:</strong> {configError}. Using default values.
                  </p>
                </div>
              )}

              {/* Config Loading Display */}
              {configLoading && (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4"></div>
                  <p className="text-gray-400">Loading configuration...</p>
                </div>
              )}

              {!configLoading && config && (
                <>
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
                </>
              )}
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
                disabled={configSaving || configLoading || !config}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:bg-gray-600 disabled:cursor-not-allowed"
              >
                {configSaving ? 'Saving...' : configLoading ? 'Loading...' : 'Save Settings'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
