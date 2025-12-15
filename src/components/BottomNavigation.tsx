import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { TrendingUp, Activity, Zap, BarChart3, BookOpen, Bell } from 'lucide-react';
import { midTradeNotificationQueue } from '@/services/mid-trade-notification-queue';
import { useAuth } from '@/hooks/useAuth';
import NotificationHistoryPanel from './NotificationHistoryPanel';
import { supabase } from '@/lib/supabase';

export function BottomNavigation() {
  const location = useLocation();
  const { user } = useAuth();
  const [unviewedCount, setUnviewedCount] = useState(0);
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  const navItems = [
    { path: '/charts', label: 'Charts', icon: TrendingUp },
    { path: '/positions', label: 'Positions', icon: Activity },
    { path: '/ai-trade', label: 'Trade', icon: Zap },
    { path: '/analysis', label: 'Analysis', icon: BarChart3 },
    { path: '/journal', label: 'Journal', icon: BookOpen },
  ];

  const isActive = (path: string) => location.pathname === path;

  // Handle notification badge updates
  useEffect(() => {
    const handleBadgeUpdate = (count: number) => {
      setUnviewedCount(count);
    };

    midTradeNotificationQueue.on('badge-update', handleBadgeUpdate);

    if (user?.id) {
      midTradeNotificationQueue.loadUnviewedCount(user.id);
    }

    return () => {
      midTradeNotificationQueue.off('badge-update', handleBadgeUpdate);
    };
  }, [user?.id]);

  // Load current session ID
  useEffect(() => {
    const loadCurrentSession = async () => {
      if (!user?.id) return;

      const { data } = await supabase
        .from('goal_sessions')
        .select('id')
        .eq('user_id', user.id)
        .in('status', ['active', 'scanning'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        setCurrentSessionId(data[0].id);
      }
    };

    loadCurrentSession();
  }, [user?.id]);

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 z-[9999] safe-area-bottom"
        style={{
          paddingBottom: 'max(8px, var(--safe-area-bottom))',
          paddingLeft: 'var(--safe-area-left)',
          paddingRight: 'var(--safe-area-right)'
        }}
      >
        <div className="flex items-center justify-around max-w-screen-xl mx-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex flex-col items-center justify-center py-2 px-3 flex-1 min-h-[60px] transition-all ${
                  active
                    ? 'text-emerald-400'
                    : 'text-gray-400 active:text-white active:bg-gray-800'
                }`}
              >
                <Icon size={22} strokeWidth={active ? 2.5 : 2} className="mb-1" />
                <span className={`text-xs ${active ? 'font-semibold' : 'font-medium'}`}>
                  {item.label}
                </span>
              </Link>
            );
          })}

          {/* Notification Bell Button */}
          {user && (
            <button
              onClick={() => setShowNotificationPanel(true)}
              className="flex flex-col items-center justify-center py-2 px-3 flex-1 min-h-[60px] transition-all text-gray-400 active:text-white active:bg-gray-800 relative"
            >
              <div className="relative">
                <Bell size={22} strokeWidth={2} className="mb-1" />
                {unviewedCount > 0 && (
                  <div className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 animate-pulse">
                    {unviewedCount > 9 ? '9+' : unviewedCount}
                  </div>
                )}
              </div>
              <span className="text-xs font-medium">
                Alerts
              </span>
            </button>
          )}
        </div>
      </nav>

      {/* Notification History Panel */}
      {user && (
        <NotificationHistoryPanel
          isOpen={showNotificationPanel}
          onClose={() => setShowNotificationPanel(false)}
          userId={user.id}
          sessionId={currentSessionId}
        />
      )}
    </>
  );
}
