import { useEffect, useState } from 'react';
import { X, Clock, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { MidTradeNotification, midTradeNotificationQueue } from '@/services/mid-trade-notification-queue';

interface NotificationHistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  sessionId: string | null;
}

export default function NotificationHistoryPanel({
  isOpen,
  onClose,
  userId,
  sessionId
}: NotificationHistoryPanelProps) {
  const [notifications, setNotifications] = useState<MidTradeNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen && sessionId) {
      loadNotifications();
    }
  }, [isOpen, sessionId]);

  const loadNotifications = async () => {
    if (!sessionId) return;

    setLoading(true);
    const { data, error } = await supabase
      .from('goal_notifications')
      .select('*')
      .eq('user_id', userId)
      .eq('goal_session_id', sessionId)
      .in('type', ['mid_trade_trigger', 'mid_trade_evaluation', 'mid_trade_action'])
      .order('created_at', { ascending: false });

    if (!error && data) {
      setNotifications(data as MidTradeNotification[]);

      data.forEach((notification) => {
        if (!notification.viewed) {
          midTradeNotificationQueue.markAsViewed(notification.id);
        }
      });
    }
    setLoading(false);
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'border-red-500 bg-red-950/20';
      case 'high':
        return 'border-orange-500 bg-orange-950/20';
      case 'medium':
        return 'border-yellow-500 bg-yellow-950/20';
      case 'low':
        return 'border-blue-500 bg-blue-950/20';
      default:
        return 'border-slate-500 bg-slate-950/20';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'mid_trade_trigger':
        return <AlertTriangle size={16} className="text-yellow-400" />;
      case 'mid_trade_evaluation':
        return <Clock size={16} className="text-blue-400" />;
      case 'mid_trade_action':
        return <CheckCircle2 size={16} className="text-green-400" />;
      default:
        return <AlertTriangle size={16} className="text-slate-400" />;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-4xl max-h-[80vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <div>
            <h2 className="text-2xl font-bold text-white">Mid-Trade Notifications</h2>
            <p className="text-slate-400 text-sm mt-1">
              {notifications.length} notification{notifications.length !== 1 ? 's' : ''} from this session
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X size={24} className="text-slate-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="text-center py-12">
              <AlertTriangle size={48} className="text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">No mid-trade notifications yet</p>
            </div>
          ) : (
            <div className="space-y-4">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`
                    rounded-xl border-2 p-4 transition-all duration-200
                    ${getPriorityColor(notification.priority)}
                    ${!notification.viewed ? 'ring-2 ring-blue-500/50' : ''}
                  `}
                >
                  <div className="flex items-start gap-4">
                    <div className="mt-1">{getTypeIcon(notification.type)}</div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-white font-semibold">
                          {notification.trade_context?.symbol}
                        </span>
                        {notification.trade_context?.direction === 'buy' ? (
                          <TrendingUp size={16} className="text-green-400" />
                        ) : (
                          <TrendingDown size={16} className="text-red-400" />
                        )}
                        <span className="text-xs text-slate-400 flex items-center gap-1">
                          <Clock size={12} />
                          {formatTime(notification.created_at)}
                        </span>
                        {!notification.viewed && (
                          <span className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full">
                            New
                          </span>
                        )}
                      </div>

                      {notification.recommendation_data && (
                        <>
                          <div className="mb-2">
                            <div className="text-sm font-semibold text-slate-300 mb-1">
                              {notification.recommendation_data.trigger_type}
                            </div>
                            <div className="text-sm text-slate-400">
                              {notification.recommendation_data.trigger_reason}
                            </div>
                          </div>

                          <div className="bg-slate-800/50 rounded-lg p-3 mb-2">
                            <div className="text-xs text-slate-400 mb-1">AI Recommendation</div>
                            <div className="text-sm text-white font-medium">
                              {notification.recommendation_data.llm_recommendation}
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div className="bg-slate-800/50 rounded px-2 py-1">
                              <div className="text-slate-400">Action</div>
                              <div className="text-white font-semibold">
                                {notification.recommendation_data.action_taken}
                              </div>
                            </div>
                            {notification.trade_context && (
                              <>
                                <div className="bg-slate-800/50 rounded px-2 py-1">
                                  <div className="text-slate-400">P&L</div>
                                  <div
                                    className={`font-semibold ${
                                      notification.trade_context.pnl >= 0
                                        ? 'text-green-400'
                                        : 'text-red-400'
                                    }`}
                                  >
                                    ${notification.trade_context.pnl.toFixed(2)}
                                  </div>
                                </div>
                                <div className="bg-slate-800/50 rounded px-2 py-1">
                                  <div className="text-slate-400">R Multiple</div>
                                  <div
                                    className={`font-semibold ${
                                      notification.trade_context.r_multiple >= 0
                                        ? 'text-green-400'
                                        : 'text-red-400'
                                    }`}
                                  >
                                    {notification.trade_context.r_multiple >= 0 ? '+' : ''}
                                    {notification.trade_context.r_multiple.toFixed(2)}R
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-slate-700">
          <button
            onClick={onClose}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
