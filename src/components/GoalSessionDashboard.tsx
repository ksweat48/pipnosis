import React, { useState, useEffect } from 'react';
import { Target, TrendingUp, Clock, Activity, CheckCircle, XCircle, Pause, Play } from 'lucide-react';
import { goalSessionManager, GoalSession } from '../services/goal-session-manager';
import { goalNotificationSystem } from '../services/goal-notifications';
import { useAuth } from '../hooks/useAuth';

export const GoalSessionDashboard: React.FC = () => {
  const { user } = useAuth();
  const [activeSession, setActiveSession] = useState<GoalSession | null>(null);
  const [progress, setProgress] = useState<any>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSessionData();

    const interval = setInterval(loadSessionData, 10000);

    const handleSessionCreated = () => {
      loadSessionData();
    };

    window.addEventListener('goal-session-created', handleSessionCreated);

    return () => {
      clearInterval(interval);
      window.removeEventListener('goal-session-created', handleSessionCreated);
    };
  }, [user]);

  const loadSessionData = async () => {
    if (!user) return;

    try {
      const session = await goalSessionManager.getActiveSession(user.id);
      setActiveSession(session);

      if (session) {
        const [progressData, convos, notifs] = await Promise.all([
          goalSessionManager.getSessionProgress(session.id),
          goalSessionManager.getSessionConversations(session.id, 20),
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

    const confirmed = window.confirm('Are you sure you want to stop this goal session?');
    if (!confirmed) return;

    const success = await goalSessionManager.stopSession(activeSession.id, user.id);
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

  const getStatusColor = (status: string) => {
    const colors = {
      initializing: 'text-yellow-400',
      scanning: 'text-blue-400',
      trade_pending: 'text-orange-400',
      in_trade: 'text-green-400',
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

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-gray-700/50 rounded-lg p-4">
            <div className="text-sm text-gray-400 mb-1">Target</div>
            <div className="text-2xl font-bold text-white">
              ${activeSession.target_value.toFixed(0)}
            </div>
          </div>
          <div className="bg-gray-700/50 rounded-lg p-4">
            <div className="text-sm text-gray-400 mb-1">Progress</div>
            <div className="text-2xl font-bold text-blue-400">
              ${activeSession.current_progress.toFixed(2)}
            </div>
          </div>
          <div className="bg-gray-700/50 rounded-lg p-4">
            <div className="text-sm text-gray-400 mb-1">Completion</div>
            <div className="text-2xl font-bold text-green-400">
              {activeSession.progress_percentage.toFixed(1)}%
            </div>
          </div>
          <div className="bg-gray-700/50 rounded-lg p-4">
            <div className="text-sm text-gray-400 mb-1">Time Left</div>
            <div className="text-lg font-bold text-orange-400">
              {formatTimeRemaining(activeSession.end_time || '')}
            </div>
          </div>
        </div>

        <div className="mb-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-400">Goal Progress</span>
            <span className="text-white font-medium">{activeSession.progress_percentage.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
            <div
              className="bg-gradient-to-r from-blue-500 to-green-500 h-full transition-all duration-500"
              style={{ width: `${Math.min(activeSession.progress_percentage, 100)}%` }}
            />
          </div>
        </div>

        {progress && progress.stats && (
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-white">{progress.stats.totalTrades}</div>
              <div className="text-xs text-gray-400">Total Trades</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-400">{progress.stats.winRate.toFixed(0)}%</div>
              <div className="text-xs text-gray-400">Win Rate</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-400">${progress.stats.bestTrade.toFixed(2)}</div>
              <div className="text-xs text-gray-400">Best Trade</div>
            </div>
          </div>
        )}
      </div>

      {conversations.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h4 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-400" />
            AI Updates
          </h4>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {conversations.slice(-10).reverse().map((convo) => (
              <div
                key={convo.id}
                className={`p-3 rounded-lg ${
                  convo.role === 'ai' ? 'bg-blue-900/20 border-l-2 border-blue-500' : 'bg-gray-700'
                }`}
              >
                <div className="flex items-start justify-between">
                  <p className="text-sm text-gray-300">{convo.message}</p>
                  <span className="text-xs text-gray-500 whitespace-nowrap ml-2">
                    {new Date(convo.created_at).toLocaleTimeString()}
                  </span>
                </div>
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
