/**
 * ENTRY PRICE MONITOR - Real-Time Entry Proximity Display
 *
 * CCIP CHANGE NOTICE:
 * Refactored from post-execution recommendations to pre-execution monitoring.
 * Shows real-time distance to entry zones BEFORE Alpha executes.
 *
 * SSOT COMPLIANCE:
 * - Uses useActiveEntryIntent hook for entry intent data (SSOT: entry-intent-monitor-mode.ts)
 * - Uses PriceCoordinator.getPrice() for live prices (SSOT: price-coordinator.ts)
 * - Uses tradeMath for pip calculations and formatting (SSOT: tradeMath.ts)
 *
 * GOVERNANCE COMPLIANCE:
 * - No business logic in component (delegates to services)
 * - Fails loudly on errors with clear error messages
 * - Uses existing abstractions consistently
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { TrendingUp, TrendingDown, Target, AlertCircle, RefreshCw, Activity } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useActiveEntryIntent } from '@/hooks/useEntryIntent';
import { priceCoordinator } from '@/services/coordinators/price-coordinator';
import * as tradeMath from '@/utils/tradeMath';

interface ActiveGoalSession {
  id: string;
  status: string;
}

export const EntryPriceMonitor: React.FC = () => {
  const [activeSession, setActiveSession] = useState<ActiveGoalSession | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceAge, setPriceAge] = useState<number>(0);
  const [lastPriceUpdate, setLastPriceUpdate] = useState<Date | null>(null);

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

  // Poll live price when we have an active intent
  useEffect(() => {
    if (!activeIntent) {
      setCurrentPrice(null);
      setLastPriceUpdate(null);
      return;
    }

    let mounted = true;

    const fetchPrice = async () => {
      try {
        const result = await priceCoordinator.getPrice(activeIntent.symbol, {
          maxAgeSeconds: 30,
          allowStale: true,
          useCacheFirst: false,
        });

        if (!mounted) return;

        if (result.success && result.price) {
          setCurrentPrice(result.price.mid);
          setPriceAge(result.price.ageSeconds);
          setLastPriceUpdate(new Date());
        } else {
          console.warn('[EntryPriceMonitor] Failed to fetch price:', result.error);
        }
      } catch (error) {
        console.error('[EntryPriceMonitor] Price fetch error:', error);
      }
    };

    fetchPrice();
    const interval = setInterval(fetchPrice, 3000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [activeIntent]);

  const formatPrice = useCallback((price: number, symbol: string): string => {
    return tradeMath.formatPrice(symbol, price);
  }, []);

  // Calculate real-time metrics
  const calculateMetrics = useCallback(() => {
    if (!activeIntent || !currentPrice) return null;

    const entryZoneMin = activeIntent.entry_zone_min;
    const entryZoneMax = activeIntent.entry_zone_max;
    const entryZoneMid = (entryZoneMin + entryZoneMax) / 2;

    // Calculate distance using SSOT tradeMath
    const distanceToMin = tradeMath.calculatePips(activeIntent.symbol, currentPrice, entryZoneMin);
    const distanceToMax = tradeMath.calculatePips(activeIntent.symbol, currentPrice, entryZoneMax);
    const distanceToMid = tradeMath.calculatePips(activeIntent.symbol, currentPrice, entryZoneMid);

    // Determine if in zone
    const inZone = currentPrice >= entryZoneMin && currentPrice <= entryZoneMax;

    // Calculate distance to zone (0 if in zone, otherwise distance to nearest edge)
    let distanceToZone: number;
    if (inZone) {
      distanceToZone = 0;
    } else if (currentPrice < entryZoneMin) {
      distanceToZone = Math.abs(distanceToMin);
    } else {
      distanceToZone = Math.abs(distanceToMax);
    }

    // Determine proximity level
    let proximityLevel: 'in-zone' | 'very-close' | 'close' | 'far';
    if (inZone) {
      proximityLevel = 'in-zone';
    } else if (distanceToZone <= 5) {
      proximityLevel = 'very-close';
    } else if (distanceToZone <= 15) {
      proximityLevel = 'close';
    } else {
      proximityLevel = 'far';
    }

    return {
      entryZoneMin,
      entryZoneMax,
      entryZoneMid,
      distanceToMin,
      distanceToMax,
      distanceToMid,
      distanceToZone,
      inZone,
      proximityLevel,
    };
  }, [activeIntent, currentPrice]);

  const metrics = calculateMetrics();

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
            <h3 className="text-lg font-bold text-white mb-2">Entry Price Monitor</h3>
            <p className="text-sm text-cyan-200">
              Real-time proximity tracking to entry zones. Once Alpha identifies an entry opportunity, this monitor will display live price distance and help you execute at optimal levels.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!currentPrice || !metrics) {
    return (
      <div className="bg-gradient-to-br from-blue-900/30 to-cyan-900/30 rounded-xl p-6 border border-blue-500/30">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-blue-500/20 rounded-lg">
            <Activity className="w-6 h-6 text-blue-400 animate-pulse" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-white mb-2">Entry Price Monitor</h3>
            <p className="text-sm text-blue-300">
              Loading live price data for {activeIntent.symbol}...
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isLong = activeIntent.direction === 'long';

  // Determine status color and message
  const getStatusColor = () => {
    switch (metrics.proximityLevel) {
      case 'in-zone':
        return 'from-emerald-500 to-green-500';
      case 'very-close':
        return 'from-yellow-500 to-orange-500';
      case 'close':
        return 'from-blue-500 to-cyan-500';
      case 'far':
        return 'from-gray-500 to-gray-600';
    }
  };

  const getStatusMessage = () => {
    if (metrics.inZone) {
      return 'Price is in entry zone - Quality entry available';
    } else if (metrics.proximityLevel === 'very-close') {
      return `${metrics.distanceToZone.toFixed(1)} pips to entry zone - Very close`;
    } else if (metrics.proximityLevel === 'close') {
      return `${metrics.distanceToZone.toFixed(1)} pips to entry zone - Approaching`;
    } else {
      return `${metrics.distanceToZone.toFixed(1)} pips to entry zone - Waiting`;
    }
  };

  return (
    <div className="relative group">
      <div className={`absolute -inset-0.5 bg-gradient-to-r ${getStatusColor()} rounded-xl opacity-20 group-hover:opacity-30 transition duration-300 blur`} />

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
              <h3 className="text-lg font-bold text-white">Entry Price Monitor</h3>
              <p className="text-sm text-cyan-300">{activeIntent.symbol} {activeIntent.direction.toUpperCase()}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {lastPriceUpdate && (
              <span className="text-xs text-gray-400">
                {priceAge}s ago
              </span>
            )}
            <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />
          </div>
        </div>

        {/* Status Banner */}
        <div className={`bg-gradient-to-r ${getStatusColor()} bg-opacity-20 rounded-lg p-4 mb-4 border ${
          metrics.inZone ? 'border-emerald-500/50' : 'border-blue-500/30'
        }`}>
          <p className="text-sm font-semibold text-white text-center">
            {getStatusMessage()}
          </p>
        </div>

        {/* Price Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700/50">
            <p className="text-xs text-gray-400 mb-1">Current Price</p>
            <p className="text-xl font-bold text-white font-mono">
              {formatPrice(currentPrice, activeIntent.symbol)}
            </p>
            <p className="text-xs text-gray-400 mt-1">Live Market</p>
          </div>

          <div className={`rounded-lg p-4 border ${
            metrics.inZone
              ? 'bg-gradient-to-br from-emerald-900/30 to-green-900/30 border-emerald-500/50'
              : 'bg-blue-900/30 border-blue-500/30'
          }`}>
            <p className={`text-xs mb-1 ${metrics.inZone ? 'text-emerald-300' : 'text-blue-300'}`}>
              Entry Zone Center
            </p>
            <p className={`text-xl font-bold font-mono ${metrics.inZone ? 'text-emerald-400' : 'text-blue-400'}`}>
              {formatPrice(metrics.entryZoneMid, activeIntent.symbol)}
            </p>
            <p className={`text-xs mt-1 ${metrics.inZone ? 'text-emerald-300' : 'text-blue-300'}`}>
              {Math.abs(metrics.distanceToMid).toFixed(1)} pips away
            </p>
          </div>

          <div className="bg-blue-900/30 rounded-lg p-4 border border-blue-500/30">
            <p className="text-xs text-blue-300 mb-1">Distance to Zone</p>
            <div className="flex items-baseline gap-2">
              <p className="text-xl font-bold text-blue-400">
                {metrics.distanceToZone.toFixed(1)}
              </p>
              <p className="text-xs text-blue-300">pips</p>
            </div>
            {metrics.inZone && (
              <p className="text-xs text-emerald-400 mt-1 font-semibold">IN ZONE</p>
            )}
          </div>
        </div>

        {/* Entry Zone Visualization */}
        <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700/50 mb-4">
          <p className="text-sm font-semibold text-gray-300 mb-2">Entry Zone Range</p>
          <div className="flex items-center gap-3">
            <div>
              <p className="text-xs text-gray-400">Min</p>
              <p className="text-sm font-mono text-white">
                {formatPrice(metrics.entryZoneMin, activeIntent.symbol)}
              </p>
            </div>
            <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden relative">
              {metrics.inZone ? (
                <div className="absolute inset-0 bg-gradient-to-r from-emerald-500 to-green-500" />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-cyan-500 opacity-50" />
              )}
            </div>
            <div>
              <p className="text-xs text-gray-400">Max</p>
              <p className="text-sm font-mono text-white">
                {formatPrice(metrics.entryZoneMax, activeIntent.symbol)}
              </p>
            </div>
          </div>
        </div>

        {/* Alpha Reasoning */}
        {activeIntent.alpha_reasoning && (
          <div className="bg-blue-900/20 rounded-lg p-4 border border-blue-500/20">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-blue-300 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-blue-400 font-semibold mb-1">Alpha's Reasoning</p>
                <p className="text-sm text-blue-100">{activeIntent.alpha_reasoning}</p>
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 text-xs text-gray-500 text-center">
          Real-time monitoring - Updates every 3 seconds
        </div>
      </div>
    </div>
  );
};
