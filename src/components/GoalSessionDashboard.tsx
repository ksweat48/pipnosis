import React, { useState, useEffect } from 'react';
import { Target, TrendingUp, Clock, Activity, CheckCircle, XCircle, Pause, BarChart2, Cloud, Wifi, WifiOff, AlertTriangle, Search, Shield } from 'lucide-react';
import { smartGoalSessionManager, SmartGoalSession } from '../services/smart-goal-session-manager';
import { goalNotificationSystem } from '../services/goal-notifications';
import { goalScannerTrigger, ScanStatus, MarketDataStatus } from '../services/goal-scanner-trigger';
import { useAuth } from '../hooks/useAuth';
import { MarketAnalysisStream } from './MarketAnalysisStream';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
// GoalScanReadinessIndicator removed - using simple indicator

export const GoalSessionDashboard: React.FC = () => {
  const { user } = useAuth();
  const { confirm } = useConfirmDialog();
  const [activeSession, setActiveSession] = useState<SmartGoalSession | null>(null);
  const [progress, setProgress] = useState<any>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanStatus, setScanStatus] = useState<ScanStatus>(goalScannerTrigger.getStatus());

  useEffect(() => {
    loadSessionData();

    const interval = setInterval(loadSessionData, 10000);

    const handleSessionCreated = () => {
      loadSessionData();
    };

    window.addEventListener('goal-session-created', handleSessionCreated);

    const unsubscribe = goalScannerTrigger.onStatusChange((status) => {
      setScanStatus(status);
      if (!status.isScanning) {
        loadSessionData();
      }
    });

    return () => {
      clearInterval(interval);
      window.removeEventListener('goal-session-created', handleSessionCreated);
      unsubscribe();
      goalScannerTrigger.stopPolling();
    };
  }, [user]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    if (['scanning', 'initializing', 'trade_pending', 'in_trade', 'soft_closing'].includes(activeSession.status)) {
      goalScannerTrigger.startPolling(activeSession.sessionId, 60000);
    } else {
      goalScannerTrigger.stopPolling();
    }
  }, [activeSession?.sessionId, activeSession?.status]);

  const loadSessionData = async () => {
    if (!user) return;

    try {
      const session = await smartGoalSessionManager.getActiveSession(user.id);
      setActiveSession(session);

      if (session) {
        const [progressData, convos, notifs] = await Promise.all([
          smartGoalSessionManager.getSessionProgress(session.sessionId),
          smartGoalSessionManager.getSessionConversations(session.sessionId, 20),
          goalNotificationSystem.getUnacknowledgedNotifications(user.id),
        ]);

        setProgress(progressData);
        setConversations(convos);
        setNotifications(notifs);
      }
    } catch (error) {
      console.error('Error loading session data:', error);
    } finally {
      setLoading(false);
    }
  };


  const handleStopSession = async () => {
    if (!activeSession || !user) return;

    const confirmed = await confirm({
      title: 'Stop Goal Session',
      message: 'Are you sure you want to stop this goal session? Any progress will be saved.',
      confirmText: 'Stop Session',
      cancelText: 'Continue',
      variant: 'warning'
    });

    if (!confirmed) return;

    const success = await smartGoalSessionManager.stopSession(activeSession.sessionId, user.id);
    if (success) {
      loadSessionData();
    }
  };

  const formatTimeRemaining = (endTime: string) => {
    const end = new Date(endTime).getTime();
    const now = Date.now();
    const remaining = end - now;

    if (remaining <= 0) return 'Expired';

    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h remaining`;
    }

    return `${hours}h ${minutes}m remaining`;
  };

  const formatTimeAgo = (timestamp: string) => {
    const now = Date.now();
    const time = new Date(timestamp).getTime();
    const diffMs = now - time;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);

    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    const diffDay = Math.floor(diffHour / 24);
    return `${diffDay}d ago`;
  };

  const getStatusColor = (status: string) => {
    const colors = {
      initializing: 'text-yellow-400',
      scanning: 'text-blue-400',
      trade_pending: 'text-orange-400',
      in_trade: 'text-green-400',
      soft_closing: 'text-amber-400',
      goal_achieved: 'text-emerald-400',
      expired: 'text-gray-400',
      user_stopped: 'text-red-400',
    };
    return colors[status as keyof typeof colors] || 'text-gray-400';
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'scanning':
        return <Activity className="w-5 h-5 animate-pulse" />;
      case 'in_trade':
        return <TrendingUp className="w-5 h-5" />;
      case 'soft_closing':
        return <Clock className="w-5 h-5 animate-pulse" />;
      case 'goal_achieved':
        return <CheckCircle className="w-5 h-5" />;
      case 'expired':
      case 'user_stopped':
        return <XCircle className="w-5 h-5" />;
      default:
        return <Clock className="w-5 h-5" />;
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <div className="text-center text-gray-400">Loading session...</div>
      </div>
    );
  }

  if (!activeSession) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <div className="text-center">
          <Target className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No active goal session</p>
          <p className="text-sm text-gray-500 mt-1">Create a new goal to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg p-6 border border-gray-700">
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className={`p-2 bg-gray-700 rounded-lg ${getStatusColor(activeSession.status)}`}>
              {getStatusIcon(activeSession.status)}
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Active Goal Session</h3>
              <p className="text-sm text-gray-400 capitalize">{activeSession.status.replace('_', ' ')}</p>
              {scanStatus.message && (
                <p className="text-xs text-gray-500 mt-1">{scanStatus.message}</p>
              )}
            </div>
          </div>
          <button
            onClick={handleStopSession}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium text-white transition-colors flex items-center gap-2"
          >
            <Pause className="w-4 h-4" />
            Stop Session
          </button>
        </div>

        {/* Server-Side Status Indicator */}
        {activeSession.serverHeartbeat && (
          <div className="mb-4 p-3 bg-green-900/20 border border-green-500/30 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cloud className="w-4 h-4 text-green-400 animate-pulse" />
                <span className="text-sm font-medium text-green-400">Running Autonomously in Cloud</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Wifi className="w-3 h-3" />
                <span>Last check: {formatTimeAgo(activeSession.serverHeartbeat)}</span>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              This session continues running even when you close this window.
              View from any device!
            </p>
          </div>
        )}

        {activeSession.executionMode === 'client' && !activeSession.serverHeartbeat && (
          <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-500/30 rounded-lg">
            <div className="flex items-center gap-2">
              <WifiOff className="w-4 h-4 text-yellow-400" />
              <span className="text-sm font-medium text-yellow-400">Browser-Only Mode</span>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Keep this window open. Session will stop if you close the browser.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-gray-700/50 rounded-lg p-4">
            <div className="text-sm text-gray-400 mb-1">Target</div>
            <div className="text-2xl font-bold text-white">
              ${activeSession.config.goalAmount.toFixed(0)}
            </div>
          </div>
          <div className="bg-gray-700/50 rounded-lg p-4">
            <div className="text-sm text-gray-400 mb-1">Progress</div>
            <div className="text-2xl font-bold text-blue-400">
              ${(progress?.stats?.totalProfit || 0).toFixed(2)}
            </div>
          </div>
          <div className="bg-gray-700/50 rounded-lg p-4">
            <div className="text-sm text-gray-400 mb-1">Completion</div>
            <div className="text-2xl font-bold text-green-400">
              {progress?.session?.progress_percentage ? progress.session.progress_percentage.toFixed(1) : '0.0'}%
            </div>
          </div>
          <div className="bg-gray-700/50 rounded-lg p-4">
            <div className="text-sm text-gray-400 mb-1">Trades</div>
            <div className="text-lg font-bold text-orange-400">
              {progress?.stats?.closedTradesCount || 0} / {activeSession.strategy.targetTradeCount}
            </div>
          </div>
        </div>

        <div className="mb-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-400">Goal Progress</span>
            <span className="text-white font-medium">{progress?.session?.progress_percentage ? progress.session.progress_percentage.toFixed(1) : '0.0'}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
            <div
              className="bg-gradient-to-r from-blue-500 to-green-500 h-full transition-all duration-500"
              style={{ width: `${Math.min(progress?.session?.progress_percentage || 0, 100)}%` }}
            />
          </div>
        </div>

        {progress && progress.stats && (
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-white">{progress.stats.totalTrades || 0}</div>
              <div className="text-xs text-gray-400">Total Trades</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-400">{(progress.stats.winRate || 0).toFixed(0)}%</div>
              <div className="text-xs text-gray-400">Win Rate</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-400">${(progress.stats.totalProfit || 0).toFixed(2)}</div>
              <div className="text-xs text-gray-400">Total Profit</div>
            </div>
          </div>
        )}
      </div>

      {activeSession && activeSession.status === 'scanning' && (
        <div>
          {/* Show block status if system is blocked by adversarial conditions */}
          {activeSession.block_state ? (
            <div className="bg-yellow-900/30 border border-yellow-500/50 rounded-lg p-5">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <AlertTriangle className="w-6 h-6 text-yellow-400" />
                </div>
                <div className="flex-1">
                  <h4 className="text-yellow-200 font-semibold mb-2 flex items-center gap-2">
                    Protected from Manipulation
                    {activeSession.block_candles_ago > 0 && (
                      <span className="text-xs bg-yellow-900/50 px-2 py-1 rounded-full">
                        {activeSession.block_candles_ago} candles ago
                      </span>
                    )}
                  </h4>
                  <p className="text-yellow-100 text-sm mb-3">
                    {activeSession.block_reason || 'Market conditions detected that suggest manipulation or high risk'}
                  </p>
                  <div className="flex items-center gap-4 text-xs text-yellow-200/80">
                    {activeSession.block_expires_at && (
                      <div className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        <span>
                          Expires: {new Date(activeSession.block_expires_at).toLocaleTimeString()}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <Shield className="w-4 h-4" />
                      <span>Your account is protected</span>
                    </div>
                  </div>
                  <div className="mt-3 text-xs text-yellow-200/60">
                    The system will automatically resume scanning when market conditions stabilize.
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4 text-blue-200">
              <div className="animate-pulse flex items-center gap-2">
                <Search className="w-5 h-5" />
                <span>Scanning {activeSession.config.watchlist.length} pairs for opportunities...</span>
              </div>
            </div>
          )}
        </div>
      )}

      {activeSession && (
        <MarketAnalysisStream
          sessionId={activeSession.sessionId}
          watchlist={activeSession.config.watchlist}
        />
      )}

      {conversations.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h4 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-400" />
            AI Analysis Updates
          </h4>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {conversations.slice(-10).reverse().map((convo) => (
              <div
                key={convo.id}
                className={`p-4 rounded-lg ${
                  convo.role === 'ai' ? 'bg-blue-900/20 border-l-4 border-blue-500' : 'bg-gray-700'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <p className="text-sm text-gray-200 leading-relaxed">{convo.message}</p>
                  </div>
                  <span className="text-xs text-gray-500 whitespace-nowrap ml-3">
                    {new Date(convo.created_at).toLocaleTimeString()}
                  </span>
                </div>

                {convo.technical_data && Object.keys(convo.technical_data).length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-700">
                    <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
                      <BarChart2 className="w-3 h-3" />
                      <span>Technical Data:</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {convo.technical_data?.ema20 && (
                        <div>
                          <span className="text-gray-500">EMA20:</span>
                          <span className="text-gray-300 ml-1 font-mono">{Number(convo.technical_data.ema20).toFixed(5)}</span>
                        </div>
                      )}
                      {convo.technical_data?.ema50 && (
                        <div>
                          <span className="text-gray-500">EMA50:</span>
                          <span className="text-gray-300 ml-1 font-mono">{Number(convo.technical_data.ema50).toFixed(5)}</span>
                        </div>
                      )}
                      {convo.technical_data?.vwap && (
                        <div>
                          <span className="text-gray-500">VWAP:</span>
                          <span className="text-gray-300 ml-1 font-mono">{Number(convo.technical_data.vwap).toFixed(5)}</span>
                        </div>
                      )}
                      {convo.technical_data?.atr && (
                        <div>
                          <span className="text-gray-500">ATR:</span>
                          <span className="text-gray-300 ml-1 font-mono">{Number(convo.technical_data.atr).toFixed(5)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {convo.market_snapshot && Object.keys(convo.market_snapshot).length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-700">
                    <div className="flex items-center gap-4 text-xs">
                      {convo.market_snapshot.trend && (
                        <div>
                          <span className="text-gray-500">Trend:</span>
                          <span className={`ml-1 font-semibold capitalize ${
                            convo.market_snapshot.trend === 'bullish' ? 'text-green-400' :
                            convo.market_snapshot.trend === 'bearish' ? 'text-red-400' : 'text-gray-400'
                          }`}>{convo.market_snapshot.trend}</span>
                        </div>
                      )}
                      {convo.market_snapshot.volatility && (
                        <div>
                          <span className="text-gray-500">Volatility:</span>
                          <span className="ml-1 font-semibold text-yellow-400 capitalize">{convo.market_snapshot.volatility}</span>
                        </div>
                      )}
                      {convo.market_snapshot.confidence && (
                        <div>
                          <span className="text-gray-500">Confidence:</span>
                          <span className="ml-1 font-semibold text-blue-400">{convo.market_snapshot.confidence}%</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {notifications.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-6 border border-yellow-600">
          <h4 className="text-lg font-bold text-white mb-4">Notifications ({notifications.length})</h4>
          <div className="space-y-2">
            {notifications.slice(0, 5).map((notif) => (
              <div
                key={notif.id}
                className="p-3 bg-gray-700 rounded-lg cursor-pointer hover:bg-gray-600"
                onClick={() => goalNotificationSystem.acknowledgeNotification(notif.id)}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-medium text-white">{notif.title}</div>
                    <div className="text-xs text-gray-400 mt-1">{notif.message.substring(0, 100)}...</div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded ${
                    notif.priority === 'urgent' ? 'bg-red-600' :
                    notif.priority === 'high' ? 'bg-orange-600' : 'bg-blue-600'
                  }`}>
                    {notif.priority}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
