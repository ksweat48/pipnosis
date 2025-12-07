import React, { useEffect } from 'react';
import { NavigationMenu } from '@/components/NavigationMenu';
import { AITradeJournal } from '@/components/AITradeJournal';
import { pageContext } from '@/services/page-context';

export function AIJournalPage() {
  useEffect(() => {
    pageContext.setPage('journal');
    return () => pageContext.setPage('other');
  }, []);

  return (
    <div className="chart-page-container bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 flex flex-col">
      <NavigationMenu />

      <main className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto mobile-panel-scroll px-4 sm:px-6 py-6 sm:py-8">
          <div className="max-w-4xl mx-auto">
            <AITradeJournal />
          </div>
        </div>
      </main>
    </div>
  );
}
