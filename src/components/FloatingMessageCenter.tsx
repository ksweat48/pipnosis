import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, X, Bot, TrendingUp, AlertTriangle, CheckCircle, Clock, Target, BarChart3, Play, StopCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { audioAlertService } from '@/services/audio-alert-service';

interface Message {
  id: string;
  type: 'ai_conversation' | 'notification';
  message: string;
  timestamp: string;
  priority?: string;
  sentiment?: string;
  notification_type?: string;
  viewed?: boolean;
  context?: any;
}

interface FloatingMessageCenterProps {
  userId: string;
}

export const FloatingMessageCenter: React.FC<FloatingMessageCenterProps> = ({ userId }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showPulse, setShowPulse] = useState(false);
  const hasPlayedSoundRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    loadMessages();

    const conversationChannel = supabase
      .channel('floating-ai-conversations')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'goal_ai_conversations',
          filter: `user_id=eq.${userId}`
        },
        (payload) => {
          // Filter out silent wellness checks (displayed in UI component, not as notifications)
          const metadata = payload.new.metadata || {};
          if (metadata.silent === true) {
            console.log('[FloatingMessageCenter] Skipping silent wellness check');
            return;
          }

          const newMessage: Message = {
            id: payload.new.id,
            type: 'ai_conversation',
            message: payload.new.message,
            timestamp: payload.new.created_at,
            sentiment: payload.new.sentiment,
            context: payload.new.context
          };

          handleNewMessage(newMessage);
        }
      )
      .subscribe();

    const notificationChannel = supabase
      .channel('floating-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'goal_notifications',
          filter: `user_id=eq.${userId}`
        },
        (payload) => {
          const newMessage: Message = {
            id: payload.new.id,
            type: 'notification',
            message: payload.new.message,
            timestamp: payload.new.created_at,
            priority: payload.new.priority,
            notification_type: payload.new.type,
            viewed: payload.new.viewed || false
          };

          handleNewMessage(newMessage);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(conversationChannel);
      supabase.removeChannel(notificationChannel);
    };
  }, [userId]);

  const loadMessages = async () => {
    try {
      const [conversationsResult, notificationsResult] = await Promise.all([
        supabase
          .from('goal_ai_conversations')
          .select('*')
          .eq('user_id', userId)
          .eq('role', 'ai')
          .order('created_at', { ascending: false })
          .limit(50),

        supabase
          .from('goal_notifications')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(50)
      ]);

      // Filter out any messages with silent=true in metadata
      const conversations: Message[] = (conversationsResult.data || [])
        .filter(conv => {
          const metadata = conv.metadata || {};
          return metadata.silent !== true;
        })
        .map(conv => ({
          id: conv.id,
          type: 'ai_conversation' as const,
          message: conv.message,
          timestamp: conv.created_at,
          sentiment: conv.sentiment,
          context: conv.context
        }));

      const notifications: Message[] = (notificationsResult.data || []).map(notif => ({
        id: notif.id,
        type: 'notification' as const,
        message: notif.message,
        timestamp: notif.created_at,
        priority: notif.priority,
        notification_type: notif.type,
        viewed: notif.viewed || false
      }));

      const allMessages = [...conversations, ...notifications].sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      setMessages(allMessages);

      const unviewed = notifications.filter(n => !n.viewed).length;
      setUnreadCount(unviewed);
    } catch (error) {
      console.error('[FloatingMessageCenter] Error loading messages:', error);
    }
  };

  const handleNewMessage = (newMessage: Message) => {
    setMessages(prev => [newMessage, ...prev]);

    if (newMessage.type === 'notification' && !newMessage.viewed) {
      setUnreadCount(prev => prev + 1);
    }

    if (!hasPlayedSoundRef.current.has(newMessage.id)) {
      audioAlertService.playWithContext({ type: 'attention', context: `msg:${newMessage.id}` });
      hasPlayedSoundRef.current.add(newMessage.id);

      setShowPulse(true);
      setTimeout(() => setShowPulse(false), 1000);
    }
  };

  const handleOpenPanel = async () => {
    setIsOpen(true);

    const notificationIds = messages
      .filter(m => m.type === 'notification' && !m.viewed)
      .map(m => m.id);

    if (notificationIds.length > 0) {
      try {
        await supabase
          .from('goal_notifications')
          .update({ viewed: true })
          .in('id', notificationIds);

        setMessages(prev => prev.map(m =>
          m.type === 'notification' ? { ...m, viewed: true } : m
        ));

        setUnreadCount(0);
      } catch (error) {
        console.error('[FloatingMessageCenter] Error marking messages as viewed:', error);
      }
    }
  };

  const handleClosePanel = () => {
    setIsOpen(false);
  };

  const getMessageIcon = (message: Message) => {
    if (message.type === 'ai_conversation') {
      return <Bot size={16} className="text-blue-400" />;
    }

    switch (message.notification_type) {
      case 'signal':
        return <TrendingUp size={16} className="text-emerald-400" />;
      case 'alert':
      case 'mid_trade_trigger':
        return <AlertTriangle size={16} className="text-orange-400" />;
      case 'completion':
        return <CheckCircle size={16} className="text-green-400" />;
      case 'entry_monitoring_started':
        return <Target size={16} className="text-blue-400" />;
      case 'entry_quality_improving':
        return <BarChart3 size={16} className="text-yellow-400" />;
      case 'entry_quality_ready':
        return <Play size={16} className="text-green-400" />;
      case 'entry_abandoned':
        return <StopCircle size={16} className="text-gray-400" />;
      default:
        return <MessageCircle size={16} className="text-gray-400" />;
    }
  };

  const getMessageStyle = (message: Message) => {
    if (message.type === 'ai_conversation') {
      return 'border-blue-500/30 bg-blue-500/5';
    }

    switch (message.notification_type) {
      case 'signal':
        return 'border-emerald-500/30 bg-emerald-500/5';
      case 'alert':
      case 'mid_trade_trigger':
        return 'border-orange-500/30 bg-orange-500/5';
      case 'completion':
        return 'border-green-500/30 bg-green-500/5';
      case 'entry_monitoring_started':
        return 'border-blue-500/30 bg-blue-500/5';
      case 'entry_quality_improving':
        return 'border-yellow-500/30 bg-yellow-500/5';
      case 'entry_quality_ready':
        return 'border-green-500/30 bg-green-500/5';
      case 'entry_abandoned':
        return 'border-gray-600/30 bg-gray-700/5';
      default:
        return 'border-gray-700/30 bg-gray-800/30';
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <>
      <button
        onClick={handleOpenPanel}
        className={`fixed bottom-20 right-4 z-50 bg-gradient-to-br from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white rounded-full p-4 shadow-lg transition-all duration-300 ${
          showPulse ? 'animate-pulse scale-110' : ''
        }`}
        aria-label="Open messages"
      >
        <MessageCircle size={24} />

        {unreadCount > 0 && (
          <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1 animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </div>
        )}
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm"
            onClick={handleClosePanel}
          />

          <div className="fixed bottom-0 left-0 right-0 z-50 h-[50vh] bg-gray-900/95 backdrop-blur-md border-t border-gray-700/50 rounded-t-2xl shadow-2xl animate-slide-up">
            <div className="h-full flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/50">
                <div className="flex items-center gap-3">
                  <MessageCircle size={20} className="text-blue-400" />
                  <h2 className="text-white font-semibold text-lg">Messages</h2>
                  {messages.length > 0 && (
                    <span className="text-white/50 text-sm">({messages.length})</span>
                  )}
                </div>

                <button
                  onClick={handleClosePanel}
                  className="text-white/70 hover:text-white transition-colors p-1 hover:bg-white/10 rounded"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 custom-scrollbar">
                {messages.length === 0 ? (
                  <div className="text-center text-white/50 py-12">
                    <MessageCircle size={48} className="mx-auto mb-4 opacity-30" />
                    <p>No messages yet</p>
                  </div>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={`p-4 rounded-lg border transition-all duration-200 hover:bg-white/5 ${getMessageStyle(message)}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 mt-1">
                          {getMessageIcon(message)}
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="text-white/90 text-sm leading-relaxed mb-2">
                            {message.message}
                          </p>

                          <div className="flex items-center gap-3 text-xs text-white/50">
                            <div className="flex items-center gap-1">
                              <Clock size={12} />
                              {formatTimestamp(message.timestamp)}
                            </div>

                            {message.priority && (
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                message.priority === 'urgent' ? 'bg-red-500/20 text-red-400' :
                                message.priority === 'high' ? 'bg-orange-500/20 text-orange-400' :
                                'bg-blue-500/20 text-blue-400'
                              }`}>
                                {message.priority.toUpperCase()}
                              </span>
                            )}

                            {message.sentiment && message.sentiment !== 'neutral' && (
                              <span className="text-white/40 capitalize">
                                {message.sentiment}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes slide-up {
          from {
            transform: translateY(100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }

        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }

        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }

        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 3px;
        }

        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 3px;
        }

        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }
      `}</style>
    </>
  );
};
