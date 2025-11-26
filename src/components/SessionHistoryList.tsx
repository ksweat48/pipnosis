import React, { useState, useEffect } from 'react';
import { Calendar, TrendingUp, TrendingDown, ChevronRight, CheckCircle, XCircle } from 'lucide-react';
import { sessionIntelligenceService, SessionSummary } from '../services/session-intelligence-service';
import { useAuth } from '../hooks/useAuth';

interface SessionHistoryListProps {
  onSessionSelect: (sessionId: string) => void;
  selectedSessionId?: string;
}

export function SessionHistoryList({ onSessionSelect, selectedSessionId }: SessionHistoryListProps) {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterMonth, setFilterMonth] = useState<number | null>(null);

  useEffect(() => {
    if (user) {
      loadSessions();
    }
  }, [user]);

  const loadSessions = async () => {
    if (!user) return;

    setLoading(true);
    const sessionData = await sessionIntelligenceService.fetchAllSessions(user.id, 100);
    setSessions(sessionData);
    setLoading(false);
  };

  const filteredSessions = filterMonth
    ? sessions.filter(s => s.monthNumber === filterMonth)
    : sessions;

  const uniqueMonths = Array.from(new Set(sessions.map(s => s.monthNumber))).sort((a, b) => b - a);

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="ml-3 text-gray-300">Loading sessions...</span>
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="text-center text-gray-400">
          <Calendar className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-lg font-medium">No sessions yet</p>
          <p className="text-sm mt-1">Start a backtest to see your learning journey</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Learning Journey</h3>
            <p className="text-sm text-gray-400 mt-1">{sessions.length} sessions completed</p>
          </div>

          {/* Month Filter */}
          {uniqueMonths.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">Month:</span>
              <select
                value={filterMonth || 'all'}
                onChange={(e) => setFilterMonth(e.target.value === 'all' ? null : parseInt(e.target.value))}
                className="bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All</option>
                {uniqueMonths.map(month => (
                  <option key={month} value={month}>Month {month}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Session List */}
      <div className="max-h-[600px] overflow-y-auto">
        {filteredSessions.map((session) => (
          <button
            key={session.id}
            onClick={() => onSessionSelect(session.id)}
            className={`
              w-full px-6 py-4 border-b border-gray-700 transition-colors text-left
              ${selectedSessionId === session.id
                ? 'bg-blue-900/30 border-l-4 border-l-blue-500'
                : 'hover:bg-gray-750'
              }
            `}
          >
            <div className="flex items-start justify-between">
              {/* Left: Session Info */}
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  {/* Status Icon */}
                  {session.isProfitable ? (
                    <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                  )}

                  {/* Session Title */}
                  <div>
                    <h4 className="text-white font-medium">
                      Day {session.dayNumber}
                      {session.monthNumber > 1 && (
                        <span className="text-gray-400 text-sm ml-2">Month {session.monthNumber}</span>
                      )}
                    </h4>
                    <p className="text-xs text-gray-400">
                      {new Date(session.sessionDate).toLocaleDateString('en-US', {
                        weekday: 'short',
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </p>
                  </div>
                </div>

                {/* Key Learning (One-Liner) */}
                {session.keyLearnings && session.keyLearnings.length > 0 && (
                  <p className="text-sm text-gray-300 line-clamp-1 ml-8">
                    {session.keyLearnings[0]}
                  </p>
                )}
              </div>

              {/* Right: Metrics */}
              <div className="flex items-center gap-4 ml-4">
                {/* Win Rate */}
                <div className="text-center">
                  <div className={`text-lg font-bold ${
                    session.winRate >= 60 ? 'text-green-400' :
                    session.winRate >= 50 ? 'text-yellow-400' :
                    'text-red-400'
                  }`}>
                    {session.winRate.toFixed(0)}%
                  </div>
                  <div className="text-xs text-gray-400">WR</div>
                </div>

                {/* P&L */}
                <div className="text-center">
                  <div className={`text-lg font-bold flex items-center ${
                    session.pnl > 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {session.pnl > 0 ? <TrendingUp className="w-4 h-4 mr-1" /> : <TrendingDown className="w-4 h-4 mr-1" />}
                    {session.pnl > 0 ? '+' : ''}{session.pnl.toFixed(0)}
                  </div>
                  <div className="text-xs text-gray-400">P&L</div>
                </div>

                {/* Trades */}
                <div className="text-center">
                  <div className="text-lg font-bold text-gray-300">
                    {session.totalTrades}
                  </div>
                  <div className="text-xs text-gray-400">Trades</div>
                </div>

                <ChevronRight className="w-5 h-5 text-gray-500" />
              </div>
            </div>

            {/* LLM Analysis Indicator */}
            {session.llmDeepAnalysis && (
              <div className="ml-8 mt-2 flex items-center gap-1 text-xs text-blue-400">
                <div className="w-2 h-2 rounded-full bg-blue-400"></div>
                Deep AI analysis available
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
