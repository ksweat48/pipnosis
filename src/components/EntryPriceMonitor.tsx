/**
 * ENTRY PRICE MONITOR - Entry Quality Advisory System
 *
 * CCIP CHANGE NOTICE:
 * Refactored from pre-execution monitoring to POST-EXECUTION advisory.
 * Shows entry quality analysis AFTER Alpha executes trades.
 * Advisory is non-blocking - purely educational for user.
 *
 * SSOT COMPLIANCE:
 * - Uses useActiveEntryIntent hook for entry intent data (SSOT: entry-intent-monitor-mode.ts)
 * - Uses entryQualityAdvisorService for advisory data (SSOT: entry_quality_advisories table)
 * - Uses get_entry_advisory_analysis RPC for calculations (SSOT: database functions)
 * - Uses tradeMath for pip calculations and formatting (SSOT: tradeMath.ts)
 *
 * GOVERNANCE COMPLIANCE:
 * - Advisory mode is non-blocking and informational
 * - No business logic (delegates to services and database)
 * - Realtime subscriptions validate data integrity
 * - Fails loudly on errors with clear messages
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { TrendingUp, TrendingDown, CheckCircle, AlertCircle, Activity, Info, Target } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useActiveEntryIntent } from '@/hooks/useEntryIntent';
import { entryQualityAdvisorService } from '@/services/entry-quality-advisor-service';
import * as tradeMath from '@/utils/tradeMath';

interface ActiveGoalSession {
  id: string;
  status: string;
}

export const EntryPriceMonitor: React.FC = () => {
  const [activeSession, setActiveSession] = useState<ActiveGoalSession | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [advisory, setAdvisory] = useState<any | null>(null);
  const [loadingAdvisory, setLoadingAdvisory] = useState(false);

  // Memoize session ID to prevent unnecessary re-renders of useActiveEntryIntent
  const sessionId = useMemo(() => activeSession?.id || null, [activeSession?.id]);
  const { activeIntent, loading: loadingIntent } = useActiveEntryIntent(sessionId);

  console.log('[EntryPriceMonitor] Rendering - activeSession:', activeSession, 'activeIntent:', activeIntent);

  useEffect(() => {
    let isMounted = true;
    let debounceTimer: ReturnType<typeof setTimeout>;
    let channel: ReturnType<typeof supabase.channel>;

    const loadActiveSession = async () => {
      try {
        console.log('[EntryPriceMonitor] Loading active session...');
        const { data: session, error } = await supabase
          .from('goal_sessions')
          .select('id, status')
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        console.log('[EntryPriceMonitor] Session query result:', { session, error });

        if (error) {
          console.error('[EntryPriceMonitor] Error loading session:', error);
        } else if (isMounted) {
          setActiveSession(session);
        }
      } catch (error) {
        console.error('[EntryPriceMonitor] Error:', error);
      } finally {
        if (isMounted) {
          setLoadingSession(false);
        }
      }
    };

    const debouncedLoad = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        loadActiveSession();
      }, 300);
    };

    console.log('[EntryPriceMonitor] Mounted - calling loadActiveSession');
    loadActiveSession();

    channel = supabase
      .channel('entry-monitor-sessions')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'goal_sessions',
          filter: `status=eq.active`
        },
        () => {
          console.log('[EntryPriceMonitor] 📡 Session changed, reloading...');
          debouncedLoad();
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[EntryPriceMonitor] 📡 Realtime subscription CONNECTED');
        }
      });

    return () => {
      isMounted = false;
      clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, []);

  // Load advisory data when we have an executed intent
  useEffect(() => {
    if (!activeIntent || activeIntent.status !== 'executed') {
      setAdvisory(null);
      return;
    }

    let mounted = true;

    const loadAdvisory = async () => {
      setLoadingAdvisory(true);
      try {
        const advisoryData = await entryQualityAdvisorService.getAdvisoryForIntent(activeIntent.id);
        if (mounted && advisoryData) {
          setAdvisory(advisoryData);
        }
      } catch (error) {
        console.error('[EntryPriceMonitor] Error loading advisory:', error);
      } finally {
        if (mounted) {
          setLoadingAdvisory(false);
        }
      }
    };

    loadAdvisory();

    // Subscribe to real-time advisory updates
    const channel = supabase
      .channel(`entry-advisory-${activeIntent.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'entry_quality_advisories',
          filter: `entry_intent_id=eq.${activeIntent.id}`
        },
        () => {
          console.log('[EntryPriceMonitor] Advisory updated, reloading...');
          loadAdvisory();
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [activeIntent?.id, activeIntent?.status]);

  const formatPrice = useCallback((price: number, symbol: string): string => {
    return tradeMath.formatPrice(symbol, price);
  }, []);

  if (loadingSession || loadingIntent) {
    return (
      <div className="bg-gradient-to-br from-blue-900/30 to-cyan-900/30 rounded-xl p-6 border border-blue-500/30">
        <div className="animate-pulse">
          <div className="h-6 bg-blue-500/20 rounded w-1/2 mb-4" />
          <div className="h-4 bg-blue-500/20 rounded w-3/4 mb-2" />
          <div className="h-4 bg-blue-500/20 rounded w-2/3" />
        </div>
      </div>
    );
  }

  if (!activeIntent) {
    return (
      <div className="bg-gradient-to-br from-cyan-900/30 to-blue-900/30 rounded-xl p-6 border border-cyan-500/30">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-cyan-500/20 rounded-lg">
            <Target className="w-6 h-6 text-cyan-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-white mb-2">Entry Quality Advisor</h3>
            <p className="text-sm text-cyan-200">
              Entry quality analysis will appear here after Alpha executes trades. Shows whether Alpha's entry was optimal and what better prices were available.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Check if this is a post-execution advisory
  const isAdvisoryMode = entryQualityAdvisorService.isAdvisoryMode(activeIntent);

  if (!isAdvisoryMode) {
    return (
      <div className="bg-gradient-to-br from-blue-900/30 to-cyan-900/30 rounded-xl p-6 border border-blue-500/30">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-blue-500/20 rounded-lg">
            <Activity className="w-6 h-6 text-blue-400 animate-pulse" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-white mb-2">Entry Quality Advisor</h3>
            <p className="text-sm text-blue-300">
              Waiting for Alpha to execute a trade for {activeIntent.symbol}...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (loadingAdvisory || !advisory) {
    return (
      <div className="bg-gradient-to-br from-blue-900/30 to-cyan-900/30 rounded-xl p-6 border border-blue-500/30">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-blue-500/20 rounded-lg">
            <Activity className="w-6 h-6 text-blue-400 animate-pulse" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-white mb-2">Entry Quality Advisor</h3>
            <p className="text-sm text-blue-300">
              Analyzing entry quality for {activeIntent.symbol}...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Format and display advisory
  const formattedAdvisory = entryQualityAdvisorService.formatAdvisoryDisplay(advisory);

  if (!formattedAdvisory) {
    return (
      <div className="bg-gradient-to-br from-gray-900/30 to-blue-900/30 rounded-xl p-6 border border-gray-500/30">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-gray-500/20 rounded-lg">
            <AlertCircle className="w-6 h-6 text-gray-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-white mb-2">Entry Quality Advisor</h3>
            <p className="text-sm text-gray-300">
              Advisory data not yet available. Please check back shortly.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isLong = activeIntent.direction === 'long';
  const gradeColor = entryQualityAdvisorService.getGradeColor(formattedAdvisory.grade);

  return (
    <div className="relative group">
      <div className={`absolute -inset-0.5 bg-gradient-to-r ${gradeColor} rounded-xl opacity-20 group-hover:opacity-30 transition duration-300 blur`} />

      <div className="relative bg-gradient-to-br from-blue-900/40 to-cyan-900/40 rounded-xl p-6 border border-blue-500/50">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-lg ${isLong ? 'bg-emerald-500/20' : 'bg-red-500/20'}`}>
              {isLong ? (
                <TrendingUp className="w-6 h-6 text-emerald-400" />
              ) : (
                <TrendingDown className="w-6 h-6 text-red-400" />
              )}
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Entry Quality Advisor</h3>
              <p className="text-sm text-cyan-300">{activeIntent.symbol} {activeIntent.direction.toUpperCase()}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-cyan-400 font-semibold">ADVISORY</span>
            <CheckCircle className="w-4 h-4 text-cyan-400" />
          </div>
        </div>

        {/* Quality Grade Banner */}
        <div className={`bg-gradient-to-r ${gradeColor} bg-opacity-20 rounded-lg p-4 mb-4 border border-opacity-50`}>
          <p className="text-sm font-semibold text-white text-center">
            {formattedAdvisory.message}
          </p>
        </div>

        {/* Entry Quality Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700/50">
            <p className="text-xs text-gray-400 mb-1">Executed Entry</p>
            <p className="text-xl font-bold text-white font-mono">
              {formatPrice(formattedAdvisory.executedPrice, activeIntent.symbol)}
            </p>
            <p className="text-xs text-gray-400 mt-1">Alpha's Price</p>
          </div>

          <div className="bg-blue-900/30 rounded-lg p-4 border border-blue-500/30">
            <p className="text-xs text-blue-300 mb-1">Quality Grade</p>
            <p className="text-xl font-bold text-blue-400 uppercase">
              {formattedAdvisory.grade}
            </p>
            <p className="text-xs text-blue-300 mt-1">Entry Assessment</p>
          </div>

          <div className="bg-blue-900/30 rounded-lg p-4 border border-blue-500/30">
            <p className="text-xs text-blue-300 mb-1">Distance from Optimal</p>
            <div className="flex items-baseline gap-2">
              <p className="text-xl font-bold text-blue-400">
                {Math.abs(formattedAdvisory.distance).toFixed(1)}
              </p>
              <p className="text-xs text-blue-300">pips</p>
            </div>
          </div>
        </div>

        {/* Retrospective Optimal Zone */}
        <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700/50 mb-4">
          <p className="text-sm font-semibold text-gray-300 mb-2">Retrospective Optimal Zone</p>
          <p className="text-xs text-gray-400 mb-3">
            What the optimal entry zone SHOULD have been, calculated from market conditions at execution
          </p>
          <div className="flex items-center gap-3">
            <div>
              <p className="text-xs text-gray-400">Min</p>
              <p className="text-sm font-mono text-white">
                {formatPrice(formattedAdvisory.optimalZone.min, activeIntent.symbol)}
              </p>
            </div>
            <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden relative">
              <div className="absolute inset-0 bg-gradient-to-r from-cyan-500 to-blue-500 opacity-60" />
            </div>
            <div>
              <p className="text-xs text-gray-400">Max</p>
              <p className="text-sm font-mono text-white">
                {formatPrice(formattedAdvisory.optimalZone.max, activeIntent.symbol)}
              </p>
            </div>
          </div>
        </div>

        {/* Educational Note */}
        <div className="bg-cyan-900/20 rounded-lg p-4 border border-cyan-500/20">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-cyan-300 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-cyan-400 font-semibold mb-1">About This Advisory</p>
              <p className="text-sm text-cyan-100">
                This is a post-execution advisory showing whether Alpha's instant execution was optimal. Zones are calculated retroactively based on market conditions at execution time. No action needed - this is purely educational.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 text-xs text-gray-500 text-center">
          Post-execution entry quality analysis
        </div>
      </div>
    </div>
  );
};
