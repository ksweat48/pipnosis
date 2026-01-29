import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { EntryPriceMonitor } from './EntryPriceMonitor';
import { MidTradeMonitor } from './MidTradeMonitor';
import { SessionIntelligenceMonitor } from './SessionIntelligenceMonitor';

interface MonitorPreferences {
  entry_price_monitor_enabled: boolean;
  mid_trade_monitor_enabled: boolean;
  session_intelligence_enabled: boolean;
}

export const TradingMonitorStack: React.FC = () => {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<MonitorPreferences>({
    entry_price_monitor_enabled: true,
    mid_trade_monitor_enabled: true,
    session_intelligence_enabled: true,
  });
  const [loading, setLoading] = useState(true);

  const loadPreferences = useCallback(async () => {
    if (!user) return;

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('user_monitor_preferences')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) {
        console.error('[TradingMonitorStack] Error loading preferences:', error);
      } else if (data) {
        setPreferences({
          entry_price_monitor_enabled: data.entry_price_monitor_enabled ?? true,
          mid_trade_monitor_enabled: data.mid_trade_monitor_enabled ?? true,
          session_intelligence_enabled: data.session_intelligence_enabled ?? true,
        });
      }
    } catch (error) {
      console.error('[TradingMonitorStack] Error:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadPreferences();

      const channel = supabase
        .channel('monitor-preferences')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'user_monitor_preferences',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            if (payload.new) {
              setPreferences({
                entry_price_monitor_enabled: payload.new.entry_price_monitor_enabled,
                mid_trade_monitor_enabled: payload.new.mid_trade_monitor_enabled,
                session_intelligence_enabled: payload.new.session_intelligence_enabled,
              });
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user, loadPreferences]);

  if (loading) {
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

  const hasAnyMonitorEnabled =
    preferences.entry_price_monitor_enabled ||
    preferences.mid_trade_monitor_enabled ||
    preferences.session_intelligence_enabled;

  if (!hasAnyMonitorEnabled) {
    return null;
  }

  return (
    <div className="space-y-4">
      {preferences.entry_price_monitor_enabled && <EntryPriceMonitor />}
      {preferences.mid_trade_monitor_enabled && <MidTradeMonitor />}
      {preferences.session_intelligence_enabled && <SessionIntelligenceMonitor />}
    </div>
  );
};
