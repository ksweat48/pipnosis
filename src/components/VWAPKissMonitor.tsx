import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Activity, TrendingUp, TrendingDown, Minus, RefreshCw, Zap } from 'lucide-react';

interface VWAPSignal {
  id: string;
  symbol: string;
  current_price: number;
  vwap_price: number;
  distance_percent: number;
  signal_strength: 'hot' | 'good' | 'watch';
  direction_bias: 'bullish' | 'bearish' | 'neutral';
  scalp_opportunity_score: number;
  entry_suggestion: number;
  exit_suggestion: number;
  reasoning: string;
  created_at: string;
  expires_at: string;
}

export const VWAPKissMonitor: React.FC = () => {
  const [signals, setSignals] = useState<VWAPSignal[]>([]);
  const [loading, setLoading] = useState(true);

  const deduplicateSignals = (rawSignals: VWAPSignal[]): VWAPSignal[] => {
    const signalMap = new Map<string, VWAPSignal>();

    for (const signal of rawSignals) {
      const existing = signalMap.get(signal.symbol);
      if (!existing || signal.scalp_opportunity_score > existing.scalp_opportunity_score) {
        signalMap.set(signal.symbol, signal);
      }
    }

    return Array.from(signalMap.values())
      .sort((a, b) => b.scalp_opportunity_score - a.scalp_opportunity_score)
      .slice(0, 3);
  };

  useEffect(() => {
    loadSignals();

    const interval = setInterval(loadSignals, 120000);

    const channel = supabase
      .channel('vwap-signals')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'vwap_kiss_signals',
        },
        () => {
          loadSignals();
        }
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, []);

  const loadSignals = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('vwap_kiss_signals')
        .select('*')
        .gt('expires_at', new Date().toISOString())
        .order('scalp_opportunity_score', { ascending: false })
        .limit(10);

      if (error) {
        console.error('[VWAPKissMonitor] Error loading signals:', error);
      } else {
        const uniqueSignals = deduplicateSignals(data || []);
        setSignals(uniqueSignals);
      }
    } catch (error) {
      console.error('[VWAPKissMonitor] Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const getSignalStrengthConfig = (strength: string) => {
    switch (strength) {
      case 'hot':
        return {
          icon: <Zap className="w-5 h-5 text-red-400" />,
          label: 'HOT',
          bgClass: 'bg-red-500/20',
          borderClass: 'border-red-500/50',
          textClass: 'text-red-400',
        };
      case 'good':
        return {
          icon: <Activity className="w-5 h-5 text-emerald-400" />,
          label: 'GOOD',
          bgClass: 'bg-emerald-500/20',
          borderClass: 'border-emerald-500/50',
          textClass: 'text-emerald-400',
        };
      case 'watch':
        return {
          icon: <Activity className="w-5 h-5 text-yellow-400" />,
          label: 'WATCH',
          bgClass: 'bg-yellow-500/20',
          borderClass: 'border-yellow-500/50',
          textClass: 'text-yellow-400',
        };
      default:
        return {
          icon: <Activity className="w-5 h-5 text-gray-400" />,
          label: 'NEUTRAL',
          bgClass: 'bg-gray-500/20',
          borderClass: 'border-gray-500/50',
          textClass: 'text-gray-400',
        };
    }
  };

  const getBiasIcon = (bias: string) => {
    switch (bias) {
      case 'bullish':
        return <TrendingUp className="w-4 h-4 text-emerald-400" />;
      case 'bearish':
        return <TrendingDown className="w-4 h-4 text-red-400" />;
      default:
        return <Minus className="w-4 h-4 text-gray-400" />;
    }
  };

  const formatPrice = (price: number, symbol: string): string => {
    if (symbol.includes('JPY')) return price.toFixed(3);
    if (symbol.includes('XAU') || symbol.includes('US30') || symbol.includes('SPX')) return price.toFixed(2);
    return price.toFixed(5);
  };

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-emerald-900/30 to-teal-900/30 rounded-xl p-6 border border-emerald-500/30">
        <div className="animate-pulse">
          <div className="h-6 bg-emerald-500/20 rounded w-1/2 mb-4" />
          <div className="h-4 bg-emerald-500/20 rounded w-3/4 mb-2" />
          <div className="h-4 bg-emerald-500/20 rounded w-2/3" />
        </div>
      </div>
    );
  }

  if (signals.length === 0) {
    return (
      <div className="bg-gradient-to-br from-gray-800/50 to-gray-900/50 rounded-xl p-6 border border-gray-700/50">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-gray-700/50 rounded-lg">
            <Activity className="w-6 h-6 text-gray-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-white mb-2">VWAP Kiss Detector</h3>
            <p className="text-sm text-gray-400">
              No VWAP kiss signals detected. The scanner will automatically detect when prices are near VWAP for quick scalp opportunities.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative group">
      <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-xl opacity-20 group-hover:opacity-30 transition duration-300 blur" />

      <div className="relative bg-gradient-to-br from-emerald-900/40 to-teal-900/40 rounded-xl p-6 border border-emerald-500/50">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-500/20 rounded-lg">
              <Activity className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">VWAP Kiss Detector</h3>
              <p className="text-sm text-emerald-300">Top {signals.length} {signals.length === 1 ? 'Pair' : 'Pairs'}</p>
            </div>
          </div>

          <button
            onClick={loadSignals}
            className="p-2 hover:bg-emerald-500/20 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4 text-emerald-300" />
          </button>
        </div>

        <div className="space-y-3 mb-4">
          {signals.map((signal) => {
            const strengthConfig = getSignalStrengthConfig(signal.signal_strength);

            return (
              <div
                key={signal.id}
                className={`bg-gray-900/50 rounded-lg p-4 border ${strengthConfig.borderClass} hover:border-emerald-500/50 transition-colors`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${strengthConfig.bgClass}`}>
                      {strengthConfig.icon}
                    </div>
                    <div>
                      <p className="text-base font-bold text-white">{signal.symbol}</p>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-semibold ${strengthConfig.textClass}`}>
                          {strengthConfig.label}
                        </span>
                        <span className="text-xs text-gray-400">•</span>
                        <div className="flex items-center gap-1">
                          {getBiasIcon(signal.direction_bias)}
                          <span className="text-xs text-gray-400 capitalize">{signal.direction_bias}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="text-xs text-gray-400">Score</p>
                    <p className={`text-lg font-bold ${strengthConfig.textClass}`}>
                      {signal.scalp_opportunity_score}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="bg-gray-800/50 rounded-lg p-2">
                    <p className="text-xs text-gray-400">Current</p>
                    <p className="text-sm font-mono text-white">
                      {formatPrice(signal.current_price, signal.symbol)}
                    </p>
                  </div>
                  <div className="bg-blue-900/30 rounded-lg p-2">
                    <p className="text-xs text-blue-300">VWAP</p>
                    <p className="text-sm font-mono text-blue-300">
                      {formatPrice(signal.vwap_price, signal.symbol)}
                    </p>
                  </div>
                  <div className={`rounded-lg p-2 ${strengthConfig.bgClass}`}>
                    <p className={`text-xs ${strengthConfig.textClass}`}>Distance</p>
                    <p className={`text-sm font-bold ${strengthConfig.textClass}`}>
                      {signal.distance_percent.toFixed(2)}%
                    </p>
                  </div>
                </div>

                <div className="bg-emerald-900/20 rounded-lg p-3 border border-emerald-500/20">
                  <p className="text-xs font-semibold text-emerald-300 mb-1">Entry / Exit Suggestion</p>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-emerald-100">
                      Entry: <span className="font-mono">{formatPrice(signal.entry_suggestion, signal.symbol)}</span>
                    </p>
                    <span className="text-emerald-400">→</span>
                    <p className="text-sm text-emerald-100">
                      Exit: <span className="font-mono">{formatPrice(signal.exit_suggestion, signal.symbol)}</span>
                    </p>
                  </div>
                </div>

                <p className="text-xs text-gray-300 mt-2">{signal.reasoning}</p>
              </div>
            );
          })}
        </div>

        <div className="bg-emerald-900/20 rounded-lg p-3 border border-emerald-500/20">
          <p className="text-xs text-emerald-200">
            VWAP (Volume Weighted Average Price) acts as a magnetic price level. When price "kisses" VWAP, quick scalp opportunities often appear. Calculated on M5 timeframe.
          </p>
        </div>

        <div className="mt-4 text-xs text-gray-500 text-center">
          Advisory only - Does not affect Alpha's autonomous trading
        </div>
      </div>
    </div>
  );
};
