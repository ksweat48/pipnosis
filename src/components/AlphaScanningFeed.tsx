import React, { useState, useEffect } from 'react';
import { Brain, Target, CheckCircle, Search, Users, BarChart3, Award, Zap } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface AlphaThought {
  id: string;
  session_id: string;
  step_type: string;
  step_number: number;
  message: string;
  metadata: any;
  created_at: string;
  is_active_scan: boolean;
}

interface AlphaScanningFeedProps {
  sessionId: string;
  hasActiveTrades?: boolean;
  isScanning?: boolean; // Current scanning status
  activePairsCount?: number; // Number of pairs being scanned (from database)
  totalPairs?: number; // Total pairs in watchlist
  watchlist?: string[]; // List of symbols being scanned
}

export const AlphaScanningFeed: React.FC<AlphaScanningFeedProps> = ({
  sessionId,
  hasActiveTrades = false,
  isScanning: externalIsScanning = false,
  activePairsCount = 0,
  totalPairs = 0,
  watchlist = []
}) => {
  const [alphaThoughts, setAlphaThoughts] = useState<AlphaThought[]>([]);
  const [internalIsScanning, setInternalIsScanning] = useState(false);

  // Use external scanning state if provided, otherwise use internal
  const isScanning = externalIsScanning || internalIsScanning;

  useEffect(() => {
    loadAlphaThoughts();

    const scanningChannel = supabase
      .channel('scanning-status')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'goal_sessions',
          filter: `id=eq.${sessionId}`
        },
        (payload) => {
          const status = payload.new.status;
          setInternalIsScanning(status === 'scanning');
        }
      )
      .subscribe();

    // Subscribe to alpha thoughts (live thought stream)
    const thoughtsChannel = supabase
      .channel('alpha-thoughts-stream')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'alpha_scan_thoughts',
          filter: `session_id=eq.${sessionId}`
        },
        (payload) => {
          const newThought = payload.new as AlphaThought;
          // Only add if it's an active scan thought
          if (newThought.is_active_scan !== false) {
            setAlphaThoughts(prev => [newThought, ...prev].slice(0, 15)); // Keep first 15 thoughts (newest)
          }
        }
      )
      .subscribe();

    return () => {
      scanningChannel.unsubscribe();
      thoughtsChannel.unsubscribe();
    };
  }, [sessionId]);

  const loadAlphaThoughts = async () => {
    const { data, error } = await supabase
      .from('alpha_scan_thoughts')
      .select('*')
      .eq('session_id', sessionId)
      .eq('is_active_scan', true)
      .order('created_at', { ascending: false })
      .limit(15);

    if (!error && data) {
      setAlphaThoughts(data);
    }
  };

  const getThoughtIcon = (stepType: string) => {
    switch (stepType) {
      case 'scan_start':
        return <Search className="w-4 h-4 text-blue-400" />;
      case 'filtering':
        return <BarChart3 className="w-4 h-4 text-purple-400" />;
      case 'omega_voting':
        return <Users className="w-4 h-4 text-indigo-400" />;
      case 'comparing':
        return <BarChart3 className="w-4 h-4 text-yellow-400" />;
      case 'analyzing_entry':
        return <Target className="w-4 h-4 text-orange-400" />;
      case 'alpha_loading_snapshot':
        return <Brain className="w-4 h-4 text-cyan-400" />;
      case 'alpha_platform_intel':
        return <Brain className="w-4 h-4 text-sky-400" />;
      case 'alpha_narrative':
        return <Brain className="w-4 h-4 text-blue-400" />;
      case 'alpha_risk_check':
        return <Brain className="w-4 h-4 text-amber-400" />;
      case 'alpha_micro_regime':
        return <Brain className="w-4 h-4 text-emerald-400" />;
      case 'alpha_liquidity_intent':
        return <Brain className="w-4 h-4 text-teal-400" />;
      case 'alpha_pattern_analysis':
        return <Brain className="w-4 h-4 text-violet-400" />;
      case 'alpha_stop_calculation':
        return <Brain className="w-4 h-4 text-rose-400" />;
      case 'alpha_feasibility':
        return <Brain className="w-4 h-4 text-fuchsia-400" />;
      case 'alpha_constraints':
        return <Brain className="w-4 h-4 text-orange-400" />;
      case 'alpha_final_decision':
        return <Brain className="w-4 h-4 text-lime-400" />;
      case 'final_decision':
        return <Award className="w-4 h-4 text-green-400" />;
      case 'execution':
        return <Zap className="w-4 h-4 text-green-500" />;
      case 'scan_complete':
        return <CheckCircle className="w-4 h-4 text-gray-400" />;
      default:
        return <Brain className="w-4 h-4 text-gray-400" />;
    }
  };

  const getThoughtColor = (stepType: string) => {
    switch (stepType) {
      case 'scan_start':
        return 'bg-blue-900/20 border-blue-700/50';
      case 'filtering':
        return 'bg-purple-900/20 border-purple-700/50';
      case 'omega_voting':
        return 'bg-indigo-900/20 border-indigo-700/50';
      case 'comparing':
        return 'bg-yellow-900/20 border-yellow-700/50';
      case 'analyzing_entry':
        return 'bg-orange-900/20 border-orange-700/50';
      case 'alpha_loading_snapshot':
        return 'bg-cyan-900/20 border-cyan-700/50';
      case 'alpha_platform_intel':
        return 'bg-sky-900/20 border-sky-700/50';
      case 'alpha_narrative':
        return 'bg-blue-900/20 border-blue-700/50';
      case 'alpha_risk_check':
        return 'bg-amber-900/20 border-amber-700/50';
      case 'alpha_micro_regime':
        return 'bg-emerald-900/20 border-emerald-700/50';
      case 'alpha_liquidity_intent':
        return 'bg-teal-900/20 border-teal-700/50';
      case 'alpha_pattern_analysis':
        return 'bg-violet-900/20 border-violet-700/50';
      case 'alpha_stop_calculation':
        return 'bg-rose-900/20 border-rose-700/50';
      case 'alpha_feasibility':
        return 'bg-fuchsia-900/20 border-fuchsia-700/50';
      case 'alpha_constraints':
        return 'bg-orange-900/20 border-orange-700/50';
      case 'alpha_final_decision':
        return 'bg-lime-900/20 border-lime-700/50';
      case 'final_decision':
        return 'bg-green-900/20 border-green-700/50';
      case 'execution':
        return 'bg-green-900/30 border-green-600/50';
      case 'scan_complete':
        return 'bg-gray-800/50 border-gray-600/50';
      default:
        return 'bg-gray-800/50 border-gray-600/50';
    }
  };

  const formatTimeAgo = (timestamp: string) => {
    const now = Date.now();
    const then = new Date(timestamp).getTime();
    const diffSeconds = Math.floor((now - then) / 1000);

    if (diffSeconds < 5) return 'just now';
    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    return `${diffHours}h ago`;
  };

  // Don't render if not scanning and no thoughts to show
  if (!isScanning && alphaThoughts.length === 0) {
    return null;
  }

  // Generate scanning status message
  const getScanningStatusMessage = () => {
    const isSinglePair = totalPairs === 1;
    // Use actual count from database, fallback to totalPairs only if undefined/null
    const pairsCount = activePairsCount !== undefined ? activePairsCount : totalPairs;
    const isFiltered = pairsCount < totalPairs;

    if (isSinglePair && watchlist.length > 0) {
      return `Scanning ${watchlist[0]} only`;
    }

    if (isFiltered) {
      const cryptoOnly = watchlist.every(s => ['BTCUSD', 'ETHUSD'].includes(s));
      if (cryptoOnly) {
        return `Scanning ${pairsCount} pairs (Crypto only - Forex markets closed)`;
      }
      return `Scanning ${pairsCount} of ${totalPairs} pairs (some markets closed)`;
    }

    return `Scanning ${pairsCount} pairs for opportunities...`;
  };

  return (
    <div className="space-y-3 mb-4">
      {/* Unified Scanning Status & Alpha's Thinking */}
      {isScanning && (
        <div className="bg-gradient-to-br from-blue-900/20 to-purple-900/20 rounded-lg border border-blue-500/30 overflow-hidden">
          {/* Scanning Status Header */}
          <div className="bg-blue-900/20 border-b border-blue-500/30 p-4">
            <div className="animate-pulse flex items-center gap-2">
              <Search className="w-5 h-5 text-blue-400" />
              <span className="text-blue-200 font-medium">
                {getScanningStatusMessage()}
              </span>
            </div>
          </div>

          {/* Alpha's Live Thought Stream */}
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-purple-400 animate-pulse" />
                <h3 className="text-sm font-bold text-white">Alpha's Thinking</h3>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
                <span className="text-xs text-purple-300">LIVE</span>
              </div>
            </div>

            {alphaThoughts.length > 0 ? (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {alphaThoughts.map((thought, idx) => (
                  <div
                    key={thought.id}
                    className={`rounded-lg p-3 border ${getThoughtColor(thought.step_type)} transition-all duration-300 ${
                      idx === 0 ? 'animate-pulse' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-shrink-0 mt-0.5">
                        {getThoughtIcon(thought.step_type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white font-medium leading-relaxed">
                          {thought.message}
                        </div>
                        {thought.metadata && thought.metadata.candidates && (
                          <div className="mt-2 space-y-1">
                            {thought.metadata.candidates.map((candidate: any, cidx: number) => (
                              <div key={cidx} className="text-xs text-gray-300 flex items-center gap-2">
                                <span className="font-mono">{candidate.symbol}</span>
                                <span className={`font-bold ${
                                  candidate.confidence >= 75 ? 'text-green-400' :
                                  candidate.confidence >= 65 ? 'text-yellow-400' :
                                  'text-gray-400'
                                }`}>
                                  {candidate.confidence}%
                                </span>
                                <span className="text-gray-500">{candidate.action}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 flex-shrink-0">
                        {formatTimeAgo(thought.created_at)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-gray-800/50 rounded-lg border border-gray-700/50 p-4">
                <div className="flex items-center gap-3">
                  <Brain className="w-5 h-5 text-gray-400 animate-pulse" />
                  <div className="text-sm text-gray-300">
                    Alpha is analyzing markets and evaluating opportunities...
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
