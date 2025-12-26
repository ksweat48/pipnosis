import React, { useState, useEffect } from 'react';
import { NavigationMenu } from '@/components/NavigationMenu';
import { BottomNavigation } from '@/components/BottomNavigation';
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { SmartGoalPanel } from '@/components/SmartGoalPanel';
import { GoalSessionDashboard } from '@/components/GoalSessionDashboard';
import { AchievementsHallOfFame } from '@/components/AchievementsHallOfFame';
import { PendingContinuationModalHandler } from '@/components/PendingContinuationModalHandler';
import { useAuth } from '@/hooks/useAuth';
import { Target, Trophy } from 'lucide-react';

type TabType = 'start' | 'achievements';

export function AITradePage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    // Check URL parameters first
    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get('tab');
    if (tabParam === 'achievements') return 'achievements';

    // Then check localStorage
    const saved = localStorage.getItem('ai-trade-tab');
    return (saved as TabType) || 'start';
  });

  const pullToRefresh = usePullToRefresh({
    onRefresh: async () => {
      window.location.reload();
    },
    enabled: true
  });

  useEffect(() => {
    localStorage.setItem('ai-trade-tab', activeTab);
  }, [activeTab]);

  // Listen for custom event to switch tabs
  useEffect(() => {
    const handleSwitchToAchievements = () => {
      console.log('[AITradePage] Received event to switch to achievements tab');
      setActiveTab('achievements');
    };

    window.addEventListener('switch-to-achievements-tab', handleSwitchToAchievements);

    return () => {
      window.removeEventListener('switch-to-achievements-tab', handleSwitchToAchievements);
    };
  }, []);

  return (
    <div className="app-viewport bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 relative" ref={pullToRefresh.containerRef}>
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-blue-500/5 pointer-events-none" />

      <div className="absolute top-20 left-10 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-20 right-10 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />

      <PullToRefreshIndicator
        isPulling={pullToRefresh.isPulling}
        isRefreshing={pullToRefresh.isRefreshing}
        pullDistance={pullToRefresh.pullDistance}
        threshold={pullToRefresh.threshold}
      />
      {user && <PendingContinuationModalHandler userId={user.id} />}
      <NavigationMenu />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12 relative z-10">
        <div className="mb-8">
          <div className="flex items-center gap-3 bg-gray-800/50 rounded-xl p-1.5 border border-gray-700/50 backdrop-blur-sm max-w-md">
            <button
              onClick={() => setActiveTab('start')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-all duration-300 ${
                activeTab === 'start'
                  ? 'bg-gradient-to-r from-emerald-600 to-blue-600 text-white shadow-lg shadow-emerald-500/25'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              <Target className="w-5 h-5" />
              <span>Session</span>
            </button>
            <button
              onClick={() => setActiveTab('achievements')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-all duration-300 ${
                activeTab === 'achievements'
                  ? 'bg-gradient-to-r from-emerald-600 to-blue-600 text-white shadow-lg shadow-emerald-500/25'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              <Trophy className="w-5 h-5" />
              <span>Achievements</span>
            </button>
          </div>
        </div>

        <div className="space-y-6">
          {activeTab === 'start' ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="lg:col-span-1">
                <SmartGoalPanel />
              </div>

              <div className="lg:col-span-2">
                <GoalSessionDashboard />
              </div>
            </div>
          ) : (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <AchievementsHallOfFame />
            </div>
          )}
        </div>
      </main>

      <BottomNavigation />
    </div>
  );
}
