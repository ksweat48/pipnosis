import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { clubMembershipService, type UserMembership } from '@/services/club-membership-service';
import { EntryPriceMonitor } from './EntryPriceMonitor';
import { MidTradeMonitor } from './MidTradeMonitor';
import { SessionIntelligenceMonitor } from './SessionIntelligenceMonitor';
import { Lock, Crown, TrendingUp, Activity, Clock, ChevronLeft, ChevronRight } from 'lucide-react';

interface MonitorPreferences {
  entry_price_monitor_enabled: boolean;
  mid_trade_monitor_enabled: boolean;
  session_intelligence_enabled: boolean;
}

interface ActiveSession {
  sessionId: string;
  userId: string;
}

interface ActiveTrade {
  id: string;
  symbol: string;
}

const MonitorLockedPlaceholder: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
  requiredTier: string;
  price: string;
}> = ({ icon, title, description, requiredTier, price }) => (
  <div className="bg-gray-900/40 rounded-xl border border-gray-800/60 p-5 relative overflow-hidden">
    <div className="absolute inset-0 bg-gray-950/30 backdrop-blur-[1px] z-10 flex items-center justify-center rounded-xl">
      <div className="flex flex-col items-center gap-2 text-center px-6">
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-amber-900/40 border border-amber-700/40">
          <Lock size={18} className="text-amber-400" />
        </div>
        <p className="text-sm font-semibold text-amber-300">
          Upgrade to {requiredTier} ({price}) to unlock
        </p>
        <p className="text-xs text-gray-400">
          Visit the Club to upgrade your membership
        </p>
      </div>
    </div>
    <div className="flex items-center gap-3 opacity-20 select-none pointer-events-none">
      <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div>
        <div className="text-white font-semibold text-sm">{title}</div>
        <div className="text-xs text-gray-400 mt-0.5">{description}</div>
      </div>
    </div>
  </div>
);

/**
 * CCIP (2026-03-01): Pair navigator for multi-trade sessions.
 * Shown only when 2+ open trades exist.
 */
const PairNavigator: React.FC<{
  trades: ActiveTrade[];
  activeIndex: number;
  onNavigate: (index: number) => void;
}> = ({ trades, activeIndex, onNavigate }) => {
  if (trades.length <= 1) return null;

  const prev = () => onNavigate((activeIndex - 1 + trades.length) % trades.length);
  const next = () => onNavigate((activeIndex + 1) % trades.length);
  const current = trades[activeIndex];

  return (
    <div className="flex items-center justify-between bg-gray-900/70 border border-gray-700/60 rounded-xl px-3 py-2 mb-3">
      <button
        onClick={prev}
        className="p-1.5 rounded-lg hover:bg-gray-700/60 transition-colors text-gray-400 hover:text-white"
        aria-label="Previous trade"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-white tracking-tight">{current?.symbol}</span>
        <span className="text-xs text-gray-500 tabular-nums">
          {activeIndex + 1} / {trades.length}
        </span>
        <div className="flex gap-1">
          {trades.map((_, i) => (
            <button
              key={i}
              onClick={() => onNavigate(i)}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                i === activeIndex ? 'bg-amber-400' : 'bg-gray-600 hover:bg-gray-500'
              }`}
              aria-label={`Trade ${i + 1}: ${trades[i].symbol}`}
            />
          ))}
        </div>
      </div>

      <button
        onClick={next}
        className="p-1.5 rounded-lg hover:bg-gray-700/60 transition-colors text-gray-400 hover:text-white"
        aria-label="Next trade"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
};

export const TradingMonitorStack: React.FC = () => {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<MonitorPreferences>({
    entry_price_monitor_enabled: false,
    mid_trade_monitor_enabled: false,
    session_intelligence_enabled: false,
  });
  const [membership, setMembership] = useState<UserMembership | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);

  // CCIP (2026-03-01): Multi-trade navigation state — SSOT for which trade is viewed.
  const [openTrades, setOpenTrades] = useState<ActiveTrade[]>([]);
  const [activeTradeIndex, setActiveTradeIndex] = useState(0);

  // Swipe detection refs
  const touchStartX = useRef<number | null>(null);
  const SWIPE_THRESHOLD = 50;

  const userId = user?.id;

  const loadPreferences = useCallback(async () => {
    if (!userId) return;

    try {
      const { data, error } = await supabase
        .from('user_monitor_preferences')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (!error && data) {
        setPreferences({
          entry_price_monitor_enabled: data.entry_price_monitor_enabled ?? false,
          mid_trade_monitor_enabled: data.mid_trade_monitor_enabled ?? false,
          session_intelligence_enabled: data.session_intelligence_enabled ?? false,
        });
      }
    } catch {
      // silently ignore
    }
  }, [userId]);

  // Fetch open trades for navigation; resets index when trade count changes.
  const fetchOpenTrades = useCallback(async () => {
    if (!userId) return;
    try {
      const { data } = await supabase
        .from('goal_session_trades')
        .select('id, symbol')
        .eq('user_id', userId)
        .eq('status', 'open')
        .order('created_at', { ascending: true });

      const trades = (data ?? []) as ActiveTrade[];
      setOpenTrades(trades);
      setActiveTradeIndex(prev => (prev >= trades.length ? 0 : prev));
    } catch {
      // silently ignore
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const init = async () => {
      setLoading(true);
      const [mem] = await Promise.all([
        clubMembershipService.getUserMembership(userId).catch(() => null),
        loadPreferences(),
        fetchOpenTrades(),
      ]);
      if (!cancelled) {
        setMembership(mem);
        setLoading(false);
      }
    };

    init();

    return () => { cancelled = true; };
  }, [userId, loadPreferences, fetchOpenTrades]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const fetchSession = () =>
      supabase
        .from('goal_sessions')
        .select('id')
        .eq('user_id', userId)
        .in('status', ['scanning', 'in_trade', 'initializing'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => {
          if (!cancelled) {
            setActiveSession(data?.id ? { sessionId: data.id, userId } : null);
          }
        });

    fetchSession();

    const sessionChannel = supabase
      .channel(`active-session-${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'goal_sessions',
        filter: `user_id=eq.${userId}`,
      }, fetchSession)
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(sessionChannel);
    };
  }, [userId]);

  // Subscribe to trade changes to keep navigation in sync.
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`open-trades-nav-${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'goal_session_trades',
        filter: `user_id=eq.${userId}`,
      }, fetchOpenTrades)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, fetchOpenTrades]);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`monitor-preferences-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_monitor_preferences',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.new) {
            setPreferences({
              entry_price_monitor_enabled: payload.new.entry_price_monitor_enabled ?? false,
              mid_trade_monitor_enabled: payload.new.mid_trade_monitor_enabled ?? false,
              session_intelligence_enabled: payload.new.session_intelligence_enabled ?? false,
            });
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || openTrades.length <= 1) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    if (dx < 0) {
      setActiveTradeIndex(prev => (prev + 1) % openTrades.length);
    } else {
      setActiveTradeIndex(prev => (prev - 1 + openTrades.length) % openTrades.length);
    }
  };

  if (loading || membership === undefined) {
    return (
      <div className="space-y-4">
        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50 animate-pulse">
          <div className="h-6 bg-gray-700 rounded w-1/2 mb-4" />
          <div className="h-4 bg-gray-700 rounded w-3/4 mb-2" />
          <div className="h-4 bg-gray-700 rounded w-2/3" />
        </div>
      </div>
    );
  }

  const tierLevel = membership?.status === 'active' ? (membership?.tierLevel ?? 0) : 0;

  const canAccessEntry = tierLevel >= 1;
  const canAccessMidTrade = tierLevel >= 2;
  const canAccessRTI = tierLevel >= 3;

  const showEntry = canAccessEntry && preferences.entry_price_monitor_enabled;
  const showMidTrade = canAccessMidTrade && preferences.mid_trade_monitor_enabled;
  const showRTI = canAccessRTI && preferences.session_intelligence_enabled;

  const activeTradeId = openTrades.length > 0 ? openTrades[activeTradeIndex]?.id : undefined;

  return (
    <div
      className="space-y-4"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {showMidTrade && openTrades.length > 1 && (
        <PairNavigator
          trades={openTrades}
          activeIndex={activeTradeIndex}
          onNavigate={setActiveTradeIndex}
        />
      )}

      {showEntry
        ? <EntryPriceMonitor />
        : (
          <MonitorLockedPlaceholder
            icon={<TrendingUp size={18} className="text-gray-600" />}
            title="Entry Advisory"
            description="Activates when Alpha identifies a trade opportunity"
            requiredTier="Member"
            price="$99"
          />
        )
      }

      {showMidTrade
        ? <MidTradeMonitor activeTradeId={activeTradeId} />
        : (
          <MonitorLockedPlaceholder
            icon={<Activity size={18} className="text-gray-600" />}
            title="Mid-Trade Intelligence"
            description="Real-time guidance during active trades with P&L and risk alerts"
            requiredTier="Starter"
            price="$250"
          />
        )
      }

      {showRTI
        ? (
          <SessionIntelligenceMonitor
            sessionId={activeSession?.sessionId}
            userId={activeSession?.userId}
          />
        )
        : (
          <MonitorLockedPlaceholder
            icon={<Clock size={18} className="text-gray-600" />}
            title="Real-Time Intelligence"
            description="Best pairs for current trading session with live market conditions"
            requiredTier="Builder"
            price="$500"
          />
        )
      }
    </div>
  );
};
