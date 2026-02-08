/**
 * CLUB LAYOUT COMPONENT
 *
 * Provides consistent layout and navigation for all Club pages.
 * Mobile-first responsive design with app-like bottom tab bar.
 *
 * NAVIGATION STRUCTURE:
 * - Home: Token balances, stats, referral dashboard
 * - Chat: Real-time member communication
 * - Rewards: Staking displays and rewards (Phase 1: display only)
 */

import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Home, MessageSquare, Gift, ArrowLeft, Coins, Crown, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { clubTokenLedgerService, type ClubTokenBalance } from '@/services/club-token-ledger-service';

interface ClubLayoutProps {
  children: React.ReactNode;
}

export function ClubLayout({ children }: ClubLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tokenBalance, setTokenBalance] = useState<ClubTokenBalance | null>(null);
  const [loading, setLoading] = useState(true);

  const clubNavItems = [
    { path: '/club/home', label: 'Home', icon: Home },
    { path: '/club/chat', label: 'Chat', icon: MessageSquare },
    { path: '/club/rewards', label: 'Rewards', icon: Gift },
  ];

  const isActive = (path: string) => location.pathname === path;

  useEffect(() => {
    if (!user) return;

    loadTokenBalance();

    const unsubscribe = clubTokenLedgerService.subscribeToBalance(user.id, (balance) => {
      setTokenBalance(balance);
    });

    return () => {
      unsubscribe();
    };
  }, [user]);

  const loadTokenBalance = async () => {
    if (!user) return;

    try {
      const balance = await clubTokenLedgerService.getBalance(user.id);
      setTokenBalance(balance);
    } catch (error) {
      console.error('[ClubLayout] Error loading token balance:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  return (
    <div className="fixed inset-0 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 pb-[4.5rem] sm:pb-0">
      {/* Club Header */}
      <header className="sticky top-0 bg-white/80 backdrop-blur-xl border-b border-slate-200/50 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-3 sm:px-6">
          <div className="flex items-center justify-between h-14 sm:h-16">
            {/* Left: Back + Logo */}
            <div className="flex items-center gap-2 sm:gap-4 min-w-0">
              <button
                onClick={() => navigate('/charts')}
                className="flex items-center gap-1 p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100/80 rounded-lg transition-colors flex-shrink-0"
              >
                <ArrowLeft size={18} />
                <span className="hidden sm:inline text-sm">Back</span>
              </button>

              <div className="flex items-center gap-2 min-w-0">
                <Crown size={22} className="text-amber-500 flex-shrink-0" />
                <h1 className="text-base sm:text-xl font-bold text-slate-800 truncate">
                  Pipnosis Club
                </h1>
              </div>
            </div>

            {/* Right: Token balance + Avatar */}
            <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
              {!loading && tokenBalance && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-white/80 border border-slate-200/60 rounded-lg shadow-sm">
                  <Coins size={16} className="text-amber-500" />
                  <div className="text-right">
                    <div className="text-slate-400 text-[10px] leading-tight">PIP</div>
                    <div className="text-slate-900 font-bold text-sm leading-tight">
                      {tokenBalance.availableTokens.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
              )}

              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center shadow-md flex-shrink-0">
                <Users size={16} className="text-white sm:w-5 sm:h-5" />
              </div>
            </div>
          </div>

          {/* Desktop-only top navigation tabs */}
          <div className="hidden sm:flex items-center gap-1 pb-2 -mx-1">
            {clubNavItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg transition-all ${
                    active
                      ? 'bg-slate-900 text-white shadow-md'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-white/60'
                  }`}
                >
                  <Icon size={16} />
                  <span className="font-medium text-sm">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </header>

      {/* Club Content - scrollable */}
      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-8">
        {children}
      </main>

      {/* Desktop Footer */}
      <footer className="hidden sm:block border-t border-slate-200/60 bg-white/40 backdrop-blur-sm mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Crown size={24} className="text-amber-500" />
                <h3 className="text-lg font-bold text-slate-800">Pipnosis Club</h3>
              </div>
              <p className="text-slate-600 text-sm">
                An exclusive membership community with utility tokens, rewards, and governance.
              </p>
            </div>

            <div>
              <h4 className="text-slate-800 font-semibold mb-3">Quick Links</h4>
              <ul className="space-y-2">
                {clubNavItems.map((item) => (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      className="text-slate-600 hover:text-slate-900 text-sm transition-colors"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-slate-800 font-semibold mb-3">Important Notice</h4>
              <p className="text-slate-500 text-xs leading-relaxed">
                Club tokens are utility tokens for access and rewards only. Not investment advice.
                No guaranteed returns. This is a membership community, not a financial product.
              </p>
            </div>
          </div>

          <div className="border-t border-slate-200/60 mt-8 pt-6 text-center text-slate-500 text-xs">
            © 2024 Pipnosis AI. All rights reserved.
          </div>
        </div>
      </footer>

      </div>

      {/* Mobile Bottom Tab Bar */}
      <nav className="fixed bottom-0 left-0 right-0 sm:hidden bg-white/95 backdrop-blur-xl border-t border-slate-200/60 z-50 safe-bottom">
        <div className="flex items-stretch">
          {clubNavItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 transition-colors relative ${
                  active
                    ? 'text-slate-900'
                    : 'text-slate-400'
                }`}
              >
                {active && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-slate-900 rounded-full" />
                )}
                <Icon size={22} strokeWidth={active ? 2.5 : 1.8} />
                <span className={`text-[11px] leading-tight ${active ? 'font-semibold' : 'font-medium'}`}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
