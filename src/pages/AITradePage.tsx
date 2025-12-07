import React from 'react';
import { NavigationMenu } from '@/components/NavigationMenu';
import { BottomNavigation } from '@/components/BottomNavigation';
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { SmartGoalPanel } from '@/components/SmartGoalPanel';
import { GoalSessionDashboard } from '@/components/GoalSessionDashboard';
import { TrendingUp } from 'lucide-react';

export function AITradePage() {
  const pullToRefresh = usePullToRefresh({
    onRefresh: async () => {
      window.location.reload();
    },
    enabled: true
  });

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
      <NavigationMenu />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12 relative z-10">
        <div className="mb-10">
          <div className="relative inline-block">
            <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-lg blur-sm opacity-5" />
            <h1 className="relative text-4xl sm:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 via-blue-400 to-emerald-400 mb-3">
              Pipnosis
            </h1>
          </div>

          <p className="text-gray-400 text-lg mt-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            Your AI Trading Assistant
          </p>
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1">
              <SmartGoalPanel />
            </div>

            <div className="lg:col-span-2">
              <GoalSessionDashboard />
            </div>
          </div>
        </div>
      </main>

      <BottomNavigation />
    </div>
  );
}
