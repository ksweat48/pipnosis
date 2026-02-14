/**
 * ENTRY PRICE MONITOR - Structural Entry Validation & Pullback Advisory
 *
 * SSOT Authority: Single UI for entry advisory verdicts
 * Data Source: entry_intents.structural_verdict + entry_intents.market_context.structural_analysis
 *
 * TWO VERDICTS:
 * 1. OPTIMAL_ENTRY - Alpha's entry aligns with key S/R. Enter now.
 * 2. WAIT_FOR_PULLBACK - Entry not at S/R. Wait for pullback to target price.
 *
 * CCIP COMPLIANCE:
 * - No business logic - purely presentation of EntryStructureAnalyzer results
 * - Real-time price tracking via realtime_prices table (polled every 2s)
 * - Pullback tracking is client-side only (no server-side state changes)
 *
 * GOVERNANCE COMPLIANCE:
 * - Advisory only - never blocks or modifies trade execution
 * - All structural data comes from entry_intents (SSOT)
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Target, CheckCircle, ArrowUp, ArrowDown, Minus,
  Shield, Clock, Activity, Crosshair
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

  const structuralVerdict = activeIntent.structural_verdict
    || activeIntent.market_context?.structural_analysis?.verdict
    || null;

  const structuralData = activeIntent.market_context?.structural_analysis || null;

  return (
    <StructuralAdvisoryView
      intent={activeIntent}
      structuralVerdict={structuralVerdict}
      structuralData={structuralData}
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

interface StructuralAdvisoryViewProps {
  intent: any;
  structuralVerdict: string | null;
  structuralData: any;
  currentPrice: number | null;
  previousPrice: number | null;
}

const StructuralAdvisoryView: React.FC<StructuralAdvisoryViewProps> = ({
  intent,
  structuralVerdict,
  structuralData,
  currentPrice,
  previousPrice
}) => {
  const direction = intent.direction === 'long' ? 'long' : 'short';
  const symbol = intent.symbol || '';
  const alphaEntry = intent.actual_entry_price || intent.execution_price || intent.entry_zone_min || null;
  const alphaConfidence = intent.alpha_confidence || intent.market_context?.confidence || null;
  const style = intent.style || intent.market_context?.style || 'SCALP';

  const backingLevel = structuralData?.backing_level || (intent.structural_level_price ? {
    price: intent.structural_level_price,
    type: intent.structural_level_type,
    strength: intent.structural_level_strength,
    touches: intent.structural_level_touches
  } : null);

  const pullbackTarget = intent.pullback_target_price || structuralData?.pullback_target || null;
  const improvementPips = intent.pullback_improvement_pips || structuralData?.pullback_improvement_pips || 0;
  const reasoning = structuralData?.reasoning || null;

  const isOptimal = structuralVerdict === 'OPTIMAL_ENTRY';
  const isWaitPullback = structuralVerdict === 'WAIT_FOR_PULLBACK';

  const pullbackState = useMemo((): PullbackTrackingState | null => {
    if (!isWaitPullback || !currentPrice || !pullbackTarget) return null;

    if (direction === 'long') {
      if (currentPrice <= pullbackTarget) return 'REACHED';
      const distNow = currentPrice - pullbackTarget;
      const distEntry = (alphaEntry || currentPrice) - pullbackTarget;
      return distNow < distEntry * 0.7 ? 'APPROACHING' : 'RETREATING';
    } else {
      if (currentPrice >= pullbackTarget) return 'REACHED';
      const distNow = pullbackTarget - currentPrice;
      const distEntry = pullbackTarget - (alphaEntry || currentPrice);
      return distNow < distEntry * 0.7 ? 'APPROACHING' : 'RETREATING';
    }
  }, [isWaitPullback, currentPrice, pullbackTarget, alphaEntry, direction]);

  const distanceToPullback = useMemo(() => {
    if (!currentPrice || !pullbackTarget) return null;
    return Math.abs(currentPrice - pullbackTarget);
  }, [currentPrice, pullbackTarget]);

  const formatPrice = useCallback((price: number): string => {
    return formatCurrencyPrice(symbol, price);
  }, [symbol]);

  if (!structuralVerdict) {
    return <FallbackView intent={intent} currentPrice={currentPrice} previousPrice={previousPrice} />;
  }

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

      {isOptimal && (
        <OptimalEntryBanner
          backingLevel={backingLevel}
          alphaConfidence={alphaConfidence}
          direction={direction}
          symbol={symbol}
          formatPrice={formatPrice}
          reasoning={reasoning}
        />
      )}

      {isWaitPullback && (
        <PullbackAdvisoryBanner
          pullbackTarget={pullbackTarget}
          improvementPips={improvementPips}
          backingLevel={backingLevel}
          pullbackState={pullbackState}
          distanceToPullback={distanceToPullback}
          direction={direction}
          symbol={symbol}
          formatPrice={formatPrice}
          reasoning={reasoning}
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
            {isOptimal ? 'S/R Level' : 'Pullback To'}
          </p>
          {isOptimal && backingLevel?.price ? (
            <span className="text-base font-bold font-mono text-emerald-400">
              {formatPrice(backingLevel.price)}
            </span>
          ) : pullbackTarget ? (
            <span className={`text-base font-bold font-mono ${
              pullbackState === 'REACHED' ? 'text-emerald-400' : 'text-amber-400'
            }`}>
              {formatPrice(pullbackTarget)}
            </span>
          ) : (
            <span className="text-sm text-gray-500">--</span>
          )}
        </div>
      </div>

      {backingLevel && (
        <div className="mt-3 bg-gray-900/40 rounded-lg p-3 border border-gray-700/30">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">Structural Level</span>
            <div className="flex items-center gap-2">
              <span className="text-gray-300 font-mono">{formatPrice(backingLevel.price)}</span>
              <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${
                backingLevel.type === 'support'
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : 'bg-red-500/15 text-red-400 border-red-500/30'
              }`}>
                {(backingLevel.type || '').toUpperCase()}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-2">
            <div className="flex items-center gap-1 text-xs">
              <Shield className="w-3 h-3 text-gray-400" />
              <span className="text-gray-400">Strength:</span>
              <StrengthIndicator strength={backingLevel.strength || 0} />
            </div>
            {backingLevel.touches && (
              <div className="flex items-center gap-1 text-xs">
                <Crosshair className="w-3 h-3 text-gray-400" />
                <span className="text-gray-400">Tested:</span>
                <span className="text-white font-bold">{backingLevel.touches}x</span>
              </div>
            )}
          </div>
        </div>
      )}

      {alphaConfidence && (
        <div className="mt-2 flex items-center justify-between text-xs text-gray-500 px-1">
          <span>Alpha Confidence: {alphaConfidence}%</span>
          {isWaitPullback && improvementPips > 0 && (
            <span className="text-amber-400">
              Potential improvement: {improvementPips.toFixed(1)} pips
            </span>
          )}
        </div>
      )}
    </div>
  );
};

interface OptimalEntryBannerProps {
  backingLevel: any;
  alphaConfidence: number | null;
  direction: string;
  symbol: string;
  formatPrice: (price: number) => string;
  reasoning: string | null;
}

const OptimalEntryBanner: React.FC<OptimalEntryBannerProps> = ({
  backingLevel,
  direction,
  formatPrice,
  reasoning
}) => {
  const levelLabel = direction === 'long' ? 'support' : 'resistance';
  const strengthLabel = backingLevel?.strength >= 0.7 ? 'strong' : backingLevel?.strength >= 0.5 ? 'moderate' : 'developing';

  return (
    <div className="p-3 rounded-lg border bg-emerald-900/25 border-emerald-500/40">
      <div className="flex items-start gap-2.5">
        <CheckCircle className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-sm text-emerald-300">Optimal Entry</span>
            <span className="text-xs px-1.5 py-0.5 rounded border bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
              ENTER NOW
            </span>
          </div>
          <p className="text-xs text-gray-300 leading-relaxed">
            {reasoning || (backingLevel
              ? `Entry aligns with ${strengthLabel} ${levelLabel} at ${formatPrice(backingLevel.price)} (tested ${backingLevel.touches || 0} times). Structurally backed entry.`
              : 'Entry quality verified. Enter on your external platform.'
            )}
          </p>
        </div>
      </div>
    </div>
  );
};

interface PullbackAdvisoryBannerProps {
  pullbackTarget: number | null;
  improvementPips: number;
  backingLevel: any;
  pullbackState: PullbackTrackingState | null;
  distanceToPullback: number | null;
  direction: string;
  symbol: string;
  formatPrice: (price: number) => string;
  reasoning: string | null;
}

const PullbackAdvisoryBanner: React.FC<PullbackAdvisoryBannerProps> = ({
  pullbackTarget,
  improvementPips,
  pullbackState,
  distanceToPullback,
  direction,
  formatPrice,
  reasoning
}) => {
  if (pullbackState === 'REACHED') {
    return (
      <div className="p-3 rounded-lg border bg-emerald-900/30 border-emerald-500/50 animate-pulse">
        <div className="flex items-start gap-2.5">
          <CheckCircle className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-sm text-emerald-300">Pullback Reached</span>
              <span className="text-xs px-1.5 py-0.5 rounded border bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-bold">
                ENTER NOW
              </span>
            </div>
            <p className="text-xs text-emerald-200">
              Price has pulled back to the target zone. Enter now for a better entry
              {improvementPips > 0 ? ` with ~${improvementPips.toFixed(1)} pips improvement.` : '.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const actionLabel = direction === 'long' ? 'pullback' : 'rally';

  return (
    <div className={`p-3 rounded-lg border ${
      pullbackState === 'APPROACHING'
        ? 'bg-blue-900/25 border-blue-500/40'
        : 'bg-amber-900/20 border-amber-500/30'
    }`}>
      <div className="flex items-start gap-2.5">
        <Clock className={`w-5 h-5 mt-0.5 flex-shrink-0 ${
          pullbackState === 'APPROACHING' ? 'text-blue-400' : 'text-amber-400'
        }`} />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`font-semibold text-sm ${
              pullbackState === 'APPROACHING' ? 'text-blue-300' : 'text-amber-300'
            }`}>
              Wait for {actionLabel.charAt(0).toUpperCase() + actionLabel.slice(1)}
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded border ${
              pullbackState === 'APPROACHING'
                ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
            }`}>
              {pullbackState === 'APPROACHING' ? 'APPROACHING' : 'MONITORING'}
            </span>
          </div>
          <p className="text-xs text-gray-300 leading-relaxed">
            {reasoning || (pullbackTarget
              ? `Wait for ${actionLabel} to ${formatPrice(pullbackTarget)} for a better entry. Potential improvement: ${improvementPips.toFixed(1)} pips less drawdown.`
              : `Monitoring for ${actionLabel} opportunity.`
            )}
          </p>
        </div>
      </div>

      {pullbackTarget && distanceToPullback != null && (
        <div className="mt-2.5 pt-2 border-t border-gray-700/40">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-gray-400">Distance to target</span>
            <span className={`font-mono font-bold ${
              pullbackState === 'APPROACHING' ? 'text-blue-400' : 'text-amber-400'
            }`}>
              {formatPrice(distanceToPullback)}
            </span>
          </div>
          <PullbackProgressBar
            currentPrice={distanceToPullback}
            totalDistance={improvementPips > 0 ? improvementPips : undefined}
            state={pullbackState}
          />
        </div>
      )}
    </div>
  );
};

const FallbackView: React.FC<{
  intent: any;
  currentPrice: number | null;
  previousPrice: number | null;
}> = ({ intent, currentPrice, previousPrice }) => {
  const direction = intent.direction === 'long' ? 'long' : 'short';
  const symbol = intent.symbol || '';
  const alphaEntry = intent.actual_entry_price || intent.execution_price || null;
  const style = intent.style || 'SCALP';

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
        <span className={`px-2 py-0.5 rounded text-xs font-bold ${
          direction === 'long'
            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
            : 'bg-red-500/20 text-red-400 border border-red-500/30'
        }`}>
          {direction === 'long' ? 'BUY' : 'SELL'} {symbol}
        </span>
      </div>

      <div className="p-3 rounded-lg border bg-gray-900/30 border-gray-600/40 mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-gray-400" />
          <div>
            <span className="font-semibold text-sm text-gray-300">Analyzing Structure</span>
            <p className="text-xs text-gray-400 mt-0.5">
              Structural analysis pending. Use Alpha's confidence for entry timing.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700/40">
          <p className="text-xs text-gray-400 mb-1">Live Price</p>
          {currentPrice ? (
            <div className="flex items-center gap-1">
              <PriceDirectionIcon current={currentPrice} previous={previousPrice} />
              <span className="text-base font-bold font-mono text-white">
                {formatCurrencyPrice(symbol, currentPrice)}
              </span>
            </div>
          ) : (
            <span className="text-sm text-gray-500">--</span>
          )}
        </div>
        {alphaEntry && (
          <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700/40">
            <p className="text-xs text-gray-400 mb-1">Alpha Entry</p>
            <span className="text-base font-bold font-mono text-cyan-400">
              {formatCurrencyPrice(symbol, alphaEntry)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

const PriceDirectionIcon: React.FC<{ current: number | null; previous: number | null }> = ({ current, previous }) => {
  if (!current || !previous) return <Minus className="w-3 h-3 text-gray-400" />;
  if (current > previous) return <ArrowUp className="w-3 h-3 text-emerald-400" />;
  if (current < previous) return <ArrowDown className="w-3 h-3 text-red-400" />;
  return <Minus className="w-3 h-3 text-gray-400" />;
};

const StrengthIndicator: React.FC<{ strength: number }> = ({ strength }) => {
  const pct = Math.round(strength * 100);
  const label = strength >= 0.7 ? 'Strong' : strength >= 0.5 ? 'Moderate' : 'Developing';
  const color = strength >= 0.7 ? 'text-emerald-400' : strength >= 0.5 ? 'text-amber-400' : 'text-gray-400';

  return (
    <span className={`font-bold ${color}`}>{label} ({pct}%)</span>
  );
};

const PullbackProgressBar: React.FC<{
  currentPrice: number;
  totalDistance?: number;
  state: PullbackTrackingState | null;
}> = ({ currentPrice, totalDistance, state }) => {
  const progress = totalDistance && totalDistance > 0
    ? Math.max(0, Math.min(100, ((totalDistance - currentPrice) / totalDistance) * 100))
    : 0;

  const barColor = state === 'APPROACHING'
    ? 'bg-blue-500'
    : state === 'REACHED'
      ? 'bg-emerald-500'
      : 'bg-amber-500';

  return (
    <div className="w-full bg-gray-700/50 rounded-full h-1.5 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-700 ${barColor}`}
        style={{ width: `${progress}%` }}
      />
    </div>
  );
};
