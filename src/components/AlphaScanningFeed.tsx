import React, { useState, useEffect } from 'react';
import { Brain, Target, CheckCircle, Search, Users, BarChart3, Award, Zap, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus, AlertCircle, Eye, Lock, ArrowRight } from 'lucide-react';
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

interface AlphaDecisionSummary {
  id: string;
  symbol: string;
  action: string;
  confidence: number | null;
  reasoning: string | null;
  answer_sheet: any;
  trade_style: string | null;
  created_at: string;
  trade_executed: boolean;
  safety_blocked: boolean;
  block_reason: string | null;
  decision_origin: string | null;
}

interface AlphaScanningFeedProps {
  sessionId: string;
  hasActiveTrades?: boolean;
  isScanning?: boolean;
  activePairsCount?: number;
  totalPairs?: number;
  watchlist?: string[];
}

// Phase-native trade type checks per phase
const PHASE_CHECKS: Record<string, { label: string; checks: string[] }> = {
  ACCUMULATION: {
    label: 'Accumulation',
    checks: ['Range boundary fade', 'Sweep trap fade', 'Equal H/L sweep-reclaim', 'Compression breakout setup'],
  },
  EXPANSION: {
    label: 'Expansion',
    checks: ['Pullback entry', 'Trend continuation', 'Momentum breakout'],
  },
  DISTRIBUTION: {
    label: 'Distribution',
    checks: ['Range top/bottom fade', 'Reversal entry'],
  },
  RETRACEMENT: {
    label: 'Retracement',
    checks: ['Push_confirmation continuation', 'Wait_pullback continuation'],
  },
  REVERSAL: {
    label: 'Reversal',
    checks: ['Structure retest entry', 'Counter-trend entry', 'Wait for BOS'],
  },
};

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
  const [scanResults, setScanResults] = useState<AlphaDecisionSummary[]>([]);
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);

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
          const wasScanning = internalIsScanning || externalIsScanning;
          setInternalIsScanning(status === 'scanning');
          // When scanning stops, load the latest scan results
          if (wasScanning && status !== 'scanning') {
            loadScanResults();
          }
        }
      )
      .subscribe();

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
          if (newThought.is_active_scan !== false) {
            setAlphaThoughts(prev => [newThought, ...prev].slice(0, 15));
          }
        }
      )
      .subscribe();

    return () => {
      scanningChannel.unsubscribe();
      thoughtsChannel.unsubscribe();
    };
  }, [sessionId]);

  // Load scan results when not scanning on mount
  useEffect(() => {
    if (!externalIsScanning) {
      loadScanResults();
    }
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

  const loadScanResults = async () => {
    // Get the most recent scan's decisions — last 30 minutes window to capture the scan batch
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('alpha_decisions')
      .select('id, symbol, action, confidence, reasoning, answer_sheet, trade_style, created_at, trade_executed, safety_blocked, block_reason, decision_origin')
      .eq('session_id', sessionId)
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    if (!error && data && data.length > 0) {
      // Deduplicate by symbol — keep most recent per symbol
      const seenSymbols = new Set<string>();
      const deduped: AlphaDecisionSummary[] = [];
      for (const row of data) {
        if (!seenSymbols.has(row.symbol)) {
          seenSymbols.add(row.symbol);
          deduped.push(row as AlphaDecisionSummary);
        }
      }
      setScanResults(deduped);
      setShowResults(true);
    }
  };

  const getThoughtIcon = (stepType: string) => {
    switch (stepType) {
      case 'scan_start': return <Search className="w-4 h-4 text-blue-400" />;
      case 'filtering': return <BarChart3 className="w-4 h-4 text-purple-400" />;
      case 'omega_voting': return <Users className="w-4 h-4 text-indigo-400" />;
      case 'comparing': return <BarChart3 className="w-4 h-4 text-yellow-400" />;
      case 'analyzing_entry': return <Target className="w-4 h-4 text-orange-400" />;
      case 'alpha_loading_snapshot': return <Brain className="w-4 h-4 text-cyan-400" />;
      case 'alpha_platform_intel': return <Brain className="w-4 h-4 text-sky-400" />;
      case 'alpha_narrative': return <Brain className="w-4 h-4 text-blue-400" />;
      case 'alpha_risk_check': return <Brain className="w-4 h-4 text-amber-400" />;
      case 'alpha_micro_regime': return <Brain className="w-4 h-4 text-emerald-400" />;
      case 'alpha_liquidity_intent': return <Brain className="w-4 h-4 text-teal-400" />;
      case 'alpha_pattern_analysis': return <Brain className="w-4 h-4 text-violet-400" />;
      case 'alpha_stop_calculation': return <Brain className="w-4 h-4 text-rose-400" />;
      case 'alpha_feasibility': return <Brain className="w-4 h-4 text-fuchsia-400" />;
      case 'alpha_constraints': return <Brain className="w-4 h-4 text-orange-400" />;
      case 'alpha_final_decision': return <Brain className="w-4 h-4 text-lime-400" />;
      case 'final_decision': return <Award className="w-4 h-4 text-green-400" />;
      case 'execution': return <Zap className="w-4 h-4 text-green-500" />;
      case 'scan_complete': return <CheckCircle className="w-4 h-4 text-gray-400" />;
      default: return <Brain className="w-4 h-4 text-gray-400" />;
    }
  };

  const getThoughtColor = (stepType: string) => {
    switch (stepType) {
      case 'scan_start': return 'bg-blue-900/20 border-blue-700/50';
      case 'filtering': return 'bg-purple-900/20 border-purple-700/50';
      case 'omega_voting': return 'bg-indigo-900/20 border-indigo-700/50';
      case 'comparing': return 'bg-yellow-900/20 border-yellow-700/50';
      case 'analyzing_entry': return 'bg-orange-900/20 border-orange-700/50';
      case 'alpha_loading_snapshot': return 'bg-cyan-900/20 border-cyan-700/50';
      case 'alpha_platform_intel': return 'bg-sky-900/20 border-sky-700/50';
      case 'alpha_narrative': return 'bg-blue-900/20 border-blue-700/50';
      case 'alpha_risk_check': return 'bg-amber-900/20 border-amber-700/50';
      case 'alpha_micro_regime': return 'bg-emerald-900/20 border-emerald-700/50';
      case 'alpha_liquidity_intent': return 'bg-teal-900/20 border-teal-700/50';
      case 'alpha_pattern_analysis': return 'bg-violet-900/20 border-violet-700/50';
      case 'alpha_stop_calculation': return 'bg-rose-900/20 border-rose-700/50';
      case 'alpha_feasibility': return 'bg-fuchsia-900/20 border-fuchsia-700/50';
      case 'alpha_constraints': return 'bg-orange-900/20 border-orange-700/50';
      case 'alpha_final_decision': return 'bg-lime-900/20 border-lime-700/50';
      case 'final_decision': return 'bg-green-900/20 border-green-700/50';
      case 'execution': return 'bg-green-900/30 border-green-600/50';
      case 'scan_complete': return 'bg-gray-800/50 border-gray-600/50';
      default: return 'bg-gray-800/50 border-gray-600/50';
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

  const getScanningStatusMessage = () => {
    const isSinglePair = totalPairs === 1;
    const pairsCount = activePairsCount !== undefined ? activePairsCount : totalPairs;
    const isFiltered = pairsCount < totalPairs;

    if (isSinglePair && watchlist.length > 0) return `Scanning ${watchlist[0]} only`;
    if (isFiltered) {
      const cryptoOnly = watchlist.every(s => ['BTCUSD', 'ETHUSD'].includes(s));
      if (cryptoOnly) return `Scanning ${pairsCount} pairs (Crypto only - Forex markets closed)`;
      return `Scanning ${pairsCount} of ${totalPairs} pairs (some markets closed)`;
    }
    return `Scanning ${pairsCount} pairs for opportunities...`;
  };

  const getActionColor = (action: string) => {
    if (action === 'BUY') return 'text-emerald-400';
    if (action === 'SELL') return 'text-red-400';
    if (action === 'MONITOR_REQUIRED') return 'text-amber-400';
    return 'text-gray-400';
  };

  const getActionIcon = (action: string) => {
    if (action === 'BUY') return <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />;
    if (action === 'SELL') return <TrendingDown className="w-3.5 h-3.5 text-red-400" />;
    if (action === 'MONITOR_REQUIRED') return <Lock className="w-3.5 h-3.5 text-amber-400" />;
    return <Minus className="w-3.5 h-3.5 text-gray-500" />;
  };

  const getConfidenceBadge = (confidence: number | null) => {
    if (confidence === null) return null;
    const color = confidence >= 75 ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50'
      : confidence >= 60 ? 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50'
      : 'bg-gray-800 text-gray-400 border-gray-600/50';
    return (
      <span className={`text-xs font-mono px-1.5 py-0.5 rounded border ${color}`}>
        {confidence}%
      </span>
    );
  };

  const getPhaseBadge = (phase: string | undefined) => {
    if (!phase) return null;
    const colors: Record<string, string> = {
      ACCUMULATION: 'bg-blue-900/40 text-blue-300 border-blue-700/50',
      EXPANSION: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50',
      DISTRIBUTION: 'bg-orange-900/40 text-orange-300 border-orange-700/50',
      RETRACEMENT: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50',
      REVERSAL: 'bg-rose-900/40 text-rose-300 border-rose-700/50',
    };
    return (
      <span className={`text-xs px-1.5 py-0.5 rounded border ${colors[phase] ?? 'bg-gray-800 text-gray-400 border-gray-600/50'}`}>
        {phase.charAt(0) + phase.slice(1).toLowerCase()}
      </span>
    );
  };

  // Don't render if not scanning and no thoughts and no results
  if (!isScanning && alphaThoughts.length === 0 && scanResults.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 mb-4">
      {/* Live scanning panel */}
      {isScanning && (
        <div className="bg-gradient-to-br from-blue-900/20 to-purple-900/20 rounded-lg border border-blue-500/30 overflow-hidden">
          <div className="bg-blue-900/20 border-b border-blue-500/30 p-4">
            <div className="animate-pulse flex items-center gap-2">
              <Search className="w-5 h-5 text-blue-400" />
              <span className="text-blue-200 font-medium">
                {getScanningStatusMessage()}
              </span>
            </div>
          </div>

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

      {/* Post-scan results panel */}
      {!isScanning && showResults && scanResults.length > 0 && (
        <div className="bg-gray-900/60 rounded-lg border border-gray-700/50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-700/50">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-semibold text-gray-200">Last Scan — Alpha's Evaluation</span>
              <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
                {scanResults.length} pair{scanResults.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              {formatTimeAgo(scanResults[0]?.created_at)}
            </div>
          </div>

          {/* Summary row */}
          <div className="px-4 py-2 border-b border-gray-700/30 bg-gray-800/30">
            <div className="flex items-center gap-4 text-xs text-gray-400 flex-wrap">
              <span>
                <span className="text-emerald-400 font-semibold">
                  {scanResults.filter(r => r.action === 'BUY' || r.action === 'SELL').length}
                </span>{' '}
                signal{scanResults.filter(r => r.action === 'BUY' || r.action === 'SELL').length !== 1 ? 's' : ''}
              </span>
              {scanResults.filter(r => r.action === 'MONITOR_REQUIRED').length > 0 && (
                <span>
                  <span className="text-amber-400 font-semibold">
                    {scanResults.filter(r => r.action === 'MONITOR_REQUIRED').length}
                  </span>{' '}
                  deferred
                </span>
              )}
              <span>
                <span className="text-gray-300 font-semibold">
                  {scanResults.filter(r => r.action === 'NO_TRADE').length}
                </span>{' '}
                no-trade
              </span>
              <span>Tap a pair to see Alpha's reasoning</span>
            </div>
          </div>

          {/* Per-symbol rows */}
          <div className="divide-y divide-gray-700/30">
            {scanResults.map((result) => {
              const phase = result.answer_sheet?.Q12_market_phase as string | undefined;
              const phaseInfo = phase ? PHASE_CHECKS[phase] : null;
              const isExpanded = expandedSymbol === result.symbol;
              const isTradeSignal = result.action === 'BUY' || result.action === 'SELL';
              const isMonitorRequired = result.action === 'MONITOR_REQUIRED';

              // CCIP-2026-0429A: Render MONITOR_REQUIRED as a special upgrade prompt card
              if (isMonitorRequired) {
                const monitorAction = result.answer_sheet?.monitor_required_action as string | undefined;
                const monitorConfidence = result.answer_sheet?.monitor_required_confidence as string | undefined;
                const monitorReasoning = result.answer_sheet?.monitor_required_reasoning as string | undefined;
                const zoneMin = result.answer_sheet?.monitor_required_zone_min as number | undefined;
                const zoneMax = result.answer_sheet?.monitor_required_zone_max as number | undefined;
                return (
                  <div key={result.id} className="overflow-hidden">
                    <button
                      className="w-full text-left px-4 py-3 hover:bg-amber-900/10 transition-colors"
                      onClick={() => setExpandedSymbol(isExpanded ? null : result.symbol)}
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm font-bold text-white w-16 flex-shrink-0">
                          {result.symbol}
                        </span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <Lock className="w-3.5 h-3.5 text-amber-400" />
                          {monitorAction === 'BUY'
                            ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                            : <TrendingDown className="w-3.5 h-3.5 text-red-400" />
                          }
                          <span className="text-xs font-semibold text-amber-400">Deferred</span>
                        </div>
                        {monitorConfidence && (
                          <span className="text-xs text-amber-300/70 bg-amber-900/20 border border-amber-700/30 px-1.5 py-0.5 rounded flex-shrink-0">
                            {monitorConfidence}
                          </span>
                        )}
                        <span className="text-xs text-gray-500 ml-auto mr-1">Monitor required</span>
                        <div className="flex-shrink-0 text-gray-500">
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 bg-amber-900/5">
                        {/* What Alpha found */}
                        <div className="bg-amber-900/20 border border-amber-700/30 rounded-lg p-3 mb-3">
                          <div className="flex items-start gap-2">
                            <Lock className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                            <div>
                              <div className="text-xs font-semibold text-amber-300 mb-1">
                                Alpha found a {monitorAction} setup on {result.symbol} — Entry Monitor required
                              </div>
                              {monitorReasoning && (
                                <div className="text-xs text-gray-300 leading-relaxed">
                                  {monitorReasoning}
                                </div>
                              )}
                              {(zoneMin != null && zoneMax != null) && (
                                <div className="mt-2 text-xs text-gray-400 font-mono">
                                  Target zone: {zoneMin.toFixed(5)} – {zoneMax.toFixed(5)}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Upgrade prompt */}
                        <div className="bg-gray-800/60 border border-gray-700/40 rounded-lg p-3">
                          <div className="text-xs text-gray-300 mb-2 leading-relaxed">
                            This setup requires a deferred entry — the trigger hasn't fired yet.
                            The Entry Monitor watches for your zone and executes automatically when price arrives.
                          </div>
                          <div className="text-xs text-gray-400 mb-3">
                            Available to Pipnosis Club Tier 1 members. Try scanning again in 5–15 minutes for an immediate execute_now opportunity.
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1.5 text-xs text-amber-400 font-semibold">
                              <ArrowRight className="w-3.5 h-3.5" />
                              <span>Join Club to unlock Entry Monitor</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <div key={result.id} className="overflow-hidden">
                  {/* Symbol row — always visible */}
                  <button
                    className="w-full text-left px-4 py-3 hover:bg-gray-800/40 transition-colors"
                    onClick={() => setExpandedSymbol(isExpanded ? null : result.symbol)}
                  >
                    <div className="flex items-center gap-3">
                      {/* Symbol */}
                      <span className="font-mono text-sm font-bold text-white w-16 flex-shrink-0">
                        {result.symbol}
                      </span>

                      {/* Action icon + label */}
                      <div className="flex items-center gap-1.5 w-20 flex-shrink-0">
                        {getActionIcon(result.action)}
                        <span className={`text-xs font-semibold ${getActionColor(result.action)}`}>
                          {result.action === 'NO_TRADE' ? 'No trade' : result.action}
                        </span>
                      </div>

                      {/* Confidence */}
                      <div className="flex-shrink-0">
                        {getConfidenceBadge(result.confidence)}
                      </div>

                      {/* Phase badge */}
                      <div className="flex-shrink-0">
                        {getPhaseBadge(phase)}
                      </div>

                      {/* Trade executed indicator */}
                      {isTradeSignal && result.trade_executed && (
                        <span className="text-xs text-emerald-400 bg-emerald-900/30 border border-emerald-700/40 px-1.5 py-0.5 rounded flex-shrink-0">
                          Executed
                        </span>
                      )}
                      {isTradeSignal && !result.trade_executed && result.safety_blocked && (
                        <span className="text-xs text-orange-400 bg-orange-900/30 border border-orange-700/40 px-1.5 py-0.5 rounded flex-shrink-0">
                          Blocked
                        </span>
                      )}

                      {/* Expand chevron */}
                      <div className="ml-auto flex-shrink-0 text-gray-500">
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </div>
                    </div>
                  </button>

                  {/* Expanded detail panel */}
                  {isExpanded && (
                    <div className="px-4 pb-4 bg-gray-800/20">

                      {/* Phase-native strategy checks */}
                      {phaseInfo && (
                        <div className="mb-3">
                          <div className="text-xs text-gray-500 uppercase tracking-wide mb-2 font-semibold">
                            {phaseInfo.label} — Strategy Checks
                          </div>
                          <div className="space-y-1">
                            {phaseInfo.checks.map((check, idx) => {
                              // We can't know the per-check outcome from current data unless
                              // Alpha names it in reasoning. Show the checks Alpha was required to evaluate.
                              const letter = String.fromCharCode(65 + idx); // A, B, C, D
                              return (
                                <div
                                  key={idx}
                                  className="flex items-start gap-2 text-xs"
                                >
                                  <span className="flex-shrink-0 w-5 h-5 rounded bg-gray-700/50 border border-gray-600/50 flex items-center justify-center text-gray-400 font-mono text-[10px] mt-0.5">
                                    {letter}
                                  </span>
                                  <span className="text-gray-300 leading-relaxed pt-0.5">{check}</span>
                                </div>
                              );
                            })}
                          </div>
                          {result.action === 'NO_TRADE' && (
                            <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-400/80">
                              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                              <span>Alpha's reasoning below should name why each check above is absent.</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Alpha's reasoning */}
                      {result.reasoning && (
                        <div>
                          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1.5 font-semibold">
                            Alpha's Reasoning
                          </div>
                          <div className="text-xs text-gray-300 leading-relaxed bg-gray-800/50 rounded-lg p-3 border border-gray-700/40 max-h-40 overflow-y-auto whitespace-pre-wrap">
                            {result.reasoning}
                          </div>
                        </div>
                      )}

                      {/* CCIP-2026-0508C/D: 10 mandatory audit fields compliance panel */}
                      {(() => {
                        const as = result.answer_sheet || {};
                        const checks: Array<{ key: string; label: string; ok: boolean; display: string }> = [
                          {
                            key: 'hypothesis_buy',
                            label: 'Hypothesis BUY',
                            ok: as.hypothesis_buy != null && typeof as.hypothesis_buy === 'object',
                            display: typeof as.hypothesis_buy === 'object' && as.hypothesis_buy !== null
                              ? (as.hypothesis_buy.structural_case || JSON.stringify(as.hypothesis_buy).slice(0, 120))
                              : (typeof as.hypothesis_buy === 'string' ? as.hypothesis_buy.slice(0, 120) : '—'),
                          },
                          {
                            key: 'hypothesis_sell',
                            label: 'Hypothesis SELL',
                            ok: as.hypothesis_sell != null && typeof as.hypothesis_sell === 'object',
                            display: typeof as.hypothesis_sell === 'object' && as.hypothesis_sell !== null
                              ? (as.hypothesis_sell.structural_case || JSON.stringify(as.hypothesis_sell).slice(0, 120))
                              : (typeof as.hypothesis_sell === 'string' ? as.hypothesis_sell.slice(0, 120) : '—'),
                          },
                          {
                            key: 'sweep_map_direction',
                            label: 'Sweep Map Direction',
                            ok: typeof (as.sweep_map_direction ?? as.Q_SWEEP_MAP_DIRECTION) === 'string' &&
                              ['BUY_FAVORED', 'SELL_FAVORED', 'BALANCED', 'INVERTED'].includes(
                                String(as.sweep_map_direction ?? as.Q_SWEEP_MAP_DIRECTION ?? '').trim().toUpperCase().split(' ')[0].replace(/[—-].*/, '').trim()
                              ),
                            display: as.sweep_map_direction ?? as.Q_SWEEP_MAP_DIRECTION ?? '—',
                          },
                          {
                            key: 'winning_hypothesis',
                            label: 'Winning Hypothesis',
                            ok: typeof as.winning_hypothesis === 'string' && as.winning_hypothesis.trim().length > 0,
                            display: as.winning_hypothesis || '—',
                          },
                          {
                            key: 'win_reason',
                            label: 'Win Reason',
                            ok: typeof as.win_reason === 'string' && as.win_reason.trim().length > 0,
                            display: as.win_reason || '—',
                          },
                          {
                            key: 'losing_hypothesis_disqualifier',
                            label: 'Losing Disqualifier',
                            ok: typeof as.losing_hypothesis_disqualifier === 'string' &&
                              as.losing_hypothesis_disqualifier.trim().length > 0,
                            display: as.losing_hypothesis_disqualifier || '—',
                          },
                          {
                            key: 'contradictions_fired',
                            label: 'Contradictions Fired',
                            ok: Array.isArray(as.contradictions_fired),
                            display: Array.isArray(as.contradictions_fired)
                              ? `${as.contradictions_fired.length} entries`
                              : '—',
                          },
                          {
                            key: 'contradictions_scanned_count',
                            label: 'Scanned Count (≥17)',
                            ok: typeof as.contradictions_scanned_count === 'number' &&
                              as.contradictions_scanned_count >= 17,
                            display: typeof as.contradictions_scanned_count === 'number'
                              ? String(as.contradictions_scanned_count)
                              : '—',
                          },
                          {
                            key: 'contradictions_unresolved_count',
                            label: 'Unresolved Count',
                            ok: typeof as.contradictions_unresolved_count === 'number',
                            display: typeof as.contradictions_unresolved_count === 'number'
                              ? String(as.contradictions_unresolved_count)
                              : '—',
                          },
                          {
                            key: 'reconciliation_ledger_complete',
                            label: 'Ledger Complete',
                            ok: typeof as.reconciliation_ledger_complete === 'boolean',
                            display: typeof as.reconciliation_ledger_complete === 'boolean'
                              ? (as.reconciliation_ledger_complete ? 'true' : 'false')
                              : '—',
                          },
                        ];
                        const present = checks.filter((c) => c.ok).length;
                        const gateFired = !!result.block_reason && (
                          String(result.block_reason).includes('0508C') ||
                          String(result.block_reason).includes('0508D')
                        );
                        const fullyCompliant = present === 10;
                        const headerColor = fullyCompliant
                          ? 'text-emerald-400 border-emerald-700/40 bg-emerald-900/10'
                          : 'text-amber-400 border-amber-700/40 bg-amber-900/10';
                        return (
                          <div className={`mt-3 rounded-lg border p-3 ${headerColor}`}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="text-[10px] uppercase tracking-wide font-semibold">
                                CCIP-0508C/D — Mandatory Audit Fields
                              </div>
                              <div className="text-[10px] font-mono">
                                {present}/10 {fullyCompliant ? 'COMPLIANT' : 'INCOMPLETE'}
                              </div>
                            </div>
                            {gateFired && result.block_reason && (
                              <div className="mb-2 text-[10px] text-amber-300 bg-amber-950/40 rounded px-2 py-1 border border-amber-800/40 break-words">
                                <span className="font-semibold">Gate: </span>
                                {result.decision_origin || 'SYSTEM_GATE'} — {result.block_reason}
                              </div>
                            )}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              {checks.map((c) => (
                                <div
                                  key={c.key}
                                  className={`rounded px-2 py-1 border text-[10px] ${
                                    c.ok
                                      ? 'border-emerald-800/40 bg-emerald-950/20'
                                      : 'border-red-800/50 bg-red-950/30'
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <span className={`font-semibold ${c.ok ? 'text-emerald-300' : 'text-red-300'}`}>
                                      {c.ok ? 'PASS' : 'MISSING'}
                                    </span>
                                    <span className="text-gray-400">{c.label}</span>
                                  </div>
                                  <div className="text-gray-300 mt-0.5 truncate" title={String(c.display)}>
                                    {String(c.display).length > 80
                                      ? String(c.display).slice(0, 80) + '…'
                                      : String(c.display)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Answer sheet key fields — prefer free-form, fallback to legacy */}
                      {result.answer_sheet && (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          {(result.answer_sheet.market_analysis || result.answer_sheet.Q1_trend_alignment) && (
                            <div className="bg-gray-800/40 rounded p-2 border border-gray-700/30 col-span-2">
                              <div className="text-[10px] text-gray-500 uppercase mb-0.5">Market Analysis</div>
                              <div className="text-xs text-gray-200 leading-relaxed">{result.answer_sheet.market_analysis || result.answer_sheet.Q1_trend_alignment}</div>
                            </div>
                          )}
                          {(result.answer_sheet.direction_thesis || result.answer_sheet.Q6_entry_trigger) && (
                            <div className="bg-gray-800/40 rounded p-2 border border-gray-700/30 col-span-2">
                              <div className="text-[10px] text-gray-500 uppercase mb-0.5">Direction Thesis</div>
                              <div className="text-xs text-gray-200 leading-relaxed">{result.answer_sheet.direction_thesis || result.answer_sheet.Q6_entry_trigger}</div>
                            </div>
                          )}
                          {(result.answer_sheet.risk_assessment || result.answer_sheet.Q4_momentum_stage) && (
                            <div className="bg-gray-800/40 rounded p-2 border border-gray-700/30">
                              <div className="text-[10px] text-gray-500 uppercase mb-0.5">{result.answer_sheet.risk_assessment ? 'Risk Assessment' : 'Momentum Stage'}</div>
                              <div className="text-xs text-gray-200">{result.answer_sheet.risk_assessment || result.answer_sheet.Q4_momentum_stage}</div>
                            </div>
                          )}
                          {result.answer_sheet.liquidity_sweep_read && (
                            <div className="bg-gray-800/40 rounded p-2 border border-gray-700/30 col-span-2">
                              <div className="text-[10px] text-gray-500 uppercase mb-0.5">Liquidity / Sweep</div>
                              <div className="text-xs text-gray-200 leading-relaxed">{result.answer_sheet.liquidity_sweep_read}</div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Trade style */}
                      {result.trade_style && (
                        <div className="mt-2 text-xs text-gray-500">
                          Style: <span className="text-gray-400">{result.trade_style.replace('_', ' ')}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
