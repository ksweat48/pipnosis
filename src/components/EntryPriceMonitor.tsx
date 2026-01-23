import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { TrendingUp, TrendingDown, Target, AlertCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

interface EntryRecommendation {
  id: string;
  symbol: string;
  direction: 'buy' | 'sell';
  alpha_entry_price: number;
  optimal_entry_price: number;
  pullback_zone_low: number;
  pullback_zone_high: number;
  pattern_type: string;
  confidence_score: number;
  reasoning: string;
  created_at: string;
}

export const EntryPriceMonitor: React.FC = () => {
  const { user } = useAuth();
  const [recommendation, setRecommendation] = useState<EntryRecommendation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadRecommendation();

      const channel = supabase
        .channel('entry-recommendations')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'entry_price_recommendations',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            setRecommendation(payload.new as EntryRecommendation);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user]);

  const loadRecommendation = async () => {
    if (!user) return;

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('entry_price_recommendations')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[EntryPriceMonitor] Error loading recommendation:', error);
      } else {
        setRecommendation(data);
      }
    } catch (error) {
      console.error('[EntryPriceMonitor] Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatPrice = (price: number, symbol: string): string => {
    if (symbol.includes('JPY')) return price.toFixed(3);
    if (symbol.includes('XAU') || symbol.includes('US30') || symbol.includes('SPX')) return price.toFixed(2);
    return price.toFixed(5);
  };

  if (loading) {
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

  if (!recommendation) {
    return (
      <div className="bg-gradient-to-br from-gray-800/50 to-gray-900/50 rounded-xl p-6 border border-gray-700/50">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-gray-700/50 rounded-lg">
            <Target className="w-6 h-6 text-gray-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-white mb-2">Entry Price Monitor</h3>
            <p className="text-sm text-gray-400">
              Waiting for Alpha to execute a trade. Once Alpha enters, this monitor will show you optimal entry prices
              for manual trading on your external account.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isBuy = recommendation.direction === 'buy';
  const priceImprovement = Math.abs(recommendation.alpha_entry_price - recommendation.optimal_entry_price);
  const improvementPercent = (priceImprovement / recommendation.alpha_entry_price) * 100;

  return (
    <div className="relative group">
      <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-xl opacity-20 group-hover:opacity-30 transition duration-300 blur" />

      <div className="relative bg-gradient-to-br from-blue-900/40 to-cyan-900/40 rounded-xl p-6 border border-blue-500/50">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-lg ${isBuy ? 'bg-emerald-500/20' : 'bg-red-500/20'}`}>
              {isBuy ? (
                <TrendingUp className="w-6 h-6 text-emerald-400" />
              ) : (
                <TrendingDown className="w-6 h-6 text-red-400" />
              )}
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Entry Price Monitor</h3>
              <p className="text-sm text-cyan-300">{recommendation.symbol} {recommendation.direction.toUpperCase()}</p>
            </div>
          </div>

          <button
            onClick={loadRecommendation}
            className="p-2 hover:bg-blue-500/20 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4 text-blue-300" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700/50">
            <p className="text-xs text-gray-400 mb-1">Alpha's Entry</p>
            <p className="text-xl font-bold text-white font-mono">
              {formatPrice(recommendation.alpha_entry_price, recommendation.symbol)}
            </p>
          </div>

          <div className="bg-gradient-to-br from-emerald-900/30 to-green-900/30 rounded-lg p-4 border border-emerald-500/50">
            <p className="text-xs text-emerald-300 mb-1">Optimal Entry</p>
            <p className="text-xl font-bold text-emerald-400 font-mono">
              {formatPrice(recommendation.optimal_entry_price, recommendation.symbol)}
            </p>
            <p className="text-xs text-emerald-300 mt-1">
              {improvementPercent.toFixed(2)}% better risk/reward
            </p>
          </div>

          <div className="bg-blue-900/30 rounded-lg p-4 border border-blue-500/30">
            <p className="text-xs text-blue-300 mb-1">Confidence</p>
            <div className="flex items-baseline gap-2">
              <p className="text-xl font-bold text-blue-400">{recommendation.confidence_score}%</p>
              <p className="text-xs text-blue-300 capitalize">{recommendation.pattern_type.replace(/_/g, ' ')}</p>
            </div>
          </div>
        </div>

        <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700/50 mb-4">
          <p className="text-sm font-semibold text-gray-300 mb-2">Pullback Zone</p>
          <div className="flex items-center gap-3">
            <div>
              <p className="text-xs text-gray-400">Low</p>
              <p className="text-sm font-mono text-white">
                {formatPrice(recommendation.pullback_zone_low, recommendation.symbol)}
              </p>
            </div>
            <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden relative">
              <div className="absolute inset-0 bg-gradient-to-r from-emerald-500 via-yellow-500 to-red-500 opacity-50" />
            </div>
            <div>
              <p className="text-xs text-gray-400">High</p>
              <p className="text-sm font-mono text-white">
                {formatPrice(recommendation.pullback_zone_high, recommendation.symbol)}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-blue-900/20 rounded-lg p-4 border border-blue-500/20">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-blue-300 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-blue-100">{recommendation.reasoning}</p>
          </div>
        </div>

        <div className="mt-4 text-xs text-gray-500 text-center">
          Advisory only - Does not affect Alpha's autonomous trading
        </div>
      </div>
    </div>
  );
};
