import React, { useState } from 'react';
import { BookOpen, Clock, TrendingUp, TrendingDown, AlertCircle, Pause, Target, ThumbsUp, RotateCcw, MessageCircle } from 'lucide-react';

interface JournalEntry {
  id: string;
  timestamp: string;
  type: 'entry' | 'modification' | 'exit' | 'update' | 'pause' | 'goal-met';
  title: string;
  message: string;
  tradeId?: string;
  symbol?: string;
  pnl?: number;
  confidence?: 'high' | 'medium' | 'low';
  userReaction?: 'thumbs-up' | 'explain-more' | null;
}

interface TradeJournalProps {
  entries: JournalEntry[];
  onReaction: (entryId: string, reaction: 'thumbs-up' | 'explain-more') => void;
}

export const TradeJournal: React.FC<TradeJournalProps> = ({ entries, onReaction }) => {
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

  const getEntryIcon = (type: string) => {
    switch (type) {
      case 'entry': return <TrendingUp className="h-4 w-4 text-blue-400" />;
      case 'modification': return <AlertCircle className="h-4 w-4 text-yellow-400" />;
      case 'exit': return <TrendingDown className="h-4 w-4 text-green-400" />;
      case 'update': return <MessageCircle className="h-4 w-4 text-slate-400" />;
      case 'pause': return <Pause className="h-4 w-4 text-purple-400" />;
      case 'goal-met': return <Target className="h-4 w-4 text-green-400" />;
      default: return <MessageCircle className="h-4 w-4 text-slate-400" />;
    }
  };

  const getEntryTag = (type: string, pnl?: number) => {
    switch (type) {
      case 'entry': return { text: 'New Trade', color: 'bg-blue-500/20 text-blue-400' };
      case 'modification': return { text: 'Position Update', color: 'bg-yellow-500/20 text-yellow-400' };
      case 'exit': 
        if (pnl && pnl > 0) return { text: 'Profit Secured', color: 'bg-green-500/20 text-green-400' };
        if (pnl && pnl < 0) return { text: 'Loss Minimized', color: 'bg-red-500/20 text-red-400' };
        return { text: 'Trade Closed', color: 'bg-slate-500/20 text-slate-400' };
      case 'pause': return { text: 'Strategy Pause', color: 'bg-purple-500/20 text-purple-400' };
      case 'goal-met': return { text: 'Goal Achieved', color: 'bg-green-500/20 text-green-400' };
      default: return { text: 'Update', color: 'bg-slate-500/20 text-slate-400' };
    }
  };

  const getConfidenceIndicator = (confidence?: string) => {
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

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
    
    if (diffInHours < 1) return 'Just now';
    if (diffInHours < 24) return `${diffInHours}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700">
      <div className="p-4 sm:p-6 border-b border-slate-700">
        <div className="flex flex-col space-y-2 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <h3 className="text-lg font-semibold text-white flex items-center space-x-2">
            <BookOpen className="h-5 w-5 text-blue-400" />
            <span>Pipnosis Trade Journal</span>
          </h3>
          <div className="text-sm text-slate-400">
            AI Decision Feed
          </div>
        </div>
      </div>

      <div className="max-h-80 sm:max-h-96 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="p-4 sm:p-6 text-center text-slate-400">
            <BookOpen className="h-8 w-8 sm:h-12 sm:w-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm sm:text-base">No trading activity yet</p>
            <p className="text-xs sm:text-sm">AI decisions will appear here in real-time</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-700">
            {entries.map((entry) => {
              const tag = getEntryTag(entry.type, entry.pnl);
              const isExpanded = expandedEntry === entry.id;
              
              return (
                <div key={entry.id} className="p-3 sm:p-4 hover:bg-slate-900/50 transition-colors">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 flex-1">
                      {getEntryIcon(entry.type)}
                      <div className="min-w-0 flex-1">
                        <h4 className="font-medium text-white text-sm sm:text-base truncate">{entry.title}</h4>
                        <div className="flex flex-wrap items-center gap-1 sm:gap-2 mt-1">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${tag.color}`}>
                            {tag.text}
                          </span>
                          {entry.symbol && (
                            <span className="text-xs text-slate-400 font-mono">
                              {entry.symbol}
                            </span>
                          )}
                          {entry.pnl !== undefined && (
                            <span className={`text-xs font-semibold ${
                              entry.pnl >= 0 ? 'text-green-400' : 'text-red-400'
                            }`}>
                              {entry.pnl >= 0 ? '+' : ''}${entry.pnl.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-1 text-xs text-slate-400 flex-shrink-0 ml-2">
                      <Clock className="h-3 w-3" />
                      <span className="hidden sm:inline">{formatTime(entry.timestamp)}</span>
                      <span className="sm:hidden">{formatTime(entry.timestamp).split(' ')[0]}</span>
                    </div>
                  </div>

                  <div className="ml-5 sm:ml-7">
                    <p className="text-slate-300 text-sm leading-relaxed mb-2 sm:mb-3">
                      {entry.message}
                    </p>

                    {entry.confidence && (
                      <div className="mb-2 sm:mb-3">
                        {getConfidenceIndicator(entry.confidence)}
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1 sm:space-x-2">
                        <button
                          onClick={() => onReaction(entry.id, 'thumbs-up')}
                          className={`p-1 sm:p-1.5 rounded-lg transition-colors ${
                            entry.userReaction === 'thumbs-up'
                              ? 'bg-green-500/20 text-green-400'
                              : 'text-slate-400 hover:text-green-400 hover:bg-green-500/10'
                          }`}
                          title="Good decision"
                        >
                          <ThumbsUp className="h-3 w-3" />
                        </button>
                        
                        <button
                          onClick={() => onReaction(entry.id, 'explain-more')}
                          className={`p-1 sm:p-1.5 rounded-lg transition-colors ${
                            entry.userReaction === 'explain-more'
                              ? 'bg-blue-500/20 text-blue-400'
                              : 'text-slate-400 hover:text-blue-400 hover:bg-blue-500/10'
                          }`}
                          title="Explain more"
                        >
                          <RotateCcw className="h-3 w-3" />
                        </button>
                      </div>

                      {entry.tradeId && (
                        <button
                          onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}
                          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          {isExpanded ? 'Less' : 'More'}
                        </button>
                      )}
                    </div>

                    {isExpanded && entry.tradeId && (
                      <div className="mt-3 p-2 sm:p-3 bg-slate-900 rounded-lg border border-slate-600">
                        <div className="text-xs text-slate-400 space-y-1">
                          <div>Trade ID: <span className="text-slate-300 font-mono">{entry.tradeId}</span></div>
                          <div>Decision Time: <span className="text-slate-300">{new Date(entry.timestamp).toLocaleString()}</span></div>
                          <div>AI Analysis: <span className="text-slate-300">Based on technical indicators, market sentiment, and risk parameters</span></div>
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