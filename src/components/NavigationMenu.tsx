import React, { memo, useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { TrendingUp, History, BarChart3, User, Settings, LogOut, Target, Database, Bot, Zap, BookOpen, Activity, Coins, Layers, Smartphone, MessageSquare, Sparkles } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useUserBalance } from '@/hooks/useUserBalance';
import { useTokenBalance } from '@/hooks/useTokenBalance';
import { supabase } from '@/lib/supabase';
import { BetaFeedbackDialog } from './BetaFeedbackDialog';

interface NavigationMenuProps {
  currentPrice?: number | null;
  priceChange?: number;
  symbol?: string;
}

const NavigationMenuComponent = ({ currentPrice, priceChange = 0, symbol }: NavigationMenuProps) => {
  const location = useLocation();
  const { user, isAdmin, adminLoading, signOut } = useAuth();
  const { balance, totalPnL, openPositionsCount } = useUserBalance(user?.id || null);
  const { balance: tokenBalance } = useTokenBalance(user?.id || null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);

  const navItems = [
    { path: '/charts', label: 'Charts', icon: TrendingUp },
    { path: '/positions', label: 'Positions', icon: Activity },
    { path: '/ai-trade', label: 'Trade', icon: Zap },
    { path: '/analysis', label: 'Analysis', icon: BarChart3 },
    { path: '/journal', label: 'Journal', icon: BookOpen },
  ];

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="sticky top-0 bg-gray-900 border-b border-gray-800 z-[9999]" style={{ paddingTop: 'var(--safe-area-top)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6" style={{ paddingLeft: 'max(1rem, var(--safe-area-left))', paddingRight: 'max(1rem, var(--safe-area-right))' }}>
        <div className="flex items-center justify-between h-14 sm:h-16 relative">
          <div className="flex items-center gap-4 sm:gap-8">
            <Link to="/charts" className="flex items-center gap-2">
              <img src="/Pipnosis icon.png" alt="Pipnosis AI" className="h-10 w-10" />
            </Link>

            {/* Credit Balance Display */}
            {user && (
              <div className="flex items-center gap-2">
                <Coins size={18} className="text-emerald-400" />
                <div className="flex flex-col items-start">
                  <div className="text-gray-400 text-xs leading-tight">Credits</div>
                  <div className={`font-semibold text-sm leading-tight ${tokenBalance?.isAdmin ? 'text-purple-400' : 'text-emerald-400'}`}>
                    {tokenBalance?.isAdmin ? '∞' : tokenBalance?.balance.toFixed(0) || '0'}
                  </div>
                </div>
              </div>
            )}

            <div className="hidden md:flex items-center gap-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
                      active
                        ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
                        : 'text-gray-400 hover:text-white hover:bg-gray-800'
                    }`}
                  >
                    <Icon size={18} />
                    <span className="font-medium">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>

          {user && (
            <div className="flex items-center gap-2 sm:gap-4">
              <div className="flex flex-col items-end">
                <div className="text-white font-semibold text-sm sm:text-base">${balance.toFixed(2)}</div>
                <div className={`text-xs ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)} P&L
                </div>
              </div>

              <div className="relative">
                <button
                  onClick={() => setShowProfileMenu(!showProfileMenu)}
                  className="flex items-center gap-3 px-3 py-2 bg-gray-800 active:bg-gray-700 rounded-lg transition-colors min-h-[44px]"
                >
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center">
                    <User size={18} className="text-white" />
                  </div>
                  <div className="hidden sm:block text-left">
                    <div className="text-white text-sm font-medium">{user.email?.split('@')[0]}</div>
                    <div className="text-gray-400 text-xs">{openPositionsCount} open positions</div>
                  </div>
                </button>

                {showProfileMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-[10000]"
                      onClick={() => setShowProfileMenu(false)}
                    />
                    <div className="absolute right-0 mt-2 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-[10001] overflow-hidden">
                      <div className="p-4 border-b border-gray-700 bg-gray-900/50">
                        <div className="text-white font-medium">{user.email}</div>
                        <div className="text-gray-400 text-sm mt-1">
                          Balance: ${balance.toFixed(2)}
                        </div>
                        <div className={`text-sm mt-1 ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          P&L: {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}
                        </div>
                        <div className="flex items-center gap-2 mt-2 text-sm">
                          <Coins size={14} className="text-emerald-400" />
                          <span className="text-gray-400">Credits:</span>
                          <span className={`font-semibold ${tokenBalance?.isAdmin ? 'text-purple-400' : 'text-emerald-400'}`}>
                            {tokenBalance?.isAdmin ? '∞' : tokenBalance?.balance.toFixed(0) || '0'}
                          </span>
                        </div>
                      </div>

                      <div className="p-2">
                        <button
                          onClick={() => {
                            setShowProfileMenu(false);
                            setShowFeedbackDialog(true);
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2 bg-gradient-to-r from-amber-500/20 to-orange-500/20 hover:from-amber-500/30 hover:to-orange-500/30 border border-amber-500/30 rounded-lg transition-all group mb-2"
                        >
                          <div className="flex items-center gap-3 flex-1">
                            <div className="p-1.5 bg-gradient-to-r from-amber-500 to-orange-500 rounded">
                              <Sparkles size={14} className="text-white" />
                            </div>
                            <div className="flex flex-col items-start">
                              <span className="text-amber-400 font-semibold text-sm">BETA Feedback</span>
                              <span className="text-amber-500/70 text-xs">Help us improve</span>
                            </div>
                          </div>
                          <MessageSquare size={16} className="text-amber-400 group-hover:text-amber-300" />
                        </button>

                        <Link
                          to="/credits"
                          onClick={() => setShowProfileMenu(false)}
                          className="w-full flex items-center gap-3 px-3 py-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/20 rounded transition-colors"
                        >
                          <Coins size={18} />
                          <span>Credits</span>
                        </Link>

                        <Link
                          to="/settings"
                          onClick={() => setShowProfileMenu(false)}
                          className="w-full flex items-center gap-3 px-3 py-2 text-gray-300 hover:text-white hover:bg-gray-700 rounded transition-colors"
                        >
                          <Settings size={18} />
                          <span>Settings</span>
                        </Link>

                        <Link
                          to="/get-app"
                          onClick={() => setShowProfileMenu(false)}
                          className="w-full flex items-center gap-3 px-3 py-2 text-gray-300 hover:text-white hover:bg-gray-700 rounded transition-colors"
                        >
                          <Smartphone size={18} />
                          <span>Get App</span>
                        </Link>

                        {!adminLoading && isAdmin && (
                          <>
                            <Link
                              to="/ai-learning-center"
                              onClick={() => setShowProfileMenu(false)}
                              className="w-full flex items-center gap-3 px-3 py-2 text-blue-400 hover:text-blue-300 hover:bg-blue-900/20 rounded transition-colors"
                            >
                              <Target size={18} />
                              <span>Learning Center</span>
                            </Link>

                            <Link
                              to="/admin"
                              onClick={() => setShowProfileMenu(false)}
                              className="w-full flex items-center gap-3 px-3 py-2 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-900/20 rounded transition-colors"
                            >
                              <Database size={18} />
                              <span>Admin Dashboard</span>
                            </Link>
                          </>
                        )}

                        <button
                          onClick={() => {
                            setShowProfileMenu(false);
                            signOut();
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors"
                        >
                          <LogOut size={18} />
                          <span>Sign Out</span>
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="hidden overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
          <div className="flex items-center gap-2 min-w-max">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-2 px-4 py-3 rounded-lg transition-all whitespace-nowrap flex-shrink-0 min-h-[44px] ${
                    active
                      ? 'bg-emerald-600 text-white'
                      : 'text-gray-400 active:bg-gray-800'
                  }`}
                >
                  <Icon size={18} />
                  <span className="text-sm font-medium">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      <BetaFeedbackDialog
        isOpen={showFeedbackDialog}
        onClose={() => setShowFeedbackDialog(false)}
      />
    </nav>
  );
};

export const NavigationMenu = memo(NavigationMenuComponent);
