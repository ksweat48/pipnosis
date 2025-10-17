import React, { useState, useEffect, useRef } from 'react';
import { Brain, ChevronDown, ChevronUp, Clock, CheckCircle, AlertCircle, Loader, Copy, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';

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
}

interface AIThoughtProcessPanelProps {
  decisionId?: string;
  isAnalyzing?: boolean;
  onComplete?: () => void;
  sessionId?: string | null;
  mode?: 'manual' | 'auto';
}

export const AIThoughtProcessPanel: React.FC<AIThoughtProcessPanelProps> = ({
  decisionId,
  isAnalyzing = false,
  onComplete,
  sessionId = null,
  mode = 'manual'
}) => {
  const [thoughts, setThoughts] = useState<ThoughtEntry[]>([]);
  const [isExpanded, setIsExpanded] = useState(true);
  const [autoScroll, setAutoScroll] = useState(false);
  const thoughtsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!decisionId) {
      setThoughts([]);
      return;
    }

    console.log('[AIThoughtProcessPanel] Setting up subscription for decision:', decisionId);
    loadThoughts();

    const channel = supabase
      .channel(`thought_process:${decisionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ai_thought_process',
          filter: `decision_id=eq.${decisionId}`
        },
        (payload) => {
          const newThought = payload.new as ThoughtEntry;
          console.log('[AIThoughtProcessPanel] 🔔 New thought received:', {
            id: newThought.id,
            title: newThought.title,
            stepType: newThought.step_type
          });
          setThoughts(prev => {
            // Avoid duplicates
            if (prev.some(t => t.id === newThought.id)) {
              console.log('[AIThoughtProcessPanel] Thought already exists, skipping');
              return prev;
            }
            return [...prev, newThought];
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'ai_thought_process',
          filter: `decision_id=eq.${decisionId}`
        },
        (payload) => {
          const updatedThought = payload.new as ThoughtEntry;
          console.log('[AIThoughtProcessPanel] 🔄 Thought updated:', updatedThought.id);
          setThoughts(prev =>
            prev.map(t => t.id === updatedThought.id ? updatedThought : t)
          );
        }
      )
      .subscribe((status) => {
        console.log('[AIThoughtProcessPanel] Subscription status:', status);
      });

    return () => {
      console.log('[AIThoughtProcessPanel] Cleaning up subscription for decision:', decisionId);
      supabase.removeChannel(channel);
    };
  }, [decisionId]);

  useEffect(() => {
    if (autoScroll && thoughtsEndRef.current) {
      thoughtsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [thoughts, autoScroll]);

  const loadThoughts = async () => {
    if (!decisionId) return;

    console.log('[AIThoughtProcessPanel] Loading thoughts for decision:', decisionId);

    const { data, error } = await supabase
      .from('ai_thought_process')
      .select('*')
      .eq('decision_id', decisionId)
      .order('step_number', { ascending: true });

    if (error) {
      console.error('[AIThoughtProcessPanel] Error loading thought process:', error);
      return;
    }

    console.log('[AIThoughtProcessPanel] Loaded thoughts:', data?.length || 0);
    setThoughts(data || []);
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
    a.download = `ai-thought-process-${decisionId?.slice(0, 8)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getStepIcon = (stepType: string, status: string) => {
    if (status === 'error') return <AlertCircle className="h-4 w-4 text-red-400" />;
    if (status === 'processing') return <Loader className="h-4 w-4 text-blue-400 animate-spin" />;
    if (status === 'completed') return <CheckCircle className="h-4 w-4 text-green-400" />;
    return <Clock className="h-4 w-4 text-yellow-400" />;
  };

  const getStepColor = (stepType: string) => {
    switch (stepType) {
      case 'initialization':
        return 'border-blue-500/30 bg-blue-500/5';
      case 'symbol_scan':
        return 'border-cyan-500/30 bg-cyan-500/5';
      case 'market_data_fetch':
        return 'border-purple-500/30 bg-purple-500/5';
      case 'technical_analysis':
        return 'border-yellow-500/30 bg-yellow-500/5';
      case 'fxflow_evaluation':
        return 'border-emerald-500/30 bg-emerald-500/5';
      case 'chatgpt_prompt':
        return 'border-orange-500/30 bg-orange-500/5';
      case 'chatgpt_response':
        return 'border-pink-500/30 bg-pink-500/5';
      case 'strategy_comparison':
        return 'border-violet-500/30 bg-violet-500/5';
      case 'risk_calculation':
        return 'border-red-500/30 bg-red-500/5';
      case 'option_generation':
        return 'border-green-500/30 bg-green-500/5';
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

  if (!isAnalyzing && thoughts.length === 0) {
    return null;
  }

  return (
    <div className="glass-card overflow-hidden">
      <div
        className="p-4 border-b border-white/10 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-purple-500/20 to-blue-500/20 rounded-xl">
            <Brain className={`h-5 w-5 text-purple-400 ${isAnalyzing ? 'animate-pulse' : ''}`} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">AI Thought Process</h3>
            <p className="text-xs text-white/60">
              {isAnalyzing ? 'Analyzing in real-time...' : `${thoughts.length} steps completed`}
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
        <div className="p-4 max-h-96 overflow-y-auto space-y-3">
          {thoughts.length === 0 && isAnalyzing && (
            <div className="text-center py-8">
              <Loader className="h-8 w-8 text-blue-400 animate-spin mx-auto mb-3" />
              <p className="text-white/60 text-sm">Initializing AI analysis...</p>
            </div>
          )}

          {thoughts.map((thought, index) => (
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
                      <span className="text-xs text-white/40">
                        {new Date(thought.created_at).toLocaleTimeString()}
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

          <div ref={thoughtsEndRef} />

          {thoughts.length > 0 && (
            <div className="flex items-center justify-between pt-2 border-t border-white/10">
              <label className="flex items-center gap-2 text-sm text-white/60 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="rounded"
                />
                Auto-scroll
              </label>
              <span className="text-xs text-white/40">
                {thoughts.filter(t => t.status === 'completed').length} of {thoughts.length} steps completed
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
