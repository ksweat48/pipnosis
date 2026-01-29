import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Clock, TrendingUp, BarChart3, AlertTriangle, RefreshCw, Sun, Moon, Sunrise } from 'lucide-react';

interface BestPair {
  symbol: string;
  confidence: number;
  tradeConfidence?: number;
  reasoning: string;
  indicatorAlignment?: {
    vwap: boolean;
    ema20: boolean;
    ema50: boolean;
    rsi: boolean;
    volumePressure: boolean;
    candlePattern: boolean;
    structure: boolean;
    momentum: boolean;
  };
  lastCalculated?: string;
}

interface SessionData {
  id: string;
  session_name: 'London' | 'New York' | 'Asian';
  session_start_hour: number;
  session_end_hour: number;
  best_pairs: BestPair[];
  market_condition: string;
  is_tradable: boolean;
  recommendation_text: string;
  created_at: string;
  expires_at: string;
}

export const SessionIntelligenceMonitor: React.FC = () => {
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSessionData();

    const interval = setInterval(loadSessionData, 180000);

    const channel = supabase
      .channel('session-intelligence')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'session_intelligence_data',
        },
        (payload) => {
          setSessionData(payload.new as SessionData);
        }
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, []);

  const loadSessionData = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('session_intelligence_data')
        .select('*')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[SessionIntelligenceMonitor] Error loading session data:', error);
      } else {
        setSessionData(data);
      }
    } catch (error) {
      console.error('[SessionIntelligenceMonitor] Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const getSessionIcon = (sessionName: string) => {
    switch (sessionName) {
      case 'London':
        return <Sun className="w-6 h-6 text-yellow-400" />;
      case 'New York':
        return <Sunrise className="w-6 h-6 text-orange-400" />;
      case 'Asian':
        return <Moon className="w-6 h-6 text-blue-400" />;
      default:
        return <Clock className="w-6 h-6 text-gray-400" />;
    }
  };

  const getConditionColor = (condition: string) => {
    switch (condition) {
      case 'trending':
        return 'text-emerald-400 bg-emerald-500/20 border-emerald-500/30';
      case 'volatile':
        return 'text-orange-400 bg-orange-500/20 border-orange-500/30';
      case 'ranging':
        return 'text-blue-400 bg-blue-500/20 border-blue-500/30';
      case 'quiet':
      case 'sideways':
        return 'text-gray-400 bg-gray-500/20 border-gray-500/30';
      default:
        return 'text-gray-400 bg-gray-500/20 border-gray-500/30';
    }
  };

  const getTradeConfidenceColor = (confidence: number | undefined): { bg: string; text: string; label: string } => {
    const conf = confidence ?? 0;
    if (conf >= 80) {
      return {
        bg: 'bg-green-500/20 border-green-500/50',
        text: 'text-green-400',
        label: 'High Probability'
      };
    } else if (conf >= 70) {
      return {
        bg: 'bg-yellow-500/20 border-yellow-500/50',
        text: 'text-yellow-400',
        label: 'Good Probability'
      };
    } else if (conf >= 60) {
      return {
        bg: 'bg-orange-500/20 border-orange-500/50',
        text: 'text-orange-400',
        label: 'Average Probability'
      };
    } else {
      return {
        bg: 'bg-gray-500/20 border-gray-500/50',
        text: 'text-gray-400',
        label: 'Low Probability'
      };
    }
  };

  const getIndicatorCount = (alignment?: BestPair['indicatorAlignment']): { aligned: number; total: number } => {
    if (!alignment) return { aligned: 0, total: 0 };
    const aligned = Object.values(alignment).filter(v => v).length;
    return { aligned, total: Object.keys(alignment).length };
  };

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-blue-900/30 to-slate-900/30 rounded-xl p-6 border border-blue-500/30">
        <div className="animate-pulse">
          <div className="h-6 bg-blue-500/20 rounded w-1/2 mb-4" />
          <div className="h-4 bg-blue-500/20 rounded w-3/4 mb-2" />
          <div className="h-4 bg-blue-500/20 rounded w-2/3" />
        </div>
      </div>
    );
  }

  if (!sessionData) {
    return (
      <div className="bg-gradient-to-br from-gray-800/50 to-gray-900/50 rounded-xl p-6 border border-gray-700/50">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-gray-700/50 rounded-lg">
            <Clock className="w-6 h-6 text-gray-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-white mb-2">Real-Time Intelligence</h3>
            <p className="text-sm text-gray-400">
              Real-time probability analysis will appear here shortly. This monitor shows which pairs have ≥70% indicator alignment RIGHT NOW.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative group">
      <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-xl opacity-20 group-hover:opacity-30 transition duration-300 blur" />

      <div className="relative bg-gradient-to-br from-slate-900/50 to-blue-900/40 rounded-xl p-6 border border-blue-500/50">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-500/20 rounded-lg">
              {getSessionIcon(sessionData.session_name)}
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Real-Time Intelligence</h3>
              <p className="text-sm text-blue-300">
                Updated every 3 minutes • Last: {new Date(sessionData.created_at).toLocaleTimeString()}
              </p>
            </div>
          </div>

          <button
            onClick={loadSessionData}
            className="p-2 hover:bg-blue-500/20 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4 text-blue-300" />
          </button>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <div className={`px-3 py-1.5 rounded-lg border ${getConditionColor(sessionData.market_condition)}`}>
            <p className="text-sm font-semibold capitalize">{sessionData.market_condition}</p>
          </div>

          {sessionData.is_tradable ? (
            <div className="px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/20">
              <p className="text-sm font-semibold text-emerald-400">Tradable</p>
            </div>
          ) : (
            <div className="px-3 py-1.5 rounded-lg border border-red-500/30 bg-red-500/20">
              <p className="text-sm font-semibold text-red-400">No Clear Setups</p>
            </div>
          )}
        </div>

        {sessionData.is_tradable && sessionData.best_pairs.length > 0 ? (
          <div className="space-y-3 mb-4">
            <p className="text-sm font-semibold text-blue-200">Highest Probability Right Now (≥70%):</p>
            {sessionData.best_pairs.slice(0, 3).map((pair, index) => {
              const tradeConfidence = pair.tradeConfidence ?? pair.confidence;
              const confidenceColor = getTradeConfidenceColor(tradeConfidence);
              const indicatorCount = getIndicatorCount(pair.indicatorAlignment);

              return (
                <div
                  key={pair.symbol}
                  className="bg-gray-900/50 rounded-lg p-4 border border-gray-700/50 hover:border-purple-500/30 transition-colors"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3 flex-1">
                      <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                        <span className="text-sm font-bold text-blue-300">{index + 1}</span>
                      </div>
                      <div>
                        <p className="text-base font-bold text-white">{pair.symbol}</p>
                        <p className="text-xs text-gray-400">Real-time probability: {pair.confidence}%</p>
                      </div>
                    </div>
                  </div>

                  <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border ${confidenceColor.bg} mb-3`}>
                    <BarChart3 className={`w-4 h-4 ${confidenceColor.text}`} />
                    <div>
                      <p className={`text-sm font-bold ${confidenceColor.text}`}>{tradeConfidence}%</p>
                      <p className={`text-xs ${confidenceColor.text} opacity-75`}>{confidenceColor.label}</p>
                    </div>
                  </div>

                  {indicatorCount.total > 0 && (
                    <div className="mb-3 p-2 bg-gray-800/50 rounded border border-gray-700/30">
                      <p className="text-xs text-gray-400 mb-1">Indicator alignment: {indicatorCount.aligned}/{indicatorCount.total}</p>
                      <div className="text-xs text-gray-500 space-y-0.5">
                        {pair.indicatorAlignment && (
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(pair.indicatorAlignment).map(([key, aligned]) => (
                              <span
                                key={key}
                                className={`px-1.5 py-0.5 rounded ${aligned ? 'bg-green-500/20 text-green-400' : 'bg-gray-600/20 text-gray-500'}`}
                              >
                                {key === 'volumePressure' ? 'Volume' : key === 'candlePattern' ? 'Pattern' : key.charAt(0).toUpperCase() + key.slice(1)}
                                {aligned ? ' ✓' : ''}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <p className="text-sm text-gray-300">{pair.reasoning}</p>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-orange-900/20 rounded-lg p-4 border border-orange-500/30 mb-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-orange-300 mb-1">Market Trading Sideways</p>
                <p className="text-sm text-orange-200/80">{sessionData.recommendation_text}</p>
              </div>
            </div>
          </div>
        )}

        <div className="bg-blue-900/20 rounded-lg p-4 border border-blue-500/20">
          <p className="text-sm text-blue-100">{sessionData.recommendation_text}</p>
        </div>

        <div className="mt-4 text-xs text-gray-500 text-center">
          Advisory only - Does not affect Alpha's autonomous trading
        </div>
      </div>
    </div>
  );
};
