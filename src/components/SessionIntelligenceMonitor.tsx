import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Clock, TrendingUp, BarChart3, AlertTriangle, RefreshCw, Sun, Moon, Sunrise } from 'lucide-react';

interface BestPair {
  symbol: string;
  confidence: number;
  reasoning: string;
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

    const interval = setInterval(loadSessionData, 300000);

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

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-purple-900/30 to-indigo-900/30 rounded-xl p-6 border border-purple-500/30">
        <div className="animate-pulse">
          <div className="h-6 bg-purple-500/20 rounded w-1/2 mb-4" />
          <div className="h-4 bg-purple-500/20 rounded w-3/4 mb-2" />
          <div className="h-4 bg-purple-500/20 rounded w-2/3" />
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
            <h3 className="text-lg font-bold text-white mb-2">Session Intelligence</h3>
            <p className="text-sm text-gray-400">
              Session analysis will appear here shortly. This monitor shows which pairs are best for the current trading session.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative group">
      <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-xl opacity-20 group-hover:opacity-30 transition duration-300 blur" />

      <div className="relative bg-gradient-to-br from-purple-900/40 to-indigo-900/40 rounded-xl p-6 border border-purple-500/50">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-500/20 rounded-lg">
              {getSessionIcon(sessionData.session_name)}
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Session Intelligence</h3>
              <p className="text-sm text-purple-300">
                {sessionData.session_name} Session • {sessionData.session_start_hour}:00 - {sessionData.session_end_hour}:00 EST
              </p>
            </div>
          </div>

          <button
            onClick={loadSessionData}
            className="p-2 hover:bg-purple-500/20 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4 text-purple-300" />
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
            <p className="text-sm font-semibold text-purple-200">Best Pairs for This Session:</p>
            {sessionData.best_pairs.slice(0, 3).map((pair, index) => (
              <div
                key={pair.symbol}
                className="bg-gray-900/50 rounded-lg p-4 border border-gray-700/50 hover:border-purple-500/30 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
                      <span className="text-sm font-bold text-purple-300">{index + 1}</span>
                    </div>
                    <div>
                      <p className="text-base font-bold text-white">{pair.symbol}</p>
                      <p className="text-xs text-gray-400">{pair.confidence}% confidence</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <BarChart3 className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-semibold text-emerald-400">{pair.confidence}%</span>
                  </div>
                </div>
                <p className="text-sm text-gray-300">{pair.reasoning}</p>
              </div>
            ))}
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

        <div className="bg-purple-900/20 rounded-lg p-4 border border-purple-500/20">
          <p className="text-sm text-purple-100">{sessionData.recommendation_text}</p>
        </div>

        <div className="mt-4 text-xs text-gray-500 text-center">
          Advisory only - Does not affect Alpha's autonomous trading
        </div>
      </div>
    </div>
  );
};
