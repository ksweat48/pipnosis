import React, { useEffect } from 'react';
import { NavigationMenu } from '@/components/NavigationMenu';
import { GlobalPollingStatus } from '@/components/GlobalPollingStatus';
import { AITradeJournal } from '@/components/AITradeJournal';
import { pageContext } from '@/services/page-context';

export function AIJournalPage() {
  useEffect(() => {
    pageContext.setPage('journal');
    return () => pageContext.setPage('other');
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950">
      <NavigationMenu />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="mb-6">
          <GlobalPollingStatus />
        </div>

        <AITradeJournal />
      </main>
    </div>
  );
}
