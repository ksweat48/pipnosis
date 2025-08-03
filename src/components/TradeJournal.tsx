import React, { useState } from 'react';
import { BookOpen, Clock, TrendingUp, TrendingDown, AlertCircle, Pause, Target, ThumbsUp, RotateCcw, MessageCircle } from 'lucide-react';
import { useJournalEntries } from '../hooks/useAPI';
import { useAuth } from '../contexts/AuthContext';

interface TradeJournalProps {
  onReaction: (entryId: string, reaction: 'thumbs-up' | 'explain-more') => void;
}

export const TradeJournal: React.FC<TradeJournalProps> = ({ onReaction }) => {
  const { user } = useAuth();
  const { entries, isLoading, error, refetch } = useJournalEntries();
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

  const getEntryIcon = (entryType: string) => {
    switch (entryType) {
      case 'trade_entry': return <TrendingUp className="h-4 w-4 text-emerald-400" />;
      case 'trade_exit': return <TrendingDown className="h-4 w-4 text-green-400" />;
      case 'market_update': return <MessageCircle className="h-4 w-4 text-slate-400" />;
      case 'ai_decision': return <Target className="h-4 w-4 text-purple-400" />;
      case 'modification': return <AlertCircle className="h-4 w-4 text-yellow-400" />;
      default: return <MessageCircle className="h-4 w-4 text-slate-400" />;
    }
  };

  const getEntryTag = (entryType: string) => {
    switch (entryType) {
      case 'trade_entry': return { text: 'New Trade', color: 'bg-emerald-500/20 text-emerald-400' };
      case 'trade_exit': return { text: 'Trade Closed', color: 'bg-green-500/20 text-green-400' };
      case 'market_update': return { text: 'Market Update', color: 'bg-slate-500/20 text-slate-400' };
      case 'ai_decision': return { text: 'AI Guidance', color: 'bg-purple-500/20 text-purple-400' };
      case 'modification': return { text: 'Position Update', color: 'bg-yellow-500/20 text-yellow-400' };
      default: return { text: 'Update', color: 'bg-slate-500/20 text-slate-400' };
    }
  };

  const getConfidenceIndicator = (confidence: string) => {
    if (!confidence) return null;
    
    const colors = {
      high: 'bg-green-500',
      medium: 'bg-yellow-500',
      low: 'bg-red-500'
    };

    return (
      <div className="flex items-center space-x-1">
        <span className="text-xs text-slate-400">AI Confidence:</span>
        <div className={`w-2 h-2 rounded-full ${colors[confidence as keyof typeof colors]}`}></div>
        <span className="text-xs text-slate-300 capitalize">{confidence}</span>
      </div>
    );
  };

  const formatTime = (createdAt: string) => {
    const date = new Date(createdAt);
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
    
    if (diffInHours < 1) return 'Just now';
    if (diffInHours < 24) return `${diffInHours}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="glass-card">
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold text-white flex items-center space-x-3">
            <BookOpen className="h-5 w-5 text-emerald-400" />
            <span>Pipnosis Trade Journal</span>
            {isLoading && <div className="animate-spin h-5 w-5 border-2 border-emerald-500 border-t-transparent rounded-full"></div>}
          </h3>
          <div className="text-sm text-white/60 font-medium">
            AI Decision Feed
          </div>
        </div>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="animate-spin h-12 w-12 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-white/60 font-medium">Loading journal entries...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <AlertCircle className="h-16 w-16 mx-auto mb-4 text-red-400" />
            <p className="text-red-400 font-medium">Error loading journal entries</p>
            <button 
              onClick={refetch}
              className="mt-3 text-sm text-red-300 hover:text-red-200 underline font-medium"
            >
              Try again
            </button>
          </div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center">
            <BookOpen className="h-16 w-16 text-white/20 mx-auto mb-4" />
            <p className="text-white/60 font-semibold">No trading activity yet</p>
            <p className="text-white/40 text-sm mt-2 font-medium">AI decisions will appear here in real-time</p>
          </div>
        ) : (
          <div className="divide-y divide-white/10">
            {entries.map((entry) => {
              const tag = getEntryTag(entry.entry_type);
              const isExpanded = expandedEntry === entry.id;
              
              return (
                <div key={entry.id} className="p-6 hover:bg-white/5 transition-all duration-200">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center space-x-4 min-w-0 flex-1">
                      {getEntryIcon(entry.entry_type)}
                      <div className="min-w-0 flex-1">
                        <h4 className="font-bold text-white text-lg truncate">{entry.title}</h4>
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <span className={`px-3 py-1 rounded-full text-xs font-bold ${tag.color}`}>
                            {tag.text}
                          </span>
                          {entry.metadata?.symbol && (
                            <span className="text-sm text-white/60 font-mono font-bold">
                              {entry.metadata.symbol}
                            </span>
                          )}
                          {entry.metadata?.pnl !== undefined && (
                            <span className={`text-sm font-bold ${
                              entry.metadata.pnl >= 0 ? 'text-green-400' : 'text-red-400'
                            }`}>
                              {entry.metadata.pnl >= 0 ? '+' : ''}${entry.metadata.pnl.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-2 text-sm text-white/40 flex-shrink-0 ml-4 font-medium">
                      <Clock className="h-3 w-3" />
                      <span>{formatTime(entry.created_at)}</span>
                    </div>
                  </div>

                  <div className="ml-9">
                    <p className="text-white/80 leading-relaxed mb-4 font-medium">
                      {entry.content}
                    </p>

                    {entry.confidence_level && (
                      <div className="mb-4">
                        {getConfidenceIndicator(entry.confidence_level)}
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <button
                          onClick={() => onReaction(entry.id, 'thumbs-up')}
                          className={`p-2 rounded-xl transition-all duration-200 ${
                            entry.metadata?.userReaction === 'thumbs-up'
                              ? 'bg-green-500/20 text-green-400'
                              : 'text-white/40 hover:text-green-400 hover:bg-green-500/10'
                          }`}
                          title="Good decision"
                        >
                          <ThumbsUp className="h-4 w-4" />
                        </button>
                        
                        <button
                          onClick={() => onReaction(entry.id, 'explain-more')}
                          className={`p-2 rounded-xl transition-all duration-200 ${
                            entry.metadata?.userReaction === 'explain-more'
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : 'text-white/40 hover:text-emerald-400 hover:bg-emerald-500/10'
                          }`}
                          title="Explain more"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </button>
                      </div>

                      {entry.trade_id && (
                        <button
                          onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}
                          className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
                        >
                          {isExpanded ? 'Less' : 'More'}
                        </button>
                      )}
                    </div>

                    {isExpanded && entry.trade_id && (
                      <div className="mt-4 p-4 bg-white/5 rounded-2xl border border-white/10">
                        <div className="text-sm text-white/60 space-y-2 font-medium">
                          <div>Trade ID: <span className="text-slate-300 font-mono">{entry.trade_id}</span></div>
                          <div>Decision Time: <span className="text-slate-300">{new Date(entry.created_at).toLocaleString()}</span></div>
                          <div>AI Analysis: <span className="text-slate-300">Based on technical indicators, market sentiment, and risk parameters</span></div>
                          {entry.metadata?.currentPrice && (
                            <div>Current Price: <span className="text-slate-300 font-mono">{entry.metadata.currentPrice}</span></div>
                          )}
                          {entry.metadata?.unrealizedPnL && (
                            <div>Unrealized P&L: <span className={`font-mono ${entry.metadata.unrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {entry.metadata.unrealizedPnL >= 0 ? '+' : ''}${entry.metadata.unrealizedPnL.toFixed(2)}
                            </span></div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};