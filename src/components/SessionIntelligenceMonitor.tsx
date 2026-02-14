import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Clock, TrendingUp, BarChart3, AlertTriangle, RefreshCw, Sun, Moon, Sunrise } from 'lucide-react';

interface BestPair {
  symbol: string;
  confidence: number;
  tradeConfidence?: number;
  alignedIndicators?: number;
  totalIndicators?: number;
  status?: 'ready' | 'heating' | 'monitoring';
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
  top_pairs?: BestPair[];
  all_pair_scores?: BestPair[];
  heating_pairs?: BestPair[];
  market_condition: string;
  is_tradable: boolean;
  recommendation_text: string;
  created_at: string;
  expires_at: string;
}

export const SessionIntelligenceMonitor: React.FC = () => {
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const triggerIntelligenceUpdate = useCallback(async (): Promise<boolean> => {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !anonKey) return false;

      const apiUrl = `${supabaseUrl}/functions/v1/update-session-intelligence`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${anonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({})
      });

      return response.ok;
    } catch (error) {
      console.debug('[SessionIntelligenceMonitor] Edge function unavailable:', error);
      return false;
    }
  }, []);

  const loadSessionData = useCallback(async (allowExpired = false) => {
    try {
      let query = supabase
        .from('session_intelligence_data')
        .select('id, session_name, session_start_hour, session_end_hour, best_pairs, top_pairs, all_pair_scores, heating_pairs, market_condition, is_tradable, recommendation_text, created_at, expires_at')
        .order('created_at', { ascending: false })
        .limit(1);

      if (!allowExpired) {
        query = query.gt('expires_at', new Date().toISOString());
      }

      const { data, error } = await query.maybeSingle();

      if (error) {
        console.error('[SessionIntelligenceMonitor] Error loading session data:', error);
        return;
      }

      if (data) {
        setSessionData(data);
      } else if (!allowExpired) {
        await loadSessionData(true);
        return;
      }
    } catch (error) {
      console.error('[SessionIntelligenceMonitor] Error:', error);
    }
  }, []);

  const handleManualRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await triggerIntelligenceUpdate();
      await new Promise(resolve => setTimeout(resolve, 1500));
      await loadSessionData();
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, triggerIntelligenceUpdate, loadSessionData]);

  useEffect(() => {
    const init = async () => {
      await loadSessionData();
      setLoading(false);
      triggerIntelligenceUpdate().catch(() => {});
    };
    init();

    let refreshTimer: ReturnType<typeof setInterval>;

    const channel = supabase
      .channel('session-intelligence')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'session_intelligence_data',
        },
        (payload) => {
          if (payload.new && typeof payload.new === 'object' && 'id' in payload.new) {
            setSessionData(payload.new as SessionData);
          }
        }
      )
      .subscribe();

    refreshTimer = setInterval(() => {
      loadSessionData();
    }, 120000);

    return () => {
      clearInterval(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [loadSessionData, triggerIntelligenceUpdate]);

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
    } else if (conf >= 50) {
      return {
        bg: 'bg-blue-500/20 border-blue-500/50',
        text: 'text-blue-400',
        label: 'Heating Up'
      };
    } else {
      return {
        bg: 'bg-gray-500/20 border-gray-500/50',
        text: 'text-gray-400',
        label: 'Monitoring'
      };
    }
  };

  const getStatusBadgeColor = (status?: string): { bg: string; text: string; label: string } => {
    switch (status) {
      case 'ready':
        return {
          bg: 'bg-green-500/20 border-green-500/50',
          text: 'text-green-400',
          label: 'Ready to Trade'
        };
      case 'heating':
        return {
          bg: 'bg-amber-500/20 border-amber-500/50',
          text: 'text-amber-400',
          label: 'Heating Up'
        };
      default:
        return {
          bg: 'bg-slate-500/20 border-slate-500/50',
          text: 'text-slate-400',
          label: 'Monitoring'
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
      <div className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 rounded-xl p-6 border border-slate-700/50">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-slate-700/50 rounded-lg">
            <Clock className="w-6 h-6 text-slate-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-white mb-2">Real-Time Intelligence</h3>
            <p className="text-sm text-slate-400 mb-2">
              Real-time probability analysis will appear here shortly.
            </p>
            <p className="text-xs text-slate-500">
              We analyze all watchlist pairs and show you the top 3. Ready to trade pairs show ≥70% indicator alignment. Heating up pairs are 50-70% and warming toward entry signals.
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
                Updated every 10 minutes • Last: {new Date(sessionData.created_at).toLocaleTimeString()}
              </p>
            </div>
          </div>

          <button
            onClick={handleManualRefresh}
            disabled={refreshing}
            className="p-2 hover:bg-blue-500/20 rounded-lg transition-colors disabled:opacity-50"
            title="Refresh intelligence"
          >
            <RefreshCw className={`w-4 h-4 text-blue-300 ${refreshing ? 'animate-spin' : ''}`} />
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

        {sessionData.top_pairs && sessionData.top_pairs.length > 0 ? (
          <div className="space-y-3 mb-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-blue-200">
                {sessionData.is_tradable ? 'Ready to Trade Right Now' : 'Top Market Opportunities'}
              </p>
              <p className="text-xs text-gray-400">
                {sessionData.is_tradable ? 'Showing pairs ≥70% confidence' : 'Waiting for 70%+ alignment'}
              </p>
            </div>
            {sessionData.top_pairs.slice(0, 3).map((pair, index) => {
              const tradeConfidence = pair.tradeConfidence ?? pair.confidence;
              const confidenceColor = getStatusBadgeColor(pair.status);
              const indicatorCount = getIndicatorCount(pair.indicatorAlignment);
              const isReady = pair.status === 'ready';

              return (
                <div
                  key={pair.symbol}
                  className={`rounded-lg p-4 border transition-colors ${
                    isReady
                      ? 'bg-green-900/10 border-green-500/30 hover:border-green-500/50'
                      : 'bg-gray-900/50 border-gray-700/50 hover:border-amber-500/30'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3 flex-1">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isReady ? 'bg-green-500/20' : 'bg-blue-500/20'}`}>
                        <span className={`text-sm font-bold ${isReady ? 'text-green-300' : 'text-blue-300'}`}>{index + 1}</span>
                      </div>
                      <div>
                        <p className="text-base font-bold text-white">{pair.symbol}</p>
                        <p className="text-xs text-gray-400">Probability: {pair.confidence}%</p>
                      </div>
                    </div>

                    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${confidenceColor.bg} flex-shrink-0 ml-4`}>
                      <BarChart3 className={`w-4 h-4 ${confidenceColor.text}`} />
                      <div>
                        <p className={`text-sm font-bold ${confidenceColor.text}`}>{tradeConfidence}%</p>
                        <p className={`text-xs ${confidenceColor.text} opacity-75`}>{confidenceColor.label}</p>
                      </div>
                    </div>
                  </div>

                  {pair.alignedIndicators !== undefined && pair.totalIndicators !== undefined && (
                    <div className="mb-3 p-2 bg-gray-800/50 rounded border border-gray-700/30">
                      <p className="text-xs text-gray-400 mb-1">Indicator alignment: {pair.alignedIndicators}/{pair.totalIndicators}</p>
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
          <div className="bg-blue-900/20 rounded-lg p-4 border border-blue-500/30 mb-4">
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-blue-300 mb-1">Analyzing Markets</p>
                <p className="text-sm text-blue-200/80">Real-time probability analysis in progress. Waiting for strong setups with ≥70% indicator alignment.</p>
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
