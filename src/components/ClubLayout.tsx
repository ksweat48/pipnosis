/**
 * CLUB LAYOUT COMPONENT
 *
 * Provides consistent layout and navigation for all Club pages.
 * Features distinct purple/pink theming to differentiate from trading interface.
 *
 * NAVIGATION STRUCTURE:
 * - Home: Token balances, stats, referral dashboard
 * - Chat: Real-time member communication
 * - Rewards: Staking displays and rewards (Phase 1: display only)
 */

import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Home, MessageSquare, Gift, ArrowLeft, Coins, Crown, Users, TrendingUp, LogOut } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { clubTokenLedgerService, type ClubTokenBalance } from '@/services/club-token-ledger-service';
import { clubAccessGateService } from '@/services/club-access-gate-service';

interface ClubLayoutProps {
  children: React.ReactNode;
}

export function ClubLayout({ children }: ClubLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAdmin, signOut } = useAuth();
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
    <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-purple-900 to-slate-900">
      {/* Club Header */}
      <header className="sticky top-0 bg-gray-900/80 backdrop-blur-xl border-b border-purple-500/30 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            {/* Left: Back button and logo */}
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/charts')}
                className="flex items-center gap-2 px-3 py-2 text-purple-400 hover:text-purple-300 hover:bg-purple-900/20 rounded-lg transition-colors"
              >
                <ArrowLeft size={18} />
                <span className="hidden sm:inline">Back to Trading</span>
              </button>

              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="absolute inset-0 bg-purple-500 rounded-full blur-md opacity-40" />
                  <Crown size={32} className="text-purple-400 relative" />
                </div>
                <div>
                  <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 via-pink-400 to-indigo-400">
                    Pipnosis Club
                  </h1>
                  <p className="text-purple-300 text-xs">Exclusive Member Area</p>
                </div>
              </div>
            </div>

            {/* Right: Token balance and user info */}
            <div className="flex items-center gap-4">
              {!loading && tokenBalance && (
                <div className="flex items-center gap-3 px-4 py-2 bg-purple-900/30 border border-purple-500/30 rounded-lg">
                  <Coins size={20} className="text-purple-400" />
                  <div className="flex flex-col items-start">
                    <div className="text-purple-300 text-xs">Your Tokens</div>
                    <div className="text-purple-400 font-bold text-lg">
                      {tokenBalance.availableTokens.toLocaleString()}
                    </div>
                  </div>
                </div>
              )}

              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center border-2 border-purple-400/50">
                <Users size={20} className="text-white" />
              </div>
            </div>
          </div>

          {/* Club Navigation Tabs */}
          <div className="flex items-center gap-2 pb-3 overflow-x-auto">
            {clubNavItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap ${
                    active
                      ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-600/30'
                      : 'text-purple-300 hover:text-white hover:bg-purple-900/30'
                  }`}
                >
                  <Icon size={18} />
                  <span className="font-medium">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </header>

      {/* Club Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {children}
      </main>

      {/* Club Footer */}
      <footer className="border-t border-purple-500/20 bg-gray-900/50 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Crown size={24} className="text-purple-400" />
                <h3 className="text-lg font-bold text-purple-400">Pipnosis Club</h3>
              </div>
              <p className="text-purple-300 text-sm">
                An exclusive membership community with utility tokens, rewards, and governance.
              </p>
            </div>

            <div>
              <h4 className="text-purple-400 font-semibold mb-3">Quick Links</h4>
              <ul className="space-y-2">
                {clubNavItems.map((item) => (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      className="text-purple-300 hover:text-purple-200 text-sm transition-colors"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-purple-400 font-semibold mb-3">Important Notice</h4>
              <p className="text-purple-300 text-xs leading-relaxed">
                Club tokens are utility tokens for access and rewards only. Not investment advice.
                No guaranteed returns. This is a membership community, not a financial product.
              </p>
            </div>
          </div>

          <div className="border-t border-purple-500/20 mt-8 pt-6 text-center text-purple-400 text-xs">
            © 2024 Pipnosis AI. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
