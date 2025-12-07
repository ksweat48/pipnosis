import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { TrendingUp, Activity, Zap, BarChart3, BookOpen } from 'lucide-react';

export function BottomNavigation() {
  const location = useLocation();

  const navItems = [
    { path: '/trade', label: 'Charts', icon: TrendingUp },
    { path: '/positions', label: 'Positions', icon: Activity },
    { path: '/ai-trade', label: 'AI Trading', icon: Zap },
    { path: '/analysis', label: 'Analysis', icon: BarChart3 },
    { path: '/journal', label: 'Journal', icon: BookOpen },
  ];

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 z-[9999] safe-area-bottom"
      style={{
        paddingBottom: 'max(8px, var(--safe-area-bottom))',
        paddingLeft: 'var(--safe-area-left)',
        paddingRight: 'var(--safe-area-right)'
      }}
    >
      <div className="flex items-center justify-around max-w-screen-xl mx-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex flex-col items-center justify-center py-2 px-3 flex-1 min-h-[60px] transition-all ${
                active
                  ? 'text-emerald-400'
                  : 'text-gray-400 active:text-white active:bg-gray-800'
              }`}
            >
              <Icon size={22} strokeWidth={active ? 2.5 : 2} className="mb-1" />
              <span className={`text-xs ${active ? 'font-semibold' : 'font-medium'}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
