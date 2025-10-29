import React from 'react';
import { Notification } from '@/types/strategy';

interface Props {
  notifications: Notification[];
  onMarkAsRead: (id: string) => void;
  onDismiss: (id: string) => void;
  isCollapsible?: boolean;
}

export function NotificationCenter({ notifications, onMarkAsRead, onDismiss }: Props) {
  if (notifications.length === 0) return null;

  return (
    <div className="glass-card p-6 space-y-3">
      <h3 className="text-lg font-bold text-white">Notifications</h3>
      {notifications.map(n => (
        <div key={n.id} className="bg-gray-800 p-4 rounded flex items-start justify-between">
          <div>
            <div className="text-white font-semibold">{n.title}</div>
            <div className="text-gray-400 text-sm">{n.message}</div>
          </div>
          <button onClick={() => onDismiss(n.id)} className="text-gray-500 hover:text-white">×</button>
        </div>
      ))}
    </div>
  );
}
