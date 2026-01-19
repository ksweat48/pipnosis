import React, { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { LogOut, User, Bell } from 'lucide-react';
import { BalanceDisplay } from './BalanceDisplay';
import { ServerSideAggregatorStatus } from './ServerSideAggregatorStatus';
import { useUserBalance } from '@/hooks/useUserBalance';
import { midTradeNotificationQueue } from '@/services/mid-trade-notification-queue';
import NotificationHistoryPanel from './NotificationHistoryPanel';
import { LowCreditWarning } from './LowCreditWarning';

export function Header() {
  const { user, signOut } = useAuth();
  const [balanceRefresh, setBalanceRefresh] = useState(0);
  const { balance = 10000, totalPnL = 0 } = useUserBalance(user?.id || null);
  const [unviewedCount, setUnviewedCount] = useState(0);
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

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

  useEffect(() => {
    const loadCurrentSession = async () => {
      if (!user?.id) return;

      const { data } = await import('@/lib/supabase').then(m => m.supabase)
        .from('goal_sessions')
        .select('id')
        .eq('user_id', user.id)
        .in('status', ['active', 'scanning'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        setCurrentSessionId(data[0].id);
      } else {
        setCurrentSessionId(null);
      }
    };

    loadCurrentSession();
  }, [user?.id]);

  return (
    <header className="bg-gray-900/50 backdrop-blur-sm border-b border-gray-800">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
        <div className="flex flex-col gap-2 sm:gap-3">
          {/* Mobile: Icon - Balance - User Menu Layout */}
          <div className="flex sm:hidden items-center justify-between gap-2">
            {/* Left: Pipnosis Icon */}
            <div className="w-10 h-10 bg-gradient-to-br from-teal-500 to-emerald-600 rounded-xl flex items-center justify-center shrink-0">
              <span className="text-white font-bold text-lg">P</span>
            </div>

            {/* Center: Balance with P&L */}
            <div className="flex flex-col items-center justify-center flex-1 bg-gray-800/80 rounded-lg px-3 py-2 min-w-0">
              <div className="text-lg font-bold text-white leading-tight">
                ${typeof balance === 'number' ? balance.toFixed(0) : '10000'}
              </div>
              <div className={`text-sm font-semibold leading-tight ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {totalPnL >= 0 ? '+' : ''}${typeof totalPnL === 'number' ? Math.abs(totalPnL).toFixed(2) : '0.00'}
              </div>
            </div>

            {/* Right: Notification Bell + User Menu */}
            {user && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setShowNotificationPanel(true)}
                  className="relative w-10 h-10 bg-slate-700 hover:bg-slate-600 rounded-full flex items-center justify-center transition-colors"
                >
                  <Bell size={20} className="text-white" />
                  {unviewedCount > 0 && (
                    <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1">
                      {unviewedCount > 9 ? '9+' : unviewedCount}
                    </div>
                  )}
                </button>
                <button
                  onClick={() => signOut()}
                  className="w-10 h-10 bg-green-600 hover:bg-green-700 rounded-full flex items-center justify-center transition-colors"
                >
                  <User size={20} className="text-white" />
                </button>
              </div>
            )}
          </div>

          {/* Desktop: Original Layout */}
          <div className="hidden sm:flex items-center justify-between gap-2">
            <h1 className="text-lg sm:text-2xl font-bold text-white truncate">Pipnosis AI</h1>
            {user && (
              <div className="flex items-center gap-2 sm:gap-6">
                <BalanceDisplay refreshTrigger={balanceRefresh} />
                <button
                  onClick={() => setShowNotificationPanel(true)}
                  className="relative p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
                >
                  <Bell size={20} className="text-white" />
                  {unviewedCount > 0 && (
                    <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1">
                      {unviewedCount > 9 ? '9+' : unviewedCount}
                    </div>
                  )}
                </button>
                <button
                  onClick={() => signOut()}
                  className="flex items-center gap-2 px-3 py-2 sm:px-4 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors shrink-0"
                >
                  <LogOut size={16} className="sm:w-[18px] sm:h-[18px]" />
                  <span className="hidden sm:inline">Sign Out</span>
                </button>
              </div>
            )}
          </div>
          {user && (
            <>
              <ServerSideAggregatorStatus />
              <LowCreditWarning showInHeader={true} />
            </>
          )}
        </div>
      </div>

      {user && (
        <NotificationHistoryPanel
          isOpen={showNotificationPanel}
          onClose={() => setShowNotificationPanel(false)}
          userId={user.id}
          sessionId={currentSessionId}
        />
      )}
    </header>
  );
}
