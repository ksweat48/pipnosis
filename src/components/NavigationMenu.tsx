import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { TrendingUp, History, BarChart3, User, Settings, LogOut, Target, Database } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useUserBalance } from '@/hooks/useUserBalance';

export function NavigationMenu() {
  const location = useLocation();
  const { user, isAdmin, signOut } = useAuth();
  const { balance, totalPnL, openPositionsCount } = useUserBalance(user?.id || null);
  const [showProfileMenu, setShowProfileMenu] = React.useState(false);

  const navItems = [
    { path: '/trade', label: 'Trade', icon: TrendingUp },
    { path: '/history', label: 'History', icon: History },
    { path: '/analysis', label: 'Analysis', icon: BarChart3 },
  ];

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="bg-gray-900/50 backdrop-blur-sm border-b border-gray-800 relative z-[9999]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-8">
            <Link to="/trade" className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold text-white">Pipnosis AI</h1>
            </Link>

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
            <div className="flex items-center gap-4">
              <div className="hidden lg:flex flex-col items-end">
                <div className="text-white font-semibold">${balance.toFixed(2)}</div>
                <div className={`text-xs ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)} P&L
                </div>
              </div>

              <div className="relative">
                <button
                  onClick={() => setShowProfileMenu(!showProfileMenu)}
                  className="flex items-center gap-3 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center">
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
                      </div>

                      <div className="p-2">
                        <Link
                          to="/settings"
                          onClick={() => setShowProfileMenu(false)}
                          className="w-full flex items-center gap-3 px-3 py-2 text-gray-300 hover:text-white hover:bg-gray-700 rounded transition-colors"
                        >
                          <Settings size={18} />
                          <span>Settings</span>
                        </Link>

                        {isAdmin && (
                          <>
                            <Link
                              to="/kpis"
                              onClick={() => setShowProfileMenu(false)}
                              className="w-full flex items-center gap-3 px-3 py-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/20 rounded transition-colors"
                            >
                              <Target size={18} />
                              <span>KPIs</span>
                            </Link>

                            <Link
                              to="/admin"
                              onClick={() => setShowProfileMenu(false)}
                              className="w-full flex items-center gap-3 px-3 py-2 text-blue-400 hover:text-blue-300 hover:bg-blue-900/20 rounded transition-colors"
                            >
                              <Database size={18} />
                              <span>Data Management</span>
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

        <div className="md:hidden flex items-center gap-1 pb-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg transition-all ${
                  active
                    ? 'bg-emerald-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                <Icon size={18} />
                <span className="text-sm font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
