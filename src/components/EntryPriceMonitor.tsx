/**
 * ENTRY PRICE MONITOR - Alpha's Entry Advisory Intelligence
 *
 * SSOT Authority: Single UI for Alpha's entry quality assessment
 * Data Source: entry_intents.market_context.alpha_entry_advisory (SOLE authority)
 *
 * TWO VERDICTS (from Alpha's LLM):
 * 1. GOOD_ENTRY - Alpha confirms this is the best available entry
 * 2. PULLBACK_EXPECTED - Alpha expects a pullback to a better zone
 *    When price reaches the pullback zone, UI flips to GOOD_ENTRY
 *
 * CCIP COMPLIANCE (2026-02-17):
 * - Alpha's LLM is the SOLE authority for entry advisory
 * - EntryStructureAnalyzer is NOT used (deprecated as data source)
 * - Advisory only - never blocks or modifies trade execution
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Target, CheckCircle, ArrowUp, ArrowDown, Minus,
  Clock, TrendingUp
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useActiveEntryIntent } from '@/hooks/useEntryIntent';
import { formatCurrencyPrice } from '@/utils/currencyHelpers';

interface ActiveGoalSession {
  id: string;
  status: string;
}

type PullbackTrackingState = 'APPROACHING' | 'REACHED' | 'RETREATING';

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

    const symbol = activeIntent.symbol;
    if (!symbol) return;

    let isMounted = true;

    const fetchPrice = async () => {
      try {
        const { data, error } = await supabase
          .from('realtime_prices')
          .select('mid')
          .eq('symbol', symbol)
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
    return <EmptyState />;
  }

  const alphaAdvisory = activeIntent.market_context?.alpha_entry_advisory || null;

  return (
    <AlphaEntryAdvisoryView
      intent={activeIntent}
      advisory={alphaAdvisory}
      currentPrice={currentPrice}
      previousPrice={previousPrice}
    />
  );
};

const EmptyState: React.FC = () => (
  <div className="bg-gradient-to-br from-gray-800/50 to-gray-900/50 rounded-xl p-6 border border-gray-700/50">
    <div className="flex items-start gap-4">
      <div className="p-3 bg-gray-700/50 rounded-lg">
        <Target className="w-6 h-6 text-gray-400" />
      </div>
      <div className="flex-1">
        <h3 className="text-lg font-bold text-white mb-2">Entry Advisory</h3>
        <p className="text-sm text-gray-400">
          No active entry signals. Entry advisory activates when Alpha identifies a trade opportunity,
          analyzing market structure to determine if the entry is optimal or if waiting for a pullback would give you a better price.
        </p>
      </div>
    </div>
  </div>
);

interface AlphaAdvisory {
  verdict: string;
  pullback_zone_min: number | null;
  pullback_zone_max: number | null;
  reasoning: string;
}

interface AlphaEntryAdvisoryViewProps {
  intent: any;
  advisory: AlphaAdvisory | null;
  currentPrice: number | null;
  previousPrice: number | null;
}

const AlphaEntryAdvisoryView: React.FC<AlphaEntryAdvisoryViewProps> = ({
  intent,
  advisory,
  currentPrice,
  previousPrice
}) => {
  const direction = intent.direction === 'long' ? 'long' : 'short';
  const symbol = intent.symbol || '';
  const alphaEntry = intent.actual_entry_price || intent.execution_price || intent.entry_zone_min || null;
  const alphaConfidence = intent.alpha_confidence || intent.market_context?.confidence || null;
  const style = intent.style || intent.market_context?.style || 'SCALP';

  const verdict = advisory?.verdict || 'GOOD_ENTRY';
  const isPullbackExpected = verdict === 'PULLBACK_EXPECTED' || verdict === 'WAIT_FOR_PULLBACK';
  const pullbackZoneMin = advisory?.pullback_zone_min ?? intent.entry_zone_min ?? null;
  const pullbackZoneMax = advisory?.pullback_zone_max ?? intent.entry_zone_max ?? null;
  const advisoryReasoning = advisory?.reasoning || null;

  const pullbackState = useMemo((): PullbackTrackingState | null => {
    if (!isPullbackExpected || !currentPrice || !pullbackZoneMin || !pullbackZoneMax) return null;

    if (direction === 'long') {
      if (currentPrice <= pullbackZoneMax && currentPrice >= pullbackZoneMin) return 'REACHED';
      if (currentPrice < pullbackZoneMin) return 'REACHED';
      const distNow = currentPrice - pullbackZoneMax;
      const distEntry = (alphaEntry || currentPrice) - pullbackZoneMax;
      return distNow < distEntry * 0.7 ? 'APPROACHING' : 'RETREATING';
    } else {
      if (currentPrice >= pullbackZoneMin && currentPrice <= pullbackZoneMax) return 'REACHED';
      if (currentPrice > pullbackZoneMax) return 'REACHED';
      const distNow = pullbackZoneMin - currentPrice;
      const distEntry = pullbackZoneMin - (alphaEntry || currentPrice);
      return distNow < distEntry * 0.7 ? 'APPROACHING' : 'RETREATING';
    }
  }, [isPullbackExpected, currentPrice, pullbackZoneMin, pullbackZoneMax, alphaEntry, direction]);

  const isGoodEntry = !isPullbackExpected || pullbackState === 'REACHED';

  const formatPrice = useCallback((price: number): string => {
    return formatCurrencyPrice(symbol, price);
  }, [symbol]);

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
            direction === 'long'
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'bg-red-500/20 text-red-400 border border-red-500/30'
          }`}>
            {direction === 'long' ? 'BUY' : 'SELL'} {symbol}
          </span>
        </div>
      </div>

      {isGoodEntry ? (
        <GoodEntryBanner
          reasoning={advisoryReasoning}
          pullbackReached={isPullbackExpected && pullbackState === 'REACHED'}
        />
      ) : (
        <PullbackExpectedBanner
          pullbackZoneMin={pullbackZoneMin}
          pullbackZoneMax={pullbackZoneMax}
          pullbackState={pullbackState}
          direction={direction}
          alphaEntry={alphaEntry}
          currentPrice={currentPrice}
          formatPrice={formatPrice}
          reasoning={advisoryReasoning}
        />
      )}

      <div className="grid grid-cols-3 gap-2 mt-3">
        <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700/40">
          <p className="text-xs text-gray-400 mb-1">Live Price</p>
          {currentPrice ? (
            <div className="flex items-center gap-1">
              <PriceDirectionIcon current={currentPrice} previous={previousPrice} />
              <span className="text-base font-bold font-mono text-white">
                {formatPrice(currentPrice)}
              </span>
            </div>
          ) : (
            <span className="text-sm text-gray-500">--</span>
          )}
        </div>

        <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700/40">
          <p className="text-xs text-gray-400 mb-1">Alpha Entry</p>
          {alphaEntry ? (
            <span className="text-base font-bold font-mono text-cyan-400">
              {formatPrice(alphaEntry)}
            </span>
          ) : (
            <span className="text-sm text-gray-500">--</span>
          )}
        </div>

        <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700/40">
          <p className="text-xs text-gray-400 mb-1">
            {isPullbackExpected && !isGoodEntry ? 'Best Entry Zone' : 'Confidence'}
          </p>
          {isPullbackExpected && !isGoodEntry && pullbackZoneMin && pullbackZoneMax ? (
            <span className={`text-sm font-bold font-mono ${
              pullbackState === 'APPROACHING' ? 'text-blue-400' : 'text-amber-400'
            }`}>
              {formatPrice(pullbackZoneMin)} - {formatPrice(pullbackZoneMax)}
            </span>
          ) : alphaConfidence ? (
            <span className={`text-base font-bold ${
              alphaConfidence >= 85 ? 'text-emerald-400' : alphaConfidence >= 70 ? 'text-yellow-400' : 'text-blue-400'
            }`}>
              {alphaConfidence}%
            </span>
          ) : (
            <span className="text-sm text-gray-500">--</span>
          )}
        </div>
      </div>

      {alphaConfidence && (
        <div className="mt-2 flex items-center justify-between text-xs text-gray-500 px-1">
          <span>Alpha Confidence: {alphaConfidence}%</span>
          {isPullbackExpected && !isGoodEntry && pullbackZoneMin && pullbackZoneMax && currentPrice && (
            <span className={`${pullbackState === 'APPROACHING' ? 'text-blue-400' : 'text-amber-400'}`}>
              {direction === 'long'
                ? `${formatPrice(Math.abs(currentPrice - pullbackZoneMax))} away`
                : `${formatPrice(Math.abs(pullbackZoneMin - currentPrice))} away`
              }
            </span>
          )}
        </div>
      )}
    </div>
  );
};

interface GoodEntryBannerProps {
  reasoning: string | null;
  pullbackReached: boolean;
}

const GoodEntryBanner: React.FC<GoodEntryBannerProps> = ({ reasoning, pullbackReached }) => (
  <div className={`p-3 rounded-lg border ${
    pullbackReached
      ? 'bg-emerald-900/30 border-emerald-500/50 animate-pulse'
      : 'bg-emerald-900/25 border-emerald-500/40'
  }`}>
    <div className="flex items-start gap-2.5">
      <CheckCircle className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" />
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-sm text-emerald-300">
            {pullbackReached ? 'Pullback Zone Reached' : 'Good Entry'}
          </span>
          <span className="text-xs px-1.5 py-0.5 rounded border bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-bold">
            {pullbackReached ? 'ENTER NOW' : 'CONFIRMED'}
          </span>
        </div>
        <p className="text-xs text-gray-300 leading-relaxed">
          {pullbackReached
            ? 'Price has pulled back into Alpha\'s predicted zone. This is the better entry Alpha identified.'
            : reasoning || 'Alpha confirms this is the best available entry. No better price expected at this time.'
          }
        </p>
      </div>
    </div>
  </div>
);

interface PullbackExpectedBannerProps {
  pullbackZoneMin: number | null;
  pullbackZoneMax: number | null;
  pullbackState: PullbackTrackingState | null;
  direction: string;
  alphaEntry: number | null;
  currentPrice: number | null;
  formatPrice: (price: number) => string;
  reasoning: string | null;
}

const PullbackExpectedBanner: React.FC<PullbackExpectedBannerProps> = ({
  pullbackZoneMin,
  pullbackZoneMax,
  pullbackState,
  direction,
  alphaEntry,
  currentPrice,
  formatPrice,
  reasoning
}) => {
  const actionLabel = direction === 'long' ? 'pullback' : 'rally';
  const isApproaching = pullbackState === 'APPROACHING';

  const progress = useMemo(() => {
    if (!currentPrice || !alphaEntry || !pullbackZoneMin || !pullbackZoneMax) return 0;
    const targetMid = (pullbackZoneMin + pullbackZoneMax) / 2;
    const totalDist = Math.abs(alphaEntry - targetMid);
    if (totalDist === 0) return 100;
    const currentDist = Math.abs(currentPrice - targetMid);
    return Math.max(0, Math.min(100, ((totalDist - currentDist) / totalDist) * 100));
  }, [currentPrice, alphaEntry, pullbackZoneMin, pullbackZoneMax]);

  return (
    <div className={`p-3 rounded-lg border ${
      isApproaching
        ? 'bg-blue-900/25 border-blue-500/40'
        : 'bg-amber-900/20 border-amber-500/30'
    }`}>
      <div className="flex items-start gap-2.5">
        <Clock className={`w-5 h-5 mt-0.5 flex-shrink-0 ${
          isApproaching ? 'text-blue-400' : 'text-amber-400'
        }`} />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`font-semibold text-sm ${
              isApproaching ? 'text-blue-300' : 'text-amber-300'
            }`}>
              Better Entry Expected
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded border ${
              isApproaching
                ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
            }`}>
              {isApproaching ? 'APPROACHING' : 'MONITORING'}
            </span>
          </div>
          <p className="text-xs text-gray-300 leading-relaxed">
            {reasoning || (pullbackZoneMin && pullbackZoneMax
              ? `Alpha expects a ${actionLabel} to ${formatPrice(pullbackZoneMin)} - ${formatPrice(pullbackZoneMax)} for a better entry.`
              : `Alpha expects a ${actionLabel} opportunity. Monitoring price action.`
            )}
          </p>
        </div>
      </div>

      {pullbackZoneMin && pullbackZoneMax && (
        <div className="mt-2.5 pt-2 border-t border-gray-700/40">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-3 h-3 text-gray-400" />
              <span className="text-gray-400">Target zone</span>
            </div>
            <span className={`font-mono font-bold ${
              isApproaching ? 'text-blue-400' : 'text-amber-400'
            }`}>
              {formatPrice(pullbackZoneMin)} - {formatPrice(pullbackZoneMax)}
            </span>
          </div>
          <div className="w-full bg-gray-700/50 rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                isApproaching ? 'bg-blue-500' : 'bg-amber-500'
              }`}
              style={{ width: `${progress}%` }}
            />
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
