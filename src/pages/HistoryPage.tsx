import React from 'react';
import { NavigationMenu } from '@/components/NavigationMenu';
import { TradeHistory } from '@/components/TradeHistory';

export function HistoryPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950">
      <NavigationMenu />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-white mb-2">Trade History</h2>
          <p className="text-gray-400">Review your complete trading history with detailed performance metrics</p>
        </div>

        <TradeHistory />
      </main>
    </div>
  );
}
