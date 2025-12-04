import React, { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { LogOut } from 'lucide-react';
import { BalanceDisplay } from './BalanceDisplay';
import { ServerSideAggregatorStatus } from './ServerSideAggregatorStatus';

export function Header() {
  const { user, signOut } = useAuth();
  const [balanceRefresh, setBalanceRefresh] = useState(0);

  return (
    <header className="bg-gray-900/50 backdrop-blur-sm border-b border-gray-800">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h1 className="text-xl sm:text-2xl font-bold text-white">Pipnosis AI Trading</h1>
            {user && (
              <div className="flex items-center gap-6">
                <BalanceDisplay refreshTrigger={balanceRefresh} />
                <button
                  onClick={() => signOut()}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
                >
                  <LogOut size={18} />
                  <span className="hidden sm:inline">Sign Out</span>
                </button>
              </div>
            )}
          </div>
          {user && <ServerSideAggregatorStatus />}
        </div>
      </div>
    </header>
  );
}
