import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { clubMembershipService, type UserMembership } from '@/services/club-membership-service';
import { EntryPriceMonitor } from './EntryPriceMonitor';
import { MidTradeMonitor } from './MidTradeMonitor';
import { SessionIntelligenceMonitor } from './SessionIntelligenceMonitor';
import { Lock, Crown, TrendingUp, Activity, Clock } from 'lucide-react';

interface MonitorPreferences {
  entry_price_monitor_enabled: boolean;
  mid_trade_monitor_enabled: boolean;
  session_intelligence_enabled: boolean;
}

interface ActiveSession {
  sessionId: string;
  userId: string;
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
      ]);
      if (!cancelled) {
        setMembership(mem);
        setLoading(false);
      }
    };

    init();

    return () => { cancelled = true; };
  }, [userId, loadPreferences]);

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

  return (
    <div className="space-y-4">
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
        ? <MidTradeMonitor />
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
