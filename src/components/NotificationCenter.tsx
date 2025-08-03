import React, { useState } from 'react';
import { Bell, CheckCircle, AlertCircle, Info, X, ChevronDown, ChevronUp } from 'lucide-react';

interface Notification {
  id: string;
  type: 'success' | 'warning' | 'info' | 'error';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

interface NotificationCenterProps {
  notifications: Notification[];
  onMarkAsRead: (id: string) => void;
  onDismiss: (id: string) => void;
  isCollapsible?: boolean;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  notifications,
  onMarkAsRead,
  onDismiss,
  isCollapsible = false
}) => {
  const [isCollapsed, setIsCollapsed] = useState(true); // Default to collapsed

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'success': return <CheckCircle className="h-4 w-4 sm:h-5 sm:w-5 text-green-400" />;
      case 'warning': return <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 text-yellow-400" />;
      case 'error': return <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 text-red-400" />;
      default: return <Info className="h-4 w-4 sm:h-5 sm:w-5 text-emerald-400" />;
    }
  };

  const getNotificationBorder = (type: string) => {
    switch (type) {
      case 'success': return 'border-l-green-400';
      case 'warning': return 'border-l-yellow-400';
      case 'error': return 'border-l-red-400';
      default: return 'border-l-emerald-400';
    }
  };

  const getNotificationBg = (type: string) => {
    switch (type) {
      case 'success': return 'bg-green-500/5';
      case 'warning': return 'bg-yellow-500/5';
      case 'error': return 'bg-red-500/5';
      default: return 'bg-emerald-500/5';
    }
  };
  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700">
      <div className="p-4 sm:p-6 border-b border-slate-700">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white flex items-center space-x-2">
            <div className="p-2 bg-emerald-500/20 rounded-lg">
              <Bell className="h-5 w-5 text-emerald-400" />
            </div>
            <span>Notifications</span>
            {unreadCount > 0 && (
              <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-full animate-pulse">
                {unreadCount}
              </span>
            )}
          </h3>
          {isCollapsible && (
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            >
              {isCollapsed ? (
                <ChevronDown className="h-5 w-5" />
              ) : (
                <ChevronUp className="h-5 w-5" />
              )}
            </button>
          )}
        </div>
      </div>

      {!isCollapsed && (
        <div className="max-h-80 sm:max-h-96 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="p-4 sm:p-6 text-center text-slate-400">
              <Bell className="h-8 w-8 sm:h-12 sm:w-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm sm:text-base">No notifications yet</p>
              <p className="text-xs sm:text-sm">AI guidance will appear here when you have active trades</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-700">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`p-3 sm:p-4 border-l-4 ${getNotificationBorder(notification.type)} ${getNotificationBg(notification.type)} ${
                    !notification.read ? 'bg-slate-900/30' : ''
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-2 sm:space-x-3 flex-1 min-w-0">
                      {getNotificationIcon(notification.type)}
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-white text-sm sm:text-base">{notification.title}</h4>
                        <p className="text-xs sm:text-sm text-slate-400 mt-1 leading-relaxed">{notification.message}</p>
                        <p className="text-xs text-slate-500 mt-1 sm:mt-2">{notification.timestamp}</p>
                      </div>
            <p className="text-xs sm:text-sm">AI guidance will appear here when you have active trades</p>
                    </div>
                    
                    <div className="flex flex-col sm:flex-row items-end sm:items-center space-y-1 sm:space-y-0 sm:space-x-2 ml-2">
                      {!notification.read && (
                        <button
                          onClick={() => onMarkAsRead(notification.id)}
                          className="text-emerald-400 hover:text-emerald-300 text-xs whitespace-nowrap"
                        >
                          Mark read
                        </button>
                      )}
                      <button
                        onClick={() => onDismiss(notification.id)}
                        className="text-slate-400 hover:text-white"
                      >
                        <X className="h-3 w-3 sm:h-4 sm:w-4" />
                      </button>
                      {notification.type === 'info' && notification.title.includes('AI Guidance') && (
                        <div className="mt-2 p-2 bg-emerald-500/10 border border-emerald-500/30 rounded text-xs text-emerald-300">
                          🤖 AI Trade Assistant recommendation based on 5-minute market reassessment
                        </div>
                      )}
                      {notification.type === 'info' && notification.title.includes('AI Guidance') && (
                        <div className="mt-2 p-2 bg-blue-500/10 border border-blue-500/30 rounded text-xs text-blue-300">
                          🤖 AI Trade Assistant recommendation based on 5-minute market reassessment
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};