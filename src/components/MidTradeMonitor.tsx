import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Activity,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Shield,
  AlertTriangle,
  CheckCircle,
  Target,
  Clock,
  DollarSign
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { midTradeMonitorService, type MidTradeGuidance } from '@/services/mid-trade-monitor-service';

export const MidTradeMonitor: React.FC = () => {
  const { user } = useAuth();
  const [guidance, setGuidance] = useState<MidTradeGuidance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (user) {
      loadGuidance();

      // Real-time subscription to trade updates
      const channel = supabase
        .channel('mid-trade-updates')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'goal_session_trades',
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            loadGuidance();
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'realtime_prices',
          },
          () => {
            // Refresh guidance when new prices arrive
            if (!refreshing) {
              loadGuidance();
            }
          }
        )
        .subscribe();

      // Poll every second for active trades (smooth P&L updates)
      const pollInterval = setInterval(() => {
        if (!refreshing && guidance.length > 0) {
          loadGuidance();
        }
      }, 1000);

      return () => {
        supabase.removeChannel(channel);
        clearInterval(pollInterval);
      };
    }
  }, [user, guidance.length]);

  const loadGuidance = async () => {
    if (!user) return;

    try {
      if (!loading) {
        setRefreshing(true);
      }

      const result = await midTradeMonitorService.getMidTradeGuidance(user.id);
      setGuidance(result.guidance);
    } catch (error) {
      console.error('[MidTradeMonitor] Error loading guidance:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const formatPrice = (price: number, symbol: string): string => {
    if (symbol.includes('JPY')) return price.toFixed(3);
    if (symbol.includes('XAU') || symbol.includes('US30') || symbol.includes('SPX')) return price.toFixed(2);
    if (symbol.includes('BTC') || symbol.includes('ETH')) return price.toFixed(2);
    return price.toFixed(5);
  };

  const getActionIcon = (action: MidTradeGuidance['primaryAction']) => {
    switch (action) {
      case 'trail_sl':
        return <Shield className="w-5 h-5" />;
      case 'warning':
      case 'risk_alert':
        return <AlertTriangle className="w-5 h-5" />;
      case 'tp1_timing':
        return <Target className="w-5 h-5" />;
      case 'hold':
      default:
        return <CheckCircle className="w-5 h-5" />;
    }
  };

  const getColorClasses = (color: MidTradeGuidance['actionColor']) => {
    switch (color) {
      case 'emerald':
        return {
          bg: 'bg-emerald-500/20',
          text: 'text-emerald-400',
          border: 'border-emerald-500/30'
        };
      case 'amber':
        return {
          bg: 'bg-amber-500/20',
          text: 'text-amber-400',
          border: 'border-amber-500/30'
        };
      case 'red':
        return {
          bg: 'bg-red-500/20',
          text: 'text-red-400',
          border: 'border-red-500/30'
        };
      case 'orange':
        return {
          bg: 'bg-orange-500/20',
          text: 'text-orange-400',
          border: 'border-orange-500/30'
        };
      case 'blue':
      default:
        return {
          bg: 'bg-blue-500/20',
          text: 'text-blue-400',
          border: 'border-blue-500/30'
        };
    }
  };

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-amber-900/30 to-orange-900/30 rounded-xl p-6 border border-amber-500/30">
        <div className="animate-pulse">
          <div className="h-6 bg-amber-500/20 rounded w-1/2 mb-4" />
          <div className="h-4 bg-amber-500/20 rounded w-3/4 mb-2" />
          <div className="h-4 bg-amber-500/20 rounded w-2/3" />
        </div>
      </div>
    );
  }

  if (guidance.length === 0) {
    return (
      <div className="bg-gradient-to-br from-gray-800/50 to-gray-900/50 rounded-xl p-6 border border-gray-700/50">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-gray-700/50 rounded-lg">
            <Activity className="w-6 h-6 text-gray-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-white mb-2">Mid-Trade Intelligence</h3>
            <p className="text-sm text-gray-400">
              No active trades. Mid-trade guidance appears when Alpha executes positions, providing real-time
              recommendations for trail stops, risk alerts, and optimal exit timing.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative group">
      <div className="absolute -inset-0.5 bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl opacity-20 group-hover:opacity-30 transition duration-300 blur" />

      <div className="relative bg-gradient-to-br from-amber-900/40 to-orange-900/40 rounded-xl p-6 border border-amber-500/50">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-500/20 rounded-lg">
              <Activity className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Mid-Trade Intelligence</h3>
              <p className="text-sm text-amber-300">
                {guidance.length} active trade{guidance.length !== 1 ? 's' : ''} monitored
              </p>
            </div>
          </div>

          <button
            onClick={() => loadGuidance()}
            className="p-2 hover:bg-amber-500/20 rounded-lg transition-colors"
            title="Refresh"
            disabled={refreshing}
          >
            <RefreshCw className={`w-4 h-4 text-amber-300 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Trade Cards */}
        <div className="space-y-3">
          {guidance.map((guide) => {
            const colors = getColorClasses(guide.actionColor);
            const isProfitable = guide.currentPnL >= 0;

            return (
              <div
                key={guide.tradeId}
                className="bg-gray-900/50 rounded-lg p-4 border border-gray-700/50"
              >
                {/* Trade Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${guide.direction === 'buy' ? 'bg-emerald-500/20' : 'bg-red-500/20'}`}>
                      {guide.direction === 'buy' ? (
                        <TrendingUp className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <TrendingDown className="w-5 h-5 text-red-400" />
                      )}
                    </div>
                    <div>
                      <h4 className="text-base font-bold text-white">{guide.symbol}</h4>
                      <p className="text-xs text-gray-400 capitalize">{guide.direction}</p>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className={`text-lg font-bold font-mono ${isProfitable ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isProfitable ? '+' : ''}${guide.currentPnL.toFixed(2)}
                    </p>
                    <p className="text-xs text-gray-400">Current P&L</p>
                  </div>
                </div>

                {/* Primary Guidance */}
                <div className={`${colors.bg} rounded-lg p-3 border ${colors.border} mb-3`}>
                  <div className="flex items-start gap-2">
                    <div className={colors.text}>
                      {getActionIcon(guide.primaryAction)}
                    </div>
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${colors.text}`}>
                        {guide.primaryMessage}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="bg-gray-800/50 rounded-lg p-2">
                    <p className="text-xs text-gray-400 mb-1">Entry Price</p>
                    <p className="text-sm font-mono text-white">
                      {formatPrice(guide.entryPrice, guide.symbol)}
                    </p>
                  </div>

                  <div className="bg-gray-800/50 rounded-lg p-2">
                    <p className="text-xs text-gray-400 mb-1">Current Price</p>
                    <p className="text-sm font-mono text-white">
                      {formatPrice(guide.currentPrice, guide.symbol)}
                    </p>
                  </div>

                  <div className="bg-gray-800/50 rounded-lg p-2">
                    <p className="text-xs text-gray-400 mb-1">Distance to SL</p>
                    <p className="text-sm font-mono text-white">
                      {guide.distanceToSL.toFixed(1)} pips
                    </p>
                  </div>

                  <div className="bg-gray-800/50 rounded-lg p-2">
                    <p className="text-xs text-gray-400 mb-1">Time in Trade</p>
                    <p className="text-sm font-mono text-white flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {guide.timeInTrade < 60
                        ? `${Math.floor(guide.timeInTrade)} min`
                        : `${Math.floor(guide.timeInTrade / 60)}h ${Math.floor(guide.timeInTrade % 60)}m`
                      }
                    </p>
                  </div>
                </div>

                {/* AI Recommendation (if available) */}
                {guide.aiRecommendation && (
                  <div className="bg-blue-900/20 rounded-lg p-3 border border-blue-500/20">
                    <div className="flex items-start gap-2">
                      <Activity className="w-4 h-4 text-blue-300 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-xs text-blue-300 mb-1">
                          Alpha Intelligence {guide.aiConfidence && `(${guide.aiConfidence}% confidence)`}
                        </p>
                        <p className="text-sm text-blue-100">
                          {guide.aiRecommendation.substring(0, 150)}
                          {guide.aiRecommendation.length > 150 ? '...' : ''}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 text-xs text-gray-500 text-center">
          Advisory only - All trade closures require user confirmation
        </div>
      </div>
    </div>
  );
};
