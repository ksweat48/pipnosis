import React, { useState, useEffect } from 'react';
import { Brain, TrendingUp, TrendingDown, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { llmReasoningLogger } from '../services/llm-reasoning-logger';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';

export const AITradeJournal: React.FC = () => {
  const { user } = useAuth();
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'win' | 'loss'>('all');

  useEffect(() => {
    if (user) {
      loadEntries();

      const subscription = supabase
        .channel('journal_updates')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'ai_trade_journal',
          filter: `user_id=eq.${user.id}`
        }, () => {
          loadEntries();
        })
        .subscribe();

      return () => {
        subscription.unsubscribe();
      };
    }
  }, [user]);

  const loadEntries = async () => {
    if (!user) return;
    const data = await llmReasoningLogger.getJournalEntries(user.id, 100);
    setEntries(data);
    setLoading(false);
  };

  const filteredEntries = entries.filter(entry => {
    if (filter === 'all') return true;
    return entry.outcome === filter;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-12 w-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-6">
      <div className="bg-gray-900 backdrop-blur-xl rounded-2xl p-4 sm:p-6 border border-white/5 sticky top-0 z-20 shadow-lg shadow-black/20">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-xl">
              <Brain className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-white">AI Trade Journal</h2>
              <p className="text-xs sm:text-sm text-gray-400">Every decision explained in natural language</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-xl transition-all font-medium ${
                filter === 'all'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30'
                  : 'bg-gray-700/50 text-gray-300 hover:bg-gray-600/50'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilter('win')}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-xl transition-all font-medium ${
                filter === 'win'
                  ? 'bg-green-600 text-white shadow-lg shadow-green-500/30'
                  : 'bg-gray-700/50 text-gray-300 hover:bg-gray-600/50'
              }`}
            >
              Wins
            </button>
            <button
              onClick={() => setFilter('loss')}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-xl transition-all font-medium ${
                filter === 'loss'
                  ? 'bg-red-600 text-white shadow-lg shadow-red-500/30'
                  : 'bg-gray-700/50 text-gray-300 hover:bg-gray-600/50'
              }`}
            >
              Losses
            </button>
          </div>
        </div>
      </div>

      {filteredEntries.length === 0 ? (
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-8 sm:p-12 text-center border border-white/5">
          <div className="p-4 bg-gray-700/30 rounded-2xl w-20 h-20 flex items-center justify-center mx-auto mb-4">
            <Brain className="w-12 h-12 text-gray-500" />
          </div>
          <h3 className="text-xl sm:text-2xl font-bold text-white mb-3">No Journal Entries Yet</h3>
          <p className="text-gray-400 mb-2 max-w-md mx-auto">
            Your AI will start documenting its reasoning as soon as you take trades.
          </p>
          <p className="text-sm text-gray-500 max-w-sm mx-auto">
            Every trade decision, market analysis, and lesson learned will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3 sm:space-y-4">
          {filteredEntries.map((entry) => (
            <div
              key={entry.id}
              className="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-4 sm:p-6 border-l-4 hover:bg-gray-800/70 transition-all border border-white/5"
              style={{
                borderLeftColor: entry.outcome === 'win' ? '#10b981' : entry.outcome === 'loss' ? '#ef4444' : '#6b7280'
              }}
            >
              <div className="flex items-start justify-between mb-4 gap-3">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  <div className="flex-shrink-0">
                    {entry.outcome === 'win' ? (
                      <CheckCircle className="w-5 h-5 sm:w-6 sm:h-6 text-green-500" />
                    ) : entry.outcome === 'loss' ? (
                      <XCircle className="w-5 h-5 sm:w-6 sm:h-6 text-red-500" />
                    ) : entry.outcome === 'open' ? (
                      <AlertCircle className="w-5 h-5 sm:w-6 sm:h-6 text-blue-500" />
                    ) : (
                      <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-gray-600" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base sm:text-lg font-bold text-white truncate">
                      {entry.symbol} {entry.direction.toUpperCase()}
                    </h3>
                    <p className="text-xs sm:text-sm text-gray-400">
                      {new Date(entry.entry_time).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className={`text-lg sm:text-2xl font-bold flex-shrink-0 ${entry.pnl > 0 ? 'text-green-400' : entry.pnl < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                  {entry.outcome === 'open' ? 'OPEN' : `${entry.pnl > 0 ? '+' : ''}$${entry.pnl?.toFixed(2) || '0.00'}`}
                </div>
              </div>

              <div className="space-y-3">
                {entry.llm_reasoning && (
                  <div className="bg-blue-500/5 rounded-lg p-3">
                    <h4 className="text-xs sm:text-sm font-semibold text-blue-400 mb-1.5">💭 Why I Took This Trade</h4>
                    <p className="text-sm text-gray-300 leading-relaxed">{entry.llm_reasoning}</p>
                  </div>
                )}

                {entry.market_read && (
                  <div className="bg-blue-500/5 rounded-lg p-3">
                    <h4 className="text-xs sm:text-sm font-semibold text-blue-400 mb-1.5">📊 Market Analysis</h4>
                    <p className="text-sm text-gray-300 leading-relaxed">{entry.market_read}</p>
                  </div>
                )}

                {entry.expected_outcome && (
                  <div className="bg-blue-500/5 rounded-lg p-3">
                    <h4 className="text-xs sm:text-sm font-semibold text-blue-400 mb-1.5">🎯 What I Expected</h4>
                    <p className="text-sm text-gray-300 leading-relaxed">{entry.expected_outcome}</p>
                  </div>
                )}

                {entry.exit_time && (
                  <>
                    <hr className="border-gray-700/50 my-3" />

                    {entry.actual_outcome && (
                      <div className="bg-yellow-500/5 rounded-lg p-3">
                        <h4 className="text-xs sm:text-sm font-semibold text-yellow-400 mb-1.5">📈 What Actually Happened</h4>
                        <p className="text-sm text-gray-300 leading-relaxed">{entry.actual_outcome}</p>
                      </div>
                    )}

                    {entry.was_prediction_correct !== null && (
                      <div className="bg-yellow-500/5 rounded-lg p-3">
                        <h4 className="text-xs sm:text-sm font-semibold text-yellow-400">
                          {entry.was_prediction_correct ? '✅ Prediction: Correct' : '❌ Prediction: Incorrect'}
                          {entry.accuracy_score && ` (${entry.accuracy_score.toFixed(0)}% accuracy)`}
                        </h4>
                      </div>
                    )}

                    {entry.lesson_learned && (
                      <div className="bg-yellow-500/5 rounded-lg p-3">
                        <h4 className="text-xs sm:text-sm font-semibold text-yellow-400 mb-1.5">📚 What I Learned</h4>
                        <p className="text-sm text-gray-300 leading-relaxed">{entry.lesson_learned}</p>
                      </div>
                    )}

                    {entry.what_worked && (
                      <div className="bg-green-500/10 border border-green-600/30 rounded-lg p-3">
                        <h4 className="text-xs sm:text-sm font-semibold text-green-400 mb-1.5">✨ What Worked</h4>
                        <p className="text-sm text-gray-300 leading-relaxed">{entry.what_worked}</p>
                      </div>
                    )}

                    {entry.mistake_identified && (
                      <div className="bg-red-500/10 border border-red-600/30 rounded-lg p-3">
                        <h4 className="text-xs sm:text-sm font-semibold text-red-400 mb-1.5">⚠️ Mistake Identified</h4>
                        <p className="text-sm text-gray-300 leading-relaxed">{entry.mistake_identified}</p>
                      </div>
                    )}
                  </>
                )}

                <div className="grid grid-cols-3 gap-2 sm:gap-4 pt-3 border-t border-gray-700/50 mt-3">
                  <div className="bg-gray-700/30 rounded-lg p-2">
                    <span className="text-xs text-gray-500 block mb-1">Pattern</span>
                    <p className="text-xs sm:text-sm text-gray-300 font-medium truncate">{entry.pattern_identified || 'N/A'}</p>
                  </div>
                  <div className="bg-gray-700/30 rounded-lg p-2">
                    <span className="text-xs text-gray-500 block mb-1">Conviction</span>
                    <p className="text-xs sm:text-sm text-gray-300 font-medium">{entry.conviction_level ? `${entry.conviction_level}%` : 'N/A'}</p>
                  </div>
                  <div className="bg-gray-700/30 rounded-lg p-2">
                    <span className="text-xs text-gray-500 block mb-1">Rank</span>
                    <p className="text-xs sm:text-sm text-gray-300 font-medium capitalize truncate">{entry.rank_at_time || 'N/A'}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
