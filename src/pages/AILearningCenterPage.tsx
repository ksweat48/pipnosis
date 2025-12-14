import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Brain, Globe, Package } from 'lucide-react';
import { NavigationMenu } from '../components/NavigationMenu';
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PlatformIntelligenceDashboard } from '../components/PlatformIntelligenceDashboard';
import { GlobalPatternsList } from '../components/GlobalPatternsList';

type TabId = 'platform-intelligence' | 'pattern-discovery';

function AILearningCenterPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>('platform-intelligence');

  const pullToRefresh = usePullToRefresh({
    onRefresh: async () => {
      window.location.reload();
    },
    enabled: true
  });

  if (!user) {
    return (
      <div className="flex items-center justify-center app-viewport" ref={pullToRefresh.containerRef}>
        <PullToRefreshIndicator
          isPulling={pullToRefresh.isPulling}
          isRefreshing={pullToRefresh.isRefreshing}
          pullDistance={pullToRefresh.pullDistance}
          threshold={pullToRefresh.threshold}
        />
        <div className="text-center">
          <Brain className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">Please sign in to access the AI Learning Center</p>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'platform-intelligence', label: 'Platform Intelligence', icon: Globe },
    { id: 'pattern-discovery', label: 'Pattern Discovery', icon: Package }
  ];

  return (
    <>
      <NavigationMenu />
      <div className="app-viewport bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-6" ref={pullToRefresh.containerRef}>
        <PullToRefreshIndicator
          isPulling={pullToRefresh.isPulling}
          isRefreshing={pullToRefresh.isRefreshing}
          pullDistance={pullToRefresh.pullDistance}
          threshold={pullToRefresh.threshold}
        />
        <div className="max-w-7xl mx-auto">
          <div className="bg-gradient-to-br from-emerald-900/30 to-blue-900/30 backdrop-blur-sm border-2 border-emerald-500/30 rounded-lg shadow-md p-6 mb-6">
            <div className="flex items-center gap-3 mb-2">
              <Brain className="w-10 h-10 text-emerald-400" />
              <h1 className="text-3xl font-bold text-white">AI Learning Center</h1>
            </div>
            <p className="text-gray-400">
              Platform-wide collective intelligence from all trading activity
            </p>
          </div>

          <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-2 mb-6">
            <div className="flex gap-2">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as TabId)}
                    className={`flex items-center gap-2 px-4 py-3 rounded-lg transition-all whitespace-nowrap ${
                      isActive
                        ? 'bg-emerald-600 text-white shadow-lg'
                        : 'bg-gray-900/50 text-gray-400 hover:bg-gray-700 hover:text-white'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="font-semibold text-sm">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-6">
            {activeTab === 'platform-intelligence' && (
              <PlatformIntelligenceDashboard userId={user.id} />
            )}

            {activeTab === 'pattern-discovery' && (
              <GlobalPatternsList />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default AILearningCenterPage;
