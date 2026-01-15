/**
 * TPS Comparison Card
 *
 * Displays transparent comparison of multiple trading opportunities with TPS scores.
 * Shows why the selected opportunity was chosen over alternatives.
 * Only visible during monitoring, hidden once trade executes.
 */

import React from 'react';
import { TrendingUp, Clock, Target, Award } from 'lucide-react';

export interface TPSCandidateDisplay {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryMode: 'EXECUTE_NOW' | 'WAIT_ENTRY' | 'WAIT_HIGHER_EDGE';
  tpsScore: number;
  confidenceScore: number;
  readinessScore: number;
  urgencyScore: number;
  isWinner: boolean;
  rank?: number;
}

interface Props {
  candidates: TPSCandidateDisplay[];
  patienceGateApplied: boolean;
  comparisonReasoning: string;
  visible: boolean;
}

/**
 * Format entry mode into readable text.
 */
function formatEntryMode(mode: string): string {
  switch (mode) {
    case 'EXECUTE_NOW':
      return 'Execute Now';
    case 'WAIT_ENTRY':
      return 'Wait for Entry';
    case 'WAIT_HIGHER_EDGE':
      return 'Wait for Higher Edge';
    default:
      return mode;
  }
}

/**
 * Get color classes based on rank/winner status.
 */
function getRankColor(isWinner: boolean, rank?: number): string {
  if (isWinner) return 'border-green-500/50 bg-green-900/20';
  if (rank === 2) return 'border-yellow-500/30 bg-yellow-900/10';
  return 'border-gray-600/30 bg-gray-800/20';
}

/**
 * TPS score bar component.
 */
function TPSScoreBar({ score, maxScore = 100, label }: { score: number; maxScore?: number; label: string }) {
  const percentage = (score / maxScore) * 100;
  const color = percentage >= 70 ? 'bg-green-500' : percentage >= 50 ? 'bg-yellow-500' : 'bg-blue-500';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className="text-white font-medium">{score.toFixed(1)}</span>
      </div>
      <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} transition-all duration-300`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
    </div>
  );
}

export function TPSComparisonCard({ candidates, patienceGateApplied, comparisonReasoning, visible }: Props) {
  if (!visible || candidates.length === 0) {
    return null;
  }

  // Sort candidates by TPS score (winner first)
  const sortedCandidates = [...candidates].sort((a, b) => {
    if (a.isWinner) return -1;
    if (b.isWinner) return 1;
    return b.tpsScore - a.tpsScore;
  });

  const winner = sortedCandidates[0];
  const runners = sortedCandidates.slice(1);

  return (
    <div className="bg-gradient-to-br from-purple-900/30 to-blue-900/20 border border-purple-500/30 rounded-lg p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-500/20 rounded-full flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">Opportunity Comparison</h3>
            <p className="text-xs text-gray-400">
              {candidates.length} candidate{candidates.length !== 1 ? 's' : ''} evaluated
              {patienceGateApplied && <span className="text-yellow-400 ml-1">• Patience gate applied</span>}
            </p>
          </div>
        </div>
      </div>

      {/* Winner Card */}
      <div className={`border-2 rounded-lg p-4 space-y-3 ${getRankColor(true)}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-green-400" />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-white font-semibold">{winner.symbol}</span>
                <span className={winner.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}>
                  {winner.direction === 'LONG' ? '📈' : '📉'}
                </span>
              </div>
              <p className="text-xs text-gray-400">{formatEntryMode(winner.entryMode)}</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-green-400">{winner.tpsScore.toFixed(1)}</div>
            <div className="text-xs text-gray-400">TPS Score</div>
          </div>
        </div>

        {/* Score Breakdown */}
        <div className="space-y-2 pt-2 border-t border-green-500/20">
          <TPSScoreBar score={winner.confidenceScore} maxScore={62} label="Confidence (62%)" />
          <TPSScoreBar score={winner.readinessScore} maxScore={30} label="Readiness (30%)" />
          <TPSScoreBar score={winner.urgencyScore} maxScore={15} label="Urgency (8%)" />
        </div>
      </div>

      {/* Runner-ups (if any) */}
      {runners.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide">Alternatives Considered</h4>
          {runners.slice(0, 2).map((candidate, idx) => (
            <div
              key={idx}
              className={`border rounded p-3 space-y-2 ${getRankColor(false, idx + 2)}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="text-sm text-gray-400">#{idx + 2}</div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-white font-medium text-sm">{candidate.symbol}</span>
                      <span className={candidate.direction === 'LONG' ? 'text-green-400 text-xs' : 'text-red-400 text-xs'}>
                        {candidate.direction === 'LONG' ? '↑' : '↓'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">{formatEntryMode(candidate.entryMode)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold text-gray-300">{candidate.tpsScore.toFixed(1)}</div>
                  <div className="text-xs text-gray-500">
                    -{(winner.tpsScore - candidate.tpsScore).toFixed(1)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reasoning */}
      {comparisonReasoning && (
        <div className="bg-purple-900/20 border border-purple-500/20 rounded p-3">
          <p className="text-xs text-gray-300">{comparisonReasoning}</p>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-500 pt-2 border-t border-gray-700">
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          <span>TPS = Trade Priority Score</span>
        </div>
        <div className="flex items-center gap-1">
          <Target className="w-3 h-3" />
          <span>Higher score = Better opportunity</span>
        </div>
      </div>
    </div>
  );
}
