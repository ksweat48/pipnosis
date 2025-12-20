import React, { useEffect } from 'react';
import { NavigationMenu } from '@/components/NavigationMenu';
import { BottomNavigation } from '@/components/BottomNavigation';
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { AITradeJournal } from '@/components/AITradeJournal';
import { pageContext } from '@/services/page-context';

export function AIJournalPage() {
  const pullToRefresh = usePullToRefresh({
    onRefresh: async () => {
      window.location.reload();
    },
    enabled: true
  });

  useEffect(() => {
    pageContext.setPage('journal');
    return () => pageContext.setPage('other');
  }, []);

  return (
    <div className="app-viewport bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 flex flex-col" ref={pullToRefresh.containerRef}>
      <PullToRefreshIndicator
        isPulling={pullToRefresh.isPulling}
        isRefreshing={pullToRefresh.isRefreshing}
        pullDistance={pullToRefresh.pullDistance}
        threshold={pullToRefresh.threshold}
      />
      <NavigationMenu />

      <main className="flex-1 overflow-hidden flex flex-col">
        <AITradeJournal />
      </main>

      <BottomNavigation />
    </div>
  );
}
