import React, { useState, useEffect, useRef } from 'react';
import { Brain, ChevronDown, ChevronUp, Clock, CheckCircle, AlertCircle, Loader, Copy, Download, Activity, Zap } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

interface ThoughtEntry {
  id: string;
  step_number: number;
  step_type: string;
  title: string;
  content: string;
  metadata: any;
  status: 'processing' | 'completed' | 'error';
  duration_ms: number | null;
  created_at: string;
  decision_id: string;
}

interface AutoTradingThoughtThreadProps {
  isAutoTradingActive: boolean;
  maxEntries?: number;
  currentSessionId?: string | null;
  sessionStartedAt?: Date | null;
}

export const AutoTradingThoughtThread: React.FC<AutoTradingThoughtThreadProps> = ({
  isAutoTradingActive,
  maxEntries = 100,
  currentSessionId,
  sessionStartedAt
}) => {
  const { user } = useAuth();
  const [thoughts, setThoughts] = useState<ThoughtEntry[]>([]);
  const [isExpanded, setIsExpanded] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filterSuccessOnly, setFilterSuccessOnly] = useState(false);
  const thoughtsEndRef = useRef<HTMLDivElement>(null);
  const [currentScanId, setCurrentScanId] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;

    loadRecentThoughts();

    const channel = supabase
      .channel(`auto_trading_thoughts:${user.id}:${currentSessionId || 'nosession'}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ai_thought_process',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          const newThought = payload.new as ThoughtEntry;

          // Only add thoughts from the current session
          if (currentSessionId && newThought.session_id === currentSessionId) {
            setThoughts(prev => {
              const updated = [...prev, newThought];
              return updated.slice(-maxEntries);
            });
          } else if (!currentSessionId) {
            // If no session ID, check if it's from an auto trading decision
            supabase
              .from('ai_trade_decisions')
              .select('decision_type')
              .eq('id', newThought.decision_id)
              .maybeSingle()
              .then(({ data, error }) => {
                if (data?.decision_type === 'auto') {
                  setThoughts(prev => {
                    const updated = [...prev, newThought];
                    return updated.slice(-maxEntries);
                  });
                }
              });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'ai_thought_process',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          const updatedThought = payload.new as ThoughtEntry;
          // Only update if it belongs to current session or if no session filter
          if (!currentSessionId || updatedThought.session_id === currentSessionId) {
            setThoughts(prev =>
              prev.map(t => t.id === updatedThought.id ? updatedThought : t)
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, maxEntries, currentSessionId]);

  useEffect(() => {
    if (autoScroll && thoughtsEndRef.current) {
      thoughtsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [thoughts, autoScroll]);

  const loadRecentThoughts = async () => {
    if (!user?.id) return;

    // If we have a current session ID, only load thoughts from this session
    if (currentSessionId) {
      const { data, error } = await supabase
        .from('ai_thought_process')
        .select('*')
        .eq('user_id', user.id)
        .eq('session_id', currentSessionId)
        .order('created_at', { ascending: true })
        .limit(maxEntries);

      if (error) {
        console.error('Error loading thought process:', error);
        return;
      }

      setThoughts(data || []);
    } else {
      // Fallback: Load recent thoughts from last 2 hours if no session ID
      const twoHoursAgo = new Date();
      twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);

      const { data, error } = await supabase
        .from('ai_thought_process')
        .select('*')
        .eq('user_id', user.id)
        .gte('created_at', twoHoursAgo.toISOString())
        .order('created_at', { ascending: true })
        .limit(maxEntries);

      if (error) {
        console.error('Error loading thought process:', error);
        return;
      }

      setThoughts(data || []);
    }
  };

  const copyToClipboard = () => {
    const text = thoughts
      .map(t => `[${t.step_number}] ${t.title}\n${t.content}\n`)
      .join('\n---\n\n');
    navigator.clipboard.writeText(text);
  };

  const downloadLog = () => {
    const text = thoughts
      .map(t => `[${t.step_number}] ${t.title}\nStatus: ${t.status}\nTime: ${new Date(t.created_at).toLocaleString()}\n\n${t.content}\n`)
      .join('\n' + '='.repeat(80) + '\n\n');

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `auto-trading-log-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const clearLog = () => {
    setThoughts([]);
  };

  const formatRelativeTime = (timestamp: string): string => {
    const now = new Date();
    const time = new Date(timestamp);
    const diffMs = now.getTime() - time.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins === 1) return '1 minute ago';
    if (diffMins < 60) return `${diffMins} minutes ago`;
    if (diffHours === 1) return '1 hour ago';
    if (diffHours < 24) return `${diffHours} hours ago`;
    if (diffDays === 1) return '1 day ago';
    return `${diffDays} days ago`;
  };

  const getStepIcon = (stepType: string, status: string) => {
    if (status === 'error') return <AlertCircle className="h-4 w-4 text-red-400" />;
    if (status === 'processing') return <Loader className="h-4 w-4 text-blue-400 animate-spin" />;
    if (status === 'completed') {
      if (stepType === 'auto_trade_execute') return <Zap className="h-4 w-4 text-emerald-400" />;
      if (stepType === 'auto_scan_start') return <Activity className="h-4 w-4 text-blue-400" />;
      return <CheckCircle className="h-4 w-4 text-green-400" />;
    }
    return <Clock className="h-4 w-4 text-yellow-400" />;
  };

  const getStepColor = (stepType: string) => {
    switch (stepType) {
      case 'auto_scan_start':
        return 'border-blue-500/30 bg-blue-500/5';
      case 'auto_scan_complete':
        return 'border-cyan-500/30 bg-cyan-500/5';
      case 'auto_threshold_check':
        return 'border-yellow-500/30 bg-yellow-500/5';
      case 'auto_trade_skip':
        return 'border-orange-500/30 bg-orange-500/5';
      case 'auto_trade_execute':
        return 'border-emerald-500/30 bg-emerald-500/10';
      case 'auto_market_hours_check':
        return 'border-purple-500/30 bg-purple-500/5';
      case 'auto_limit_check':
        return 'border-pink-500/30 bg-pink-500/5';
      case 'auto_emergency_stop':
        return 'border-red-500/50 bg-red-500/10';
      case 'symbol_scan':
        return 'border-cyan-500/30 bg-cyan-500/5';
      case 'market_data_fetch':
        return 'border-purple-500/30 bg-purple-500/5';
      case 'technical_analysis':
        return 'border-yellow-500/30 bg-yellow-500/5';
      case 'fxflow_evaluation':
        return 'border-emerald-500/30 bg-emerald-500/5';
      case 'chatgpt_response':
        return 'border-pink-500/30 bg-pink-500/5';
      case 'strategy_comparison':
        return 'border-violet-500/30 bg-violet-500/5';
      case 'final_decision':
        return 'border-emerald-500/30 bg-emerald-500/5';
      case 'error':
        return 'border-red-500/50 bg-red-500/10';
      case 'warning':
        return 'border-yellow-500/50 bg-yellow-500/10';
      default:
        return 'border-white/10 bg-white/5';
    }
  };

  const filteredThoughts = filterSuccessOnly
    ? thoughts.filter(t => t.step_type === 'auto_trade_execute' || t.step_type === 'final_decision')
    : thoughts;

  const groupedThoughts = filteredThoughts.reduce((acc, thought) => {
    const decisionId = thought.decision_id;
    if (!acc[decisionId]) {
      acc[decisionId] = [];
    }
    acc[decisionId].push(thought);
    return acc;
  }, {} as Record<string, ThoughtEntry[]>);

  const scanCycles = Object.keys(groupedThoughts).reverse();

  if (!isAutoTradingActive && thoughts.length === 0) {
    return null;
  }

  return (
    <div className="glass-card overflow-hidden">
      <div
        className="p-4 border-b border-white/10 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-emerald-500/20 to-blue-500/20 rounded-xl">
            <Brain className={`h-5 w-5 text-emerald-400 ${isAutoTradingActive ? 'animate-pulse' : ''}`} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Auto Trading AI Thought Process</h3>
            <p className="text-xs text-white/60">
              {isAutoTradingActive ? (
                sessionStartedAt ? (
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 bg-green-400 rounded-full animate-pulse" />
                    Live - Session started {formatRelativeTime(sessionStartedAt.toISOString())}
                  </span>
                ) : (
                  'Live monitoring active'
                )
              ) : (
                `${thoughts.length} entries logged`
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {thoughts.length > 0 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  copyToClipboard();
                }}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                title="Copy to clipboard"
              >
                <Copy className="h-4 w-4 text-white/60" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  downloadLog();
                }}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                title="Download log"
              >
                <Download className="h-4 w-4 text-white/60" />
              </button>
            </>
          )}
          {isExpanded ? (
            <ChevronUp className="h-5 w-5 text-white/60" />
          ) : (
            <ChevronDown className="h-5 w-5 text-white/60" />
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="p-4 space-y-4">
          {sessionStartedAt && isAutoTradingActive && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-3 mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 bg-green-400 rounded-full animate-pulse" />
                  <span className="text-sm font-semibold text-green-400">Current Session Active</span>
                </div>
                <span className="text-xs text-white/60">
                  Started {formatRelativeTime(sessionStartedAt.toISOString())} • {new Date(sessionStartedAt).toLocaleTimeString()}
                </span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pb-3 border-b border-white/10">
            <label className="flex items-center gap-2 text-sm text-white/60 cursor-pointer">
              <input
                type="checkbox"
                checked={filterSuccessOnly}
                onChange={(e) => setFilterSuccessOnly(e.target.checked)}
                className="rounded"
              />
              Show trades only
            </label>
            <label className="flex items-center gap-2 text-sm text-white/60 cursor-pointer">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="rounded"
              />
              Auto-scroll
            </label>
            {thoughts.length > 0 && (
              <button
                onClick={clearLog}
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                Clear Log
              </button>
            )}
          </div>

          <div className="max-h-[600px] overflow-y-auto space-y-4">
            {thoughts.length === 0 && !isAutoTradingActive && (
              <div className="text-center py-12">
                <Brain className="h-12 w-12 text-white/20 mx-auto mb-3" />
                <p className="text-white/60 text-sm">No auto trading activity yet</p>
                <p className="text-white/40 text-xs mt-1">Start auto trading to see AI decision process</p>
              </div>
            )}

            {thoughts.length === 0 && isAutoTradingActive && (
              <div className="text-center py-12">
                <Loader className="h-8 w-8 text-emerald-400 animate-spin mx-auto mb-3" />
                <p className="text-white/60 text-sm">Waiting for first scan cycle...</p>
              </div>
            )}

            {scanCycles.map((decisionId, cycleIndex) => {
              const cycleThoughts = groupedThoughts[decisionId];
              const isTradeExecuted = cycleThoughts.some(t => t.step_type === 'auto_trade_execute');

              return (
                <div key={decisionId} className="space-y-3">
                  <div className={`sticky top-0 z-10 px-3 py-2 rounded-lg backdrop-blur-sm ${isTradeExecuted ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-white/5 border border-white/10'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white/80">
                        Scan Cycle #{scanCycles.length - cycleIndex}
                      </span>
                      <div className="flex items-center gap-2">
                        {isTradeExecuted && (
                          <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                            <Zap className="h-3 w-3" />
                            Trade Executed
                          </span>
                        )}
                        <span className="text-xs text-white/40" title={new Date(cycleThoughts[0].created_at).toLocaleString()}>
                          {formatRelativeTime(cycleThoughts[0].created_at)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {cycleThoughts.map((thought) => (
                    <div
                      key={thought.id}
                      className={`border rounded-xl p-4 ${getStepColor(thought.step_type)} transition-all duration-300`}
                    >
                      <div className="flex items-start gap-3 mb-2">
                        <div className="flex-shrink-0 mt-0.5">
                          {getStepIcon(thought.step_type, thought.status)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <h4 className="text-white font-semibold text-sm">
                              {thought.step_number}. {thought.title}
                            </h4>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {thought.duration_ms && (
                                <span className="text-xs text-white/40">
                                  {thought.duration_ms}ms
                                </span>
                              )}
                              <span className="text-xs text-white/40" title={new Date(thought.created_at).toLocaleString()}>
                                {formatRelativeTime(thought.created_at)}
                              </span>
                            </div>
                          </div>
                          <div className="text-white/80 text-sm whitespace-pre-wrap break-words">
                            {thought.content}
                          </div>
                          {thought.metadata && Object.keys(thought.metadata).length > 0 && (
                            <details className="mt-2">
                              <summary className="text-xs text-white/60 cursor-pointer hover:text-white/80">
                                View metadata
                              </summary>
                              <pre className="mt-2 p-2 bg-black/20 rounded text-xs text-white/70 overflow-x-auto">
                                {JSON.stringify(thought.metadata, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}

            <div ref={thoughtsEndRef} />
          </div>

          {thoughts.length > 0 && (
            <div className="flex items-center justify-between pt-3 border-t border-white/10 text-xs text-white/40">
              <span>
                {filteredThoughts.length} of {thoughts.length} entries
              </span>
              <span>
                {scanCycles.length} scan cycles
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
