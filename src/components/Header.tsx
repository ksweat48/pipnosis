import React, { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { LogOut, User } from 'lucide-react';
import { BalanceDisplay } from './BalanceDisplay';
import { ServerSideAggregatorStatus } from './ServerSideAggregatorStatus';
import { useUserBalance } from '@/hooks/useUserBalance';

export function Header() {
  const { user, signOut } = useAuth();
  const [balanceRefresh, setBalanceRefresh] = useState(0);
  const { balance = 10000, totalPnL = 0 } = useUserBalance(user?.id || null);

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

            {/* Center: Balance with P&L - NUCLEAR FIX */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              flex: '1 1 auto',
              minWidth: '120px',
              padding: '8px',
              backgroundColor: '#1f2937',
              borderRadius: '8px',
              border: '2px solid #10b981'
            }}>
              <div style={{
                fontSize: '18px',
                fontWeight: '700',
                color: '#ffffff',
                lineHeight: '1.2',
                textAlign: 'center',
                WebkitTextFillColor: '#ffffff',
                opacity: 1
              }}>
                ${typeof balance === 'number' ? balance.toFixed(0) : '10000'}
              </div>
              <div style={{
                fontSize: '12px',
                fontWeight: '600',
                color: totalPnL >= 0 ? '#4ade80' : '#f87171',
                lineHeight: '1.2',
                textAlign: 'center',
                marginTop: '2px',
                WebkitTextFillColor: totalPnL >= 0 ? '#4ade80' : '#f87171',
                opacity: 1
              }}>
                {totalPnL >= 0 ? '+' : ''}${typeof totalPnL === 'number' ? Math.abs(totalPnL).toFixed(2) : '0.00'}
              </div>
            </div>

            {/* Right: User Menu */}
            {user && (
              <button
                onClick={() => signOut()}
                className="w-10 h-10 bg-green-600 hover:bg-green-700 rounded-full flex items-center justify-center shrink-0 transition-colors"
              >
                <User size={20} className="text-white" />
              </button>
            )}
          </div>

          {/* Desktop: Original Layout */}
          <div className="hidden sm:flex items-center justify-between gap-2">
            <h1 className="text-lg sm:text-2xl font-bold text-white truncate">Pipnosis AI</h1>
            {user && (
              <div className="flex items-center gap-2 sm:gap-6">
                <BalanceDisplay refreshTrigger={balanceRefresh} />
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
          {user && <ServerSideAggregatorStatus />}
        </div>
      </div>
    </header>
  );
}
