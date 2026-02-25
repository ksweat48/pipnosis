import React, { useState, useEffect, useRef } from 'react';
import { NavigationMenu } from '@/components/NavigationMenu';
import { BottomNavigation } from '@/components/BottomNavigation';
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { SmartGoalPanel } from '@/components/SmartGoalPanel';
import { GoalSessionDashboard } from '@/components/GoalSessionDashboard';
import { AchievementsHallOfFame } from '@/components/AchievementsHallOfFame';
import { LiveTradesTicker } from '@/components/LiveTradesTicker';
// Removed: PendingContinuationModalHandler (continuation modal system removed 2026-01-30)
import { useAuth } from '@/hooks/useAuth';
import { smartGoalSessionManager } from '@/services/smart-goal-session-manager';
import { clubMembershipService, type UserMembership } from '@/services/club-membership-service';
import { Target, Trophy, Crown, Lock, Sparkles } from 'lucide-react';

type TabType = 'start' | 'achievements';

export function AITradePage() {
  const { user } = useAuth();
  const [userMembership, setUserMembership] = useState<UserMembership | null | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    // Check URL parameters first
    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get('tab');
    if (tabParam === 'achievements') return 'achievements';

    // Then check localStorage
    const saved = localStorage.getItem('ai-trade-tab');
    return (saved as TabType) || 'start';
  });
  const [hasActiveSession, setHasActiveSession] = useState(false);

  // Governance: Preserve scroll position during state updates to prevent UI jumping
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const previousScrollTopRef = useRef<number>(0);

  const pullToRefresh = usePullToRefresh({
    onRefresh: async () => {
      window.location.reload();
    },
    enabled: true
  });

  useEffect(() => {
    localStorage.setItem('ai-trade-tab', activeTab);
  }, [activeTab]);

  // Listen for custom event to switch tabs
  useEffect(() => {
    const handleSwitchToAchievements = () => {
      console.log('[AITradePage] Received event to switch to achievements tab');
      setActiveTab('achievements');
    };

    window.addEventListener('switch-to-achievements-tab', handleSwitchToAchievements);

    return () => {
      window.removeEventListener('switch-to-achievements-tab', handleSwitchToAchievements);
    };
  }, []);

  // Scroll container to top when SmartGoalPanel requests it (e.g. Analyze with Alpha)
  useEffect(() => {
    const handleScrollToTop = () => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };

    window.addEventListener('smart-goal-panel-scroll-to-top', handleScrollToTop);
    return () => {
      window.removeEventListener('smart-goal-panel-scroll-to-top', handleScrollToTop);
    };
  }, []);

  // SSOT: Fetch club membership once on mount — read-only, no mutations
  useEffect(() => {
    if (!user) {
      setUserMembership(null);
      return;
    }
    clubMembershipService.getUserMembership(user.id).then(setUserMembership).catch(() => setUserMembership(null));
  }, [user]);

  // Governance: Check for active session and poll for changes with scroll preservation
  useEffect(() => {
    const checkActiveSession = async () => {
      if (!user) {
        setHasActiveSession(false);
        return;
      }

      try {
        const activeSession = await smartGoalSessionManager.getActiveSession(user.id);
        const newHasActiveSession = !!activeSession;

        // SSOT: Only update if value actually changed (prevent unnecessary re-renders)
        setHasActiveSession(prev => {
          if (prev === newHasActiveSession) {
            return prev; // No change, prevent re-render
          }

          // Capture scroll position before update
          if (scrollContainerRef.current) {
            previousScrollTopRef.current = scrollContainerRef.current.scrollTop;
          }

          // Schedule scroll restoration after React's commit phase
          requestAnimationFrame(() => {
            if (scrollContainerRef.current && previousScrollTopRef.current > 0) {
              scrollContainerRef.current.scrollTop = previousScrollTopRef.current;
            }
          });

          return newHasActiveSession;
        });
      } catch (error) {
        console.error('[AITradePage] Error checking active session:', error);
        setHasActiveSession(false);
      }
    };

    checkActiveSession();

    const pollInterval = setInterval(checkActiveSession, 3000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [user]);

  return (
    <div
      className="app-viewport bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 relative"
      ref={(node) => {
        // Dual ref assignment: pullToRefresh and scroll container
        if (pullToRefresh.containerRef) {
          (pullToRefresh.containerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }
        scrollContainerRef.current = node;
      }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-blue-500/5 pointer-events-none" />

      <div className="absolute top-20 left-10 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-20 right-10 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />

      <PullToRefreshIndicator
        isPulling={pullToRefresh.isPulling}
        isRefreshing={pullToRefresh.isRefreshing}
        pullDistance={pullToRefresh.pullDistance}
        threshold={pullToRefresh.threshold}
      />
      <NavigationMenu />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12 relative z-10">
        {/* Live Trades Ticker — social proof, always visible */}
        <LiveTradesTicker />

        {/* Always-visible Club Level Badge + CTA */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
          {/* Club level badge */}
          {userMembership !== undefined && (
            <div>
              {userMembership && userMembership.status === 'active' ? (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border border-amber-500/40">
                  <Crown className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-bold text-amber-300 tracking-wide">{userMembership.tierName}</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/70 border border-gray-700/60">
                  <Lock className="w-3.5 h-3.5 text-gray-500" />
                  <span className="text-xs font-medium text-gray-500">Not Yet A Club Member</span>
                </div>
              )}
            </div>
          )}

          {/* Club CTA strip */}
          <div className="flex-1 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-900/30 to-teal-900/20 border border-emerald-500/20">
            <Sparkles className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <p className="flex-1 text-xs text-gray-400">
              <span className="font-semibold text-white">Improve your edge</span> — get access to more trading tools when you become a member.
            </p>
            <a
              href="/club"
              className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-emerald-600/80 hover:bg-emerald-500/90 text-white text-xs font-semibold transition-colors whitespace-nowrap"
            >
              Join Club
            </a>
          </div>
        </div>

        <div className="mb-8">
          <div className="flex items-center gap-3 bg-gray-800/50 rounded-xl p-1.5 border border-gray-700/50 backdrop-blur-sm max-w-md">
            <button
              onClick={() => setActiveTab('start')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-all duration-300 ${
                activeTab === 'start'
                  ? 'bg-gradient-to-r from-emerald-600 to-blue-600 text-white shadow-lg shadow-emerald-500/25'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              <Target className="w-5 h-5" />
              <span>Session</span>
            </button>
            <button
              onClick={() => setActiveTab('achievements')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-all duration-300 ${
                activeTab === 'achievements'
                  ? 'bg-gradient-to-r from-emerald-600 to-blue-600 text-white shadow-lg shadow-emerald-500/25'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              <Trophy className="w-5 h-5" />
              <span>Achievements</span>
            </button>
          </div>
        </div>

        <div className="space-y-6">
          {activeTab === 'start' ? (
            <div className={`grid gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500 ${
              hasActiveSession ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-3'
            }`}>
              {!hasActiveSession && (
                <div className="lg:col-span-1 animate-in fade-in slide-in-from-left duration-300">
                  <SmartGoalPanel />
                </div>
              )}

              <div className={`${hasActiveSession ? '' : 'lg:col-span-2'} animate-in fade-in slide-in-from-right duration-300`}>
                <GoalSessionDashboard />
              </div>
            </div>
          ) : (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <AchievementsHallOfFame />
            </div>
          )}
        </div>
      </main>

      <BottomNavigation />
    </div>
  );
}
