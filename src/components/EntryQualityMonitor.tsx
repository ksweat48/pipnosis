/**
 * Entry Quality Monitor Component
 *
 * ARCHITECTURE: Uses SSOT hook (useActiveEntryIntent) instead of direct database queries
 */

import React, { useState, useEffect } from 'react';
import { Activity, TrendingUp, TrendingDown, CheckCircle, Clock, AlertCircle, Target, MapPin, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useActiveEntryIntent } from '../hooks/useEntryIntent';

interface EQSBreakdown {
  pullbackQuality: number;
  vwapInteraction: number;
  emaAlignment: number;
  liquidityReaction: number;
  compressionExpansion: number;
  failedMoveConfirmation: number;
  timeframeAlignment: number;
}

interface EQSUpdate {
  id: string;
  symbol: string;
  eqs_score: number;
  eqs_grade: string;
  eqs_threshold: number;
  breakdown: EQSBreakdown;
  status: string;
  created_at: string;
  current_price?: number;
  in_entry_zone?: boolean;
  distance_to_zone_pips?: number;
}

interface EntryQualityMonitorProps {
  sessionId: string;
  intentId?: string;
}

export const EntryQualityMonitor: React.FC<EntryQualityMonitorProps> = ({ sessionId, intentId }) => {
  const [latestEQS, setLatestEQS] = useState<EQSUpdate | null>(null);
  const [loading, setLoading] = useState(true);
  const [waitingForMonitoring, setWaitingForMonitoring] = useState(false);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [previousPrice, setPreviousPrice] = useState<number | null>(null);

  const { activeIntent, loading: intentLoading } = useActiveEntryIntent(sessionId);

  useEffect(() => {
    console.log('[EntryQualityMonitor] 🔄 Component effect triggered', {
      hasActiveIntent: !!activeIntent,
      intentId: activeIntent?.id?.substring(0, 8),
      intentStatus: activeIntent?.status,
      sessionId: sessionId?.substring(0, 8),
      intentLoading
    });

    // Show waiting state when no intent and not loading
    // Hook's realtime subscription will automatically update when intent is created
    if (!activeIntent && !intentLoading) {
      console.log('[EntryQualityMonitor] ⏳ No active intent yet, showing waiting state');
      console.log('[EntryQualityMonitor] 💡 Realtime subscription in hook will notify when intent is created');
      setLatestEQS(null);
      setLoading(false);
      setWaitingForMonitoring(true);
      return;
    }

    if (!activeIntent) {
      // Still loading initial data
      return;
    }

    console.log('[EntryQualityMonitor] ✅ Active intent found, starting monitoring', {
      intentId: activeIntent.id.substring(0, 8),
      symbol: activeIntent.symbol,
      status: activeIntent.status
    });

    setWaitingForMonitoring(false);
    loadLatestEQS(activeIntent.id);

    const interval = setInterval(() => {
      console.log('[EntryQualityMonitor] ⏰ Polling for EQS updates...');
      loadLatestEQS(activeIntent.id);
    }, 5000);

    // Subscribe to EQS monitoring logs for this intent
    const channel = supabase
      .channel(`eqs-updates-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'entry_monitoring_logs',
          filter: `intent_id=eq.${activeIntent.id}`
        },
        (payload) => {
          console.log('[EntryQualityMonitor] 📥 Realtime EQS update received', payload.new);
          if (payload.new) {
            setLatestEQS(payload.new as EQSUpdate);
          }
        }
      )
      .subscribe((status) => {
        console.log('[EntryQualityMonitor] 📡 EQS subscription status:', status);
      });

    return () => {
      console.log('[EntryQualityMonitor] 🧹 Cleaning up interval and subscription');
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [activeIntent?.id, activeIntent?.status, sessionId, intentLoading]);

  const loadLatestEQS = async (currentIntentId: string) => {
    console.log('[EntryQualityMonitor] 🔍 Loading EQS data for intent:', currentIntentId.substring(0, 8));
    try {
      const { data, error } = await supabase
        .from('entry_monitoring_logs')
        .select('*')
        .eq('intent_id', currentIntentId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[EntryQualityMonitor] ❌ Database error loading EQS:', error);
      } else if (data) {
        console.log('[EntryQualityMonitor] ✅ EQS data loaded:', {
          eqsScore: data.eqs_score,
          grade: data.eqs_grade,
          status: data.status
        });
        setLatestEQS(data as EQSUpdate);
      } else {
        console.log('[EntryQualityMonitor] ⏳ No EQS data yet, monitoring still initializing...');
      }
    } catch (error) {
      console.error('[EntryQualityMonitor] ❌ Error loading EQS:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadCurrentPrice = async (symbol: string) => {
    try {
      const { data, error } = await supabase
        .from('realtime_prices')
        .select('mid')
        .eq('symbol', symbol)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data && !error) {
        setPreviousPrice(currentPrice);
        setCurrentPrice(data.mid);
      }
    } catch (error) {
      console.error('[EntryQualityMonitor] ❌ Error loading current price:', error);
    }
  };

  useEffect(() => {
    if (activeIntent) {
      loadCurrentPrice(activeIntent.symbol);
      const priceInterval = setInterval(() => {
        loadCurrentPrice(activeIntent.symbol);
      }, 2000);
      return () => clearInterval(priceInterval);
    }
  }, [activeIntent]);

  // Show loading state during initial hook fetch
  if (intentLoading) {
    return (
      <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-400 animate-pulse" />
          <span className="text-sm text-gray-400">Initializing entry quality monitor...</span>
        </div>
      </div>
    );
  }

  // Show waiting state when monitoring is starting
  if (waitingForMonitoring || !activeIntent) {
    return (
      <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-purple-400" />
            <h3 className="text-lg font-bold text-white">Entry Quality Monitor</h3>
          </div>
          <div className="px-3 py-1 rounded-lg border border-gray-600 bg-gray-700/30">
            <span className="text-xs text-gray-400">Waiting</span>
          </div>
        </div>
        <div className="flex items-start gap-3 p-3 bg-blue-900/20 border border-blue-700/50 rounded-lg">
          <Clock className="w-5 h-5 text-blue-400 animate-pulse flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-blue-300 mb-1">
              Waiting for monitoring to start
            </div>
            <div className="text-xs text-gray-400">
              Entry quality monitoring will begin once Alpha identifies a trade opportunity and starts analyzing entry conditions.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show "calculating" state when we have an intent but no EQS data yet
  if (!latestEQS) {
    return (
      <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-purple-400 animate-pulse" />
            <h3 className="text-lg font-bold text-white">Entry Quality Monitor</h3>
          </div>
          <div className="px-3 py-1 rounded-lg border border-yellow-600 bg-yellow-700/20">
            <span className="text-xs text-yellow-400">Analyzing</span>
          </div>
        </div>
        <div className="flex items-start gap-3 p-3 bg-yellow-900/20 border border-yellow-700/50 rounded-lg">
          <Activity className="w-5 h-5 text-yellow-400 animate-pulse flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-yellow-300 mb-1">
              Calculating Entry Quality Score
            </div>
            <div className="text-xs text-gray-400 mb-2">
              Monitoring {activeIntent.symbol} for {activeIntent.direction === 'long' ? 'BUY' : 'SELL'} entry...
            </div>
            <div className="text-xs text-gray-500">
              First quality assessment will appear within seconds
            </div>
          </div>
        </div>
      </div>
    );
  }

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'A+':
      case 'A':
        return 'text-green-400 bg-green-500/10 border-green-500/30';
      case 'B':
        return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
      case 'C':
        return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';
      case 'D':
        return 'text-orange-400 bg-orange-500/10 border-orange-500/30';
      case 'F':
        return 'text-red-400 bg-red-500/10 border-red-500/30';
      default:
        return 'text-gray-400 bg-gray-500/10 border-gray-500/30';
    }
  };

  const getMetricColor = (score: number, max: number) => {
    const percentage = (score / max) * 100;
    if (percentage >= 80) return 'text-green-400';
    if (percentage >= 60) return 'text-blue-400';
    if (percentage >= 40) return 'text-yellow-400';
    if (percentage >= 20) return 'text-orange-400';
    return 'text-red-400';
  };

  const getMetricIcon = (score: number, max: number) => {
    const percentage = (score / max) * 100;
    if (percentage >= 80) return <CheckCircle className="w-3 h-3 text-green-400" />;
    if (percentage >= 40) return <Clock className="w-3 h-3 text-yellow-400" />;
    return <AlertCircle className="w-3 h-3 text-red-400" />;
  };

  const getMonitoringFrequency = (style: string): string => {
    const frequencies: Record<string, string> = {
      'SCALP': '2s',
      'MICRO_INTRADAY': '3s',
      'INTRADAY': '5s'
    };
    return frequencies[style] || '5s';
  };

  const getStyleDisplayName = (style: string): string => {
    const names: Record<string, string> = {
      'SCALP': 'Scalp',
      'MICRO_INTRADAY': 'Micro Intraday',
      'INTRADAY': 'Intraday'
    };
    return names[style] || style;
  };

  const getPriceDirectionIcon = () => {
    if (!currentPrice || !previousPrice) return <Minus className="w-3 h-3 text-gray-400" />;
    if (currentPrice > previousPrice) return <ArrowUp className="w-3 h-3 text-green-400" />;
    if (currentPrice < previousPrice) return <ArrowDown className="w-3 h-3 text-red-400" />;
    return <Minus className="w-3 h-3 text-gray-400" />;
  };

  const breakdown = latestEQS.breakdown;
  const scorePercentage = (latestEQS.eqs_score / 100) * 100;
  const thresholdPercentage = (latestEQS.eqs_threshold / 100) * 100;

  const metrics = [
    { name: 'Pullback Quality', score: breakdown.pullbackQuality, max: 15 },
    { name: 'VWAP Interaction', score: breakdown.vwapInteraction, max: 20 },
    { name: 'EMA Alignment', score: breakdown.emaAlignment, max: 10 },
    { name: 'Liquidity Reaction', score: breakdown.liquidityReaction, max: 12 },
    { name: 'Compression/Expansion', score: breakdown.compressionExpansion, max: 10 },
    { name: 'Failed Move', score: breakdown.failedMoveConfirmation, max: 12 },
    { name: 'Timeframe Alignment', score: breakdown.timeframeAlignment, max: 8 }
  ];

  // Calculate entry zone metrics
  const inZone = currentPrice && activeIntent
    ? currentPrice >= activeIntent.entry_zone_min && currentPrice <= activeIntent.entry_zone_max
    : false;
  const distancePips = !inZone && currentPrice && activeIntent
    ? (currentPrice < activeIntent.entry_zone_min
        ? activeIntent.entry_zone_min - currentPrice
        : currentPrice - activeIntent.entry_zone_max)
    : 0;
  const isReady = latestEQS.status === 'EXECUTE_NOW' && latestEQS.eqs_score >= latestEQS.eqs_threshold;
  const gap = Math.max(0, latestEQS.eqs_threshold - latestEQS.eqs_score);

  return (
    <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg p-4 border border-gray-700">
      {/* HEADER: Symbol, Direction, Style, Frequency */}
      <div className="mb-4 pb-3 border-b border-gray-700">
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-2xl font-bold text-white">{activeIntent.symbol}</h2>
              <span className={`px-2 py-1 rounded text-sm font-bold ${
                activeIntent.direction === 'long'
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : 'bg-red-500/20 text-red-400 border border-red-500/30'
              }`}>
                {activeIntent.direction === 'long' ? 'LONG' : 'SHORT'}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span>{getStyleDisplayName(activeIntent.style)}</span>
              <span>•</span>
              <span>Checking every {getMonitoringFrequency(activeIntent.style)}</span>
              <span>•</span>
              <Target className="w-3 h-3 text-blue-400 animate-pulse" />
              <span className="text-blue-400">Monitoring</span>
            </div>
          </div>
          <div className={`px-3 py-1 rounded-lg border font-bold ${getGradeColor(latestEQS.eqs_grade)}`}>
            Grade {latestEQS.eqs_grade}
          </div>
        </div>
      </div>

      {/* DECISION SUMMARY: Why Not Executing */}
      <div className={`mb-4 p-3 rounded-lg border ${
        isReady && inZone
          ? 'bg-green-900/30 border-green-600/50'
          : isReady && !inZone
          ? 'bg-blue-900/30 border-blue-600/50'
          : 'bg-orange-900/30 border-orange-600/50'
      }`}>
        <div className="flex items-start gap-3">
          {isReady && inZone ? (
            <CheckCircle className="w-6 h-6 text-green-400 mt-0.5 flex-shrink-0 animate-pulse" />
          ) : isReady && !inZone ? (
            <MapPin className="w-6 h-6 text-blue-400 mt-0.5 flex-shrink-0 animate-pulse" />
          ) : (
            <Clock className="w-6 h-6 text-orange-400 mt-0.5 flex-shrink-0" />
          )}
          <div className="flex-1">
            <div className={`font-bold mb-1 ${
              isReady && inZone
                ? 'text-green-300 text-base'
                : isReady && !inZone
                ? 'text-blue-300 text-base'
                : 'text-orange-300 text-base'
            }`}>
              {isReady && inZone && 'READY TO EXECUTE'}
              {isReady && !inZone && 'WAITING FOR PRICE ZONE'}
              {!isReady && 'BUILDING ENTRY QUALITY'}
            </div>
            <div className="text-sm text-gray-300">
              {isReady && inZone && 'All conditions met. Execution ready.'}
              {isReady && !inZone && `Price must ${activeIntent.direction === 'long' ? 'pull back' : 'rally'} ${distancePips.toFixed(2)} pips into entry zone`}
              {!isReady && `EQS must reach ${latestEQS.eqs_threshold}/100 (currently ${latestEQS.eqs_score}/100) ${!inZone ? 'AND price must enter zone' : ''}`}
            </div>
          </div>
        </div>
      </div>

      {/* PRICE ZONE STATUS: Prominent display */}
      {activeIntent && currentPrice && (
        <div className={`mb-4 p-4 rounded-lg border-2 ${
          inZone
            ? 'bg-green-900/20 border-green-600 shadow-lg shadow-green-500/20'
            : 'bg-gray-900/20 border-gray-600'
        }`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <MapPin className={`w-5 h-5 ${inZone ? 'text-green-400 animate-pulse' : 'text-gray-400'}`} />
              <span className="text-sm font-semibold text-gray-300">Price Zone Status</span>
            </div>
            <span className={`px-3 py-1 rounded-lg text-sm font-bold ${
              inZone
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
            }`}>
              {inZone ? 'IN ZONE' : 'OUTSIDE'}
            </span>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Current Price</span>
              <div className="flex items-center gap-2">
                {getPriceDirectionIcon()}
                <span className={`text-lg font-mono font-bold ${
                  inZone ? 'text-green-400' : 'text-blue-400'
                }`}>
                  {currentPrice.toFixed(5)}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Entry Zone</span>
              <span className="text-sm font-mono text-gray-300">
                {activeIntent.entry_zone_min.toFixed(5)} - {activeIntent.entry_zone_max.toFixed(5)}
              </span>
            </div>

            {!inZone && (
              <div className="mt-2 pt-2 border-t border-gray-700">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">
                    {activeIntent.direction === 'long' ? 'Need pullback of' : 'Need rally of'}
                  </span>
                  <span className="text-base font-mono font-bold text-orange-400">
                    {distancePips.toFixed(2)} pips
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* EQS SCORE DISPLAY */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-400" />
            <span className="text-sm text-gray-400">Entry Quality Score</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-white">{latestEQS.eqs_score}</span>
            <span className="text-sm text-gray-400">/100</span>
          </div>
        </div>

        <div className="relative w-full h-3 bg-gray-700 rounded-full overflow-hidden">
          {/* Threshold marker */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-blue-400 z-10"
            style={{ left: `${thresholdPercentage}%` }}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 text-xs text-blue-400 whitespace-nowrap">
              ↓
            </div>
          </div>

          {/* Score bar */}
          <div
            className={`h-full transition-all duration-500 ${
              latestEQS.eqs_score >= latestEQS.eqs_threshold
                ? 'bg-gradient-to-r from-green-500 to-emerald-500'
                : 'bg-gradient-to-r from-red-500 to-orange-500'
            }`}
            style={{ width: `${scorePercentage}%` }}
          />
        </div>

        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-gray-500">
            {gap > 0 ? `${gap} points needed` : 'Threshold met!'}
          </span>
          <span className="text-xs text-blue-400">
            Threshold: {latestEQS.eqs_threshold}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Quality Breakdown
        </div>
        {metrics.map((metric) => (
          <div key={metric.name} className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-1">
              {getMetricIcon(metric.score, metric.max)}
              <span className="text-sm text-gray-300">{metric.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    metric.score / metric.max >= 0.8
                      ? 'bg-green-400'
                      : metric.score / metric.max >= 0.4
                      ? 'bg-yellow-400'
                      : 'bg-red-400'
                  }`}
                  style={{ width: `${(metric.score / metric.max) * 100}%` }}
                />
              </div>
              <span className={`text-sm font-mono font-semibold ${getMetricColor(metric.score, metric.max)} min-w-[3rem] text-right`}>
                {metric.score}/{metric.max}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-gray-700">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500">Last updated</span>
          <span className="text-gray-400">
            {new Date(latestEQS.created_at).toLocaleTimeString()}
          </span>
        </div>
      </div>
    </div>
  );
};
