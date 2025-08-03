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
    <div className="glass-card">
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold text-white flex items-center space-x-3">
            <div className="p-3 bg-emerald-500/20 rounded-xl">
              <Bell className="h-5 w-5 text-emerald-400" />
            </div>
            <span>Notifications</span>
            {unreadCount > 0 && (
              <span className="bg-red-500 text-white text-xs px-3 py-1 rounded-full animate-pulse font-bold">
                {unreadCount}
              </span>
            )}
          </h3>
          {isCollapsible && (
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-2 text-white/60 hover:text-white glass-button transition-all duration-200"
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
        <div className="max-h-96 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="p-8 text-center">
              <Bell className="h-16 w-16 text-white/20 mx-auto mb-4" />
              <p className="text-white/60 font-semibold">No notifications yet</p>
              <p className="text-white/40 text-sm mt-2 font-medium">AI guidance will appear here when you have active trades</p>
            </div>
          ) : (
            <div className="divide-y divide-white/10">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`p-6 border-l-4 ${getNotificationBorder(notification.type)} ${getNotificationBg(notification.type)} ${
                    !notification.read ? 'bg-white/5' : ''
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-4 flex-1 min-w-0">
                      {getNotificationIcon(notification.type)}
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-white text-lg">{notification.title}</h4>
                        <p className="text-white/70 mt-2 leading-relaxed font-medium">{notification.message}</p>
                        <p className="text-white/40 text-sm mt-3 font-medium">{notification.timestamp}</p>
                      </div>
                    </div>
                    
                    <div className="flex flex-col items-end space-y-2 ml-4">
                      {!notification.read && (
                        <button
                          onClick={() => onMarkAsRead(notification.id)}
                          className="text-emerald-400 hover:text-emerald-300 text-sm font-medium whitespace-nowrap"
                        >
                          Mark read
                        </button>
                      )}
                      <button
                        onClick={() => onDismiss(notification.id)}
                        className="text-white/40 hover:text-white transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
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