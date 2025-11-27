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
    <div className="space-y-4">
      <div className="bg-gray-800 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Brain className="w-6 h-6 text-blue-400" />
            <div>
              <h2 className="text-xl font-bold text-white">AI Trade Journal</h2>
              <p className="text-sm text-gray-400">Every decision explained in natural language</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded transition-colors ${filter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            >
              All
            </button>
            <button
              onClick={() => setFilter('win')}
              className={`px-4 py-2 rounded transition-colors ${filter === 'win' ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            >
              Wins
            </button>
            <button
              onClick={() => setFilter('loss')}
              className={`px-4 py-2 rounded transition-colors ${filter === 'loss' ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            >
              Losses
            </button>
          </div>
        </div>
      </div>

      {filteredEntries.length === 0 ? (
        <div className="bg-gray-800 rounded-lg p-12 text-center">
          <Brain className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-white mb-2">No Journal Entries Yet</h3>
          <p className="text-gray-400 mb-4">
            Your AI will start documenting its reasoning as soon as you take trades.
          </p>
          <p className="text-sm text-gray-500">
            Every trade decision, market analysis, and lesson learned will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredEntries.map((entry) => (
            <div
              key={entry.id}
              className="bg-gray-800 rounded-lg p-6 border-l-4 hover:bg-gray-750 transition-colors"
              style={{
                borderColor: entry.outcome === 'win' ? '#10b981' : entry.outcome === 'loss' ? '#ef4444' : '#6b7280'
              }}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  {entry.outcome === 'win' ? (
                    <CheckCircle className="w-6 h-6 text-green-500" />
                  ) : entry.outcome === 'loss' ? (
                    <XCircle className="w-6 h-6 text-red-500" />
                  ) : entry.outcome === 'open' ? (
                    <AlertCircle className="w-6 h-6 text-blue-500" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-gray-600" />
                  )}
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      {entry.symbol} {entry.direction.toUpperCase()}
                    </h3>
                    <p className="text-sm text-gray-400">
                      {new Date(entry.entry_time).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className={`text-2xl font-bold ${entry.pnl > 0 ? 'text-green-400' : entry.pnl < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                  {entry.outcome === 'open' ? 'OPEN' : `${entry.pnl > 0 ? '+' : ''}$${entry.pnl?.toFixed(2) || '0.00'}`}
                </div>
              </div>

              <div className="space-y-3">
                {entry.llm_reasoning && (
                  <div>
                    <h4 className="text-sm font-semibold text-blue-400 mb-1">💭 Why I Took This Trade</h4>
                    <p className="text-gray-300">{entry.llm_reasoning}</p>
                  </div>
                )}

                {entry.market_read && (
                  <div>
                    <h4 className="text-sm font-semibold text-blue-400 mb-1">📊 Market Analysis</h4>
                    <p className="text-gray-300">{entry.market_read}</p>
                  </div>
                )}

                {entry.expected_outcome && (
                  <div>
                    <h4 className="text-sm font-semibold text-blue-400 mb-1">🎯 What I Expected</h4>
                    <p className="text-gray-300">{entry.expected_outcome}</p>
                  </div>
                )}

                {entry.exit_time && (
                  <>
                    <hr className="border-gray-700 my-4" />

                    {entry.actual_outcome && (
                      <div>
                        <h4 className="text-sm font-semibold text-yellow-400 mb-1">📈 What Actually Happened</h4>
                        <p className="text-gray-300">{entry.actual_outcome}</p>
                      </div>
                    )}

                    {entry.was_prediction_correct !== null && (
                      <div>
                        <h4 className="text-sm font-semibold text-yellow-400 mb-1">
                          {entry.was_prediction_correct ? '✅ Prediction: Correct' : '❌ Prediction: Incorrect'}
                          {entry.accuracy_score && ` (${entry.accuracy_score.toFixed(0)}% accuracy)`}
                        </h4>
                      </div>
                    )}

                    {entry.lesson_learned && (
                      <div>
                        <h4 className="text-sm font-semibold text-yellow-400 mb-1">📚 What I Learned</h4>
                        <p className="text-gray-300">{entry.lesson_learned}</p>
                      </div>
                    )}

                    {entry.what_worked && (
                      <div className="bg-green-900/20 border border-green-700 rounded p-3">
                        <h4 className="text-sm font-semibold text-green-400 mb-1">✨ What Worked</h4>
                        <p className="text-gray-300">{entry.what_worked}</p>
                      </div>
                    )}

                    {entry.mistake_identified && (
                      <div className="bg-red-900/20 border border-red-700 rounded p-3">
                        <h4 className="text-sm font-semibold text-red-400 mb-1">⚠️ Mistake Identified</h4>
                        <p className="text-gray-300">{entry.mistake_identified}</p>
                      </div>
                    )}
                  </>
                )}

                <div className="grid grid-cols-3 gap-4 pt-3 border-t border-gray-700">
                  <div>
                    <span className="text-xs text-gray-500">Pattern</span>
                    <p className="text-sm text-gray-300">{entry.pattern_identified || 'N/A'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Conviction</span>
                    <p className="text-sm text-gray-300">{entry.conviction_level ? `${entry.conviction_level}%` : 'N/A'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Rank</span>
                    <p className="text-sm text-gray-300 capitalize">{entry.rank_at_time || 'N/A'}</p>
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
