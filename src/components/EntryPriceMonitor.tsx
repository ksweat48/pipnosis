/**
 * ENTRY PRICE MONITOR - Real-Time Entry Advisory System
 *
 * CCIP CHANGE NOTICE (2026-02-10):
 * Consolidated from two monitors (SimpleEntryMonitor + EntryPriceMonitor) into one.
 * Now serves as a REAL-TIME entry advisory for users trading manually on external platforms.
 *
 * PURPOSE:
 * After Alpha enters a trade, this monitor advises the user whether to:
 * 1. Enter NOW (price is at or better than Alpha's entry - GREEN)
 * 2. WAIT for a pullback to Alpha's entry for less drawdown (WAITING)
 * 3. Price is aligned with Alpha's entry (AT ALPHA)
 *
 * SSOT COMPLIANCE:
 * - Uses useActiveEntryIntent hook for entry intent data (SSOT: entry-intent-monitor-mode.ts)
 * - Uses realtime_prices for live price tracking (SSOT: realtime_prices table)
 * - Uses currencyHelpers for pip calculations (SSOT: currencyHelpers.ts)
 * - Style-aware tolerances sourced from intent record (SSOT: entry_intents.style)
 *
 * GOVERNANCE COMPLIANCE:
 * - Advisory mode is non-blocking and informational
 * - No business logic - purely presentation of price vs Alpha's entry
 * - Real-time subscriptions for price updates
 * - Fails gracefully with clear messages
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { TrendingUp, TrendingDown, CheckCircle, ArrowUp, ArrowDown, Minus, Target, MapPin, Activity } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useActiveEntryIntent } from '@/hooks/useEntryIntent';
import { getCurrencyPipInfo, calculatePipDistance, formatCurrencyPrice } from '@/utils/currencyHelpers';

interface ActiveGoalSession {
  id: string;
  status: string;
}

type AdvisoryState = 'ENTER_NOW' | 'WAIT_PULLBACK' | 'AT_ALPHA';

const STYLE_TOLERANCES: Record<string, { atAlphaPips: number; betterZonePips: number }> = {
  SCALP: { atAlphaPips: 1.5, betterZonePips: 4 },
  MICRO_INTRADAY: { atAlphaPips: 3, betterZonePips: 7 },
  INTRADAY: { atAlphaPips: 5, betterZonePips: 12 },
};

function getTolerances(style: string) {
  return STYLE_TOLERANCES[style] || STYLE_TOLERANCES.MICRO_INTRADAY;
}

function determineAdvisoryState(
  direction: string,
  currentPrice: number,
  alphaEntry: number,
  distancePips: number,
  tolerances: { atAlphaPips: number }
): AdvisoryState {
  const isBuy = direction === 'long';

  if (distancePips <= tolerances.atAlphaPips) {
    return 'AT_ALPHA';
  }

  const isBetterEntry = isBuy
    ? currentPrice < alphaEntry
    : currentPrice > alphaEntry;

  return isBetterEntry ? 'ENTER_NOW' : 'WAIT_PULLBACK';
}

export const EntryPriceMonitor: React.FC = () => {
  const [activeSession, setActiveSession] = useState<ActiveGoalSession | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [previousPrice, setPreviousPrice] = useState<number | null>(null);

  const sessionId = useMemo(() => activeSession?.id || null, [activeSession?.id]);
  const { activeIntent, loading: loadingIntent } = useActiveEntryIntent(sessionId);

  useEffect(() => {
    let isMounted = true;
    let debounceTimer: ReturnType<typeof setTimeout>;
    let channel: ReturnType<typeof supabase.channel>;

    const loadActiveSession = async () => {
      try {
        const { data: session, error } = await supabase
          .from('goal_sessions')
          .select('id, status')
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

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
          debouncedLoad();
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!activeIntent) return;

    let isMounted = true;

    const fetchPrice = async () => {
      try {
        const { data, error } = await supabase
          .from('realtime_prices')
          .select('mid')
          .eq('symbol', activeIntent.symbol)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (data && !error && isMounted) {
          setPreviousPrice(currentPrice);
          setCurrentPrice(data.mid);
        }
      } catch (err) {
        console.error('[EntryPriceMonitor] Price fetch error:', err);
      }
    };

    fetchPrice();
    const interval = setInterval(fetchPrice, 2000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [activeIntent?.symbol, activeIntent?.id]);

  const formatPrice = useCallback((price: number, symbol: string): string => {
    return formatCurrencyPrice(symbol, price);
  }, []);

  if (loadingSession || loadingIntent) {
    return (
      <div className="bg-gradient-to-br from-gray-800/60 to-gray-900/60 rounded-xl p-5 border border-gray-700/50">
        <div className="animate-pulse">
          <div className="h-5 bg-gray-700/40 rounded w-2/5 mb-3" />
          <div className="h-4 bg-gray-700/40 rounded w-3/4 mb-2" />
          <div className="h-4 bg-gray-700/40 rounded w-1/2" />
        </div>
      </div>
    );
  }

  if (!activeIntent || !['executed', 'monitoring'].includes(activeIntent.status)) {
    return (
      <div className="bg-gradient-to-br from-gray-800/50 to-gray-900/50 rounded-xl p-6 border border-gray-700/50">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-gray-700/50 rounded-lg">
            <Target className="w-6 h-6 text-gray-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-white mb-2">Entry Advisory</h3>
            <p className="text-sm text-gray-400">
              No active entry signals. Entry advisory activates when Alpha identifies a trade opportunity,
              comparing live price to Alpha's entry so you can time your own entry on an external platform.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const alphaEntry = activeIntent.actual_entry_price || activeIntent.execution_price || null;
  const isExecuted = activeIntent.status === 'executed';
  const isMonitoring = activeIntent.status === 'monitoring';

  if (isMonitoring) {
    return <MonitoringView intent={activeIntent} currentPrice={currentPrice} previousPrice={previousPrice} formatPrice={formatPrice} />;
  }

  if (!alphaEntry) {
    return null;
  }

  return <PostExecutionView intent={activeIntent} alphaEntry={alphaEntry} currentPrice={currentPrice} previousPrice={previousPrice} formatPrice={formatPrice} />;
};

interface ViewProps {
  intent: any;
  currentPrice: number | null;
  previousPrice: number | null;
  formatPrice: (price: number, symbol: string) => string;
}

interface PostExecutionViewProps extends ViewProps {
  alphaEntry: number;
}

const MonitoringView: React.FC<ViewProps> = ({ intent, currentPrice, previousPrice, formatPrice }) => {
  const pipInfo = getCurrencyPipInfo(intent.symbol);
  const zoneMin = intent.entry_zone_min;
  const zoneMax = intent.entry_zone_max;

  const inZone = currentPrice
    ? currentPrice >= zoneMin && currentPrice <= zoneMax
    : false;

  const distancePips = !inZone && currentPrice
    ? (currentPrice < zoneMin
      ? (zoneMin - currentPrice) / pipInfo.pipValue
      : (currentPrice - zoneMax) / pipInfo.pipValue)
    : 0;

  return (
    <div className="bg-gradient-to-br from-gray-800/60 to-gray-900/60 rounded-xl p-4 sm:p-5 border border-gray-700/50">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-cyan-400" />
          <h3 className="text-base font-bold text-white">Entry Advisory</h3>
          <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
            {intent.style || 'SCALP'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`px-2 py-0.5 rounded text-xs font-bold ${
            intent.direction === 'long'
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'bg-red-500/20 text-red-400 border border-red-500/30'
          }`}>
            {intent.direction === 'long' ? 'BUY' : 'SELL'} {intent.symbol}
          </span>
        </div>
      </div>

      <div className={`p-3 rounded-lg border mb-3 ${
        inZone
          ? 'bg-emerald-900/25 border-emerald-500/40'
          : 'bg-blue-900/20 border-blue-500/30'
      }`}>
        <div className="flex items-center gap-2">
          {inZone ? (
            <CheckCircle className="w-5 h-5 text-emerald-400 animate-pulse" />
          ) : (
            <MapPin className="w-5 h-5 text-blue-400" />
          )}
          <div>
            <div className={`font-semibold text-sm ${inZone ? 'text-emerald-300' : 'text-blue-300'}`}>
              {inZone ? 'Price in Entry Zone' : 'Waiting for Entry Zone'}
            </div>
            <div className="text-xs text-gray-300 mt-0.5">
              {inZone
                ? 'Price is in the target zone. Alpha is evaluating entry quality.'
                : `Price needs to ${intent.direction === 'long' ? 'pull back' : 'rally'} ${distancePips.toFixed(1)} pips`
              }
            </div>
          </div>
        </div>
      </div>

      {currentPrice && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700/40">
            <p className="text-xs text-gray-400 mb-1">Current Price</p>
            <div className="flex items-center gap-1.5">
              <PriceDirectionIcon current={currentPrice} previous={previousPrice} />
              <span className="text-lg font-bold font-mono text-white">
                {formatPrice(currentPrice, intent.symbol)}
              </span>
            </div>
          </div>
          <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700/40">
            <p className="text-xs text-gray-400 mb-1">Entry Zone</p>
            <span className="text-sm font-mono text-gray-200">
              {formatPrice(zoneMin, intent.symbol)} - {formatPrice(zoneMax, intent.symbol)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

const PostExecutionView: React.FC<PostExecutionViewProps> = ({ intent, alphaEntry, currentPrice, previousPrice, formatPrice }) => {
  const style = intent.style || intent.market_context?.style || 'MICRO_INTRADAY';
  const tolerances = getTolerances(style);
  const isLong = intent.direction === 'long';

  const distancePips = currentPrice
    ? calculatePipDistance(intent.symbol, currentPrice, alphaEntry)
    : 0;

  const advisoryState: AdvisoryState = currentPrice
    ? determineAdvisoryState(intent.direction, currentPrice, alphaEntry, distancePips, tolerances)
    : 'WAIT_PULLBACK';

  const pullbackTarget = alphaEntry;

  const pullbackDistancePips = currentPrice
    ? calculatePipDistance(intent.symbol, currentPrice, pullbackTarget)
    : 0;

  const stateConfig = {
    ENTER_NOW: {
      bgClass: 'bg-emerald-900/25 border-emerald-500/40',
      iconColor: 'text-emerald-400',
      textColor: 'text-emerald-300',
      label: 'Enter Now',
      sublabel: isLong
        ? 'Price is below Alpha\'s entry -- better buy price available'
        : 'Price is above Alpha\'s entry -- better sell price available',
      badge: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    },
    AT_ALPHA: {
      bgClass: 'bg-emerald-900/20 border-emerald-500/30',
      iconColor: 'text-emerald-400',
      textColor: 'text-emerald-300',
      label: 'Aligned with Alpha',
      sublabel: `Price is within ${tolerances.atAlphaPips} pips of Alpha's entry`,
      badge: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    },
    WAIT_PULLBACK: {
      bgClass: 'bg-amber-900/20 border-amber-500/30',
      iconColor: 'text-amber-400',
      textColor: 'text-amber-300',
      label: 'Wait for Pullback',
      sublabel: `Wait for ${pullbackDistancePips.toFixed(1)} pip ${isLong ? 'pullback' : 'rally'} to Alpha's entry for less drawdown`,
      badge: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    },
  };

  const config = stateConfig[advisoryState];

  return (
    <div className="bg-gradient-to-br from-gray-800/60 to-gray-900/60 rounded-xl p-4 sm:p-5 border border-gray-700/50">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-cyan-400" />
          <h3 className="text-base font-bold text-white">Entry Advisory</h3>
          <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
            {style}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`px-2 py-0.5 rounded text-xs font-bold ${
            isLong
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'bg-red-500/20 text-red-400 border border-red-500/30'
          }`}>
            {isLong ? 'BUY' : 'SELL'} {intent.symbol}
          </span>
        </div>
      </div>

      <div className={`p-3 rounded-lg border mb-3 ${config.bgClass}`}>
        <div className="flex items-center gap-2">
          {advisoryState === 'WAIT_PULLBACK' ? (
            <Activity className={`w-5 h-5 ${config.iconColor} animate-pulse`} />
          ) : (
            <CheckCircle className={`w-5 h-5 ${config.iconColor}`} />
          )}
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className={`font-semibold text-sm ${config.textColor}`}>
                {config.label}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded border ${config.badge}`}>
                {advisoryState === 'ENTER_NOW' ? 'BETTER PRICE' : advisoryState === 'AT_ALPHA' ? 'GOOD' : 'WAITING'}
              </span>
            </div>
            <div className="text-xs text-gray-300 mt-0.5">
              {config.sublabel}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700/40">
          <p className="text-xs text-gray-400 mb-1">Current Price</p>
          {currentPrice ? (
            <div className="flex items-center gap-1">
              <PriceDirectionIcon current={currentPrice} previous={previousPrice} />
              <span className={`text-base font-bold font-mono ${
                advisoryState === 'ENTER_NOW' ? 'text-emerald-400'
                : advisoryState === 'AT_ALPHA' ? 'text-emerald-300'
                : 'text-white'
              }`}>
                {formatPrice(currentPrice, intent.symbol)}
              </span>
            </div>
          ) : (
            <span className="text-sm text-gray-500">--</span>
          )}
        </div>

        <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700/40">
          <p className="text-xs text-gray-400 mb-1">Alpha's Entry</p>
          <span className="text-base font-bold font-mono text-cyan-400">
            {formatPrice(alphaEntry, intent.symbol)}
          </span>
        </div>

        <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700/40">
          <p className="text-xs text-gray-400 mb-1">Distance</p>
          <div className="flex items-baseline gap-1">
            <span className={`text-base font-bold font-mono ${
              advisoryState === 'ENTER_NOW' ? 'text-emerald-400'
              : advisoryState === 'AT_ALPHA' ? 'text-emerald-300'
              : 'text-amber-400'
            }`}>
              {distancePips.toFixed(1)}
            </span>
            <span className="text-xs text-gray-400">pips</span>
          </div>
        </div>
      </div>

      {advisoryState === 'WAIT_PULLBACK' && currentPrice && (
        <div className="bg-gray-900/40 rounded-lg p-3 border border-gray-700/30">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-gray-400">
              {isLong ? 'Need pullback' : 'Need rally'}
            </span>
            <span className="font-mono font-bold text-amber-400">
              {pullbackDistancePips.toFixed(1)} pips to target
            </span>
          </div>
          <PullbackProgressBar
            currentPrice={currentPrice}
            alphaEntry={alphaEntry}
            isLong={isLong}
            tolerancePips={tolerances.atAlphaPips}
            symbol={intent.symbol}
          />
        </div>
      )}

      {advisoryState === 'ENTER_NOW' && currentPrice && (
        <div className="bg-emerald-900/15 rounded-lg p-3 border border-emerald-500/20">
          <div className="flex items-center gap-2 text-xs text-emerald-300">
            <CheckCircle className="w-3.5 h-3.5" />
            <span>
              You can get a {distancePips.toFixed(1)} pip better entry than Alpha right now
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

const PriceDirectionIcon: React.FC<{ current: number | null; previous: number | null }> = ({ current, previous }) => {
  if (!current || !previous) return <Minus className="w-3 h-3 text-gray-400" />;
  if (current > previous) return <ArrowUp className="w-3 h-3 text-emerald-400" />;
  if (current < previous) return <ArrowDown className="w-3 h-3 text-red-400" />;
  return <Minus className="w-3 h-3 text-gray-400" />;
};

const PullbackProgressBar: React.FC<{
  currentPrice: number;
  alphaEntry: number;
  isLong: boolean;
  tolerancePips: number;
  symbol: string;
}> = ({ currentPrice, alphaEntry, isLong, tolerancePips, symbol }) => {
  const pipInfo = getCurrencyPipInfo(symbol);
  const totalDistance = Math.abs(currentPrice - alphaEntry) / pipInfo.pipValue;
  const toleranceDistance = tolerancePips;

  const progress = totalDistance > 0
    ? Math.max(0, Math.min(100, ((totalDistance - toleranceDistance) / totalDistance) * 100))
    : 100;

  const remaining = Math.max(0, totalDistance - toleranceDistance);

  return (
    <div>
      <div className="w-full bg-gray-700/50 rounded-full h-2 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-amber-500 to-emerald-500"
          style={{ width: `${100 - progress}%` }}
        />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-gray-500">Current</span>
        <span className="text-[10px] text-gray-500">Alpha's Entry</span>
      </div>
    </div>
  );
};
