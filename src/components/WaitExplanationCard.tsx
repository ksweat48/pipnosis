/**
 * Wait Explanation Card
 *
 * Displays clear, confidence-building messaging when Alpha chooses to WAIT for better entry conditions.
 * Shows why waiting is superior to immediate execution with TPS comparison data.
 */

import React from 'react';
import { Clock, TrendingUp, Target, AlertCircle } from 'lucide-react';

export interface WaitExplanation {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  eqsNow: number;
  eqsRequired: number;
  eqsProjected?: number;
  projectionConfidence?: number;
  eqsFocus: string[];
  runawayPolicy: 'RESCAN' | 'EXECUTE_ON_FIRST_PULLBACK';
  minutesWaiting: number;
  tpsScore: number;
  alternativeNowScore?: number;
}

interface Props {
  explanation: WaitExplanation;
  onCancel?: () => void;
}

/**
 * Format EQS focus items into readable descriptions.
 */
function formatFocusItem(item: string): string {
  const mapping: Record<string, string> = {
    pullback_quality: 'Better price pullback depth',
    vwap_interaction: 'VWAP touch/reaction confirmation',
    ema_alignment: 'EMA convergence for support',
    liquidity_reaction: 'Liquidity level sweep/reclaim',
    compression_expansion: 'Price consolidation before move',
    failed_move: 'Rejection candle confirmation',
    timeframe_alignment: 'Higher timeframe confirmation',
  };
  return mapping[item] || item;
}

export function WaitExplanationCard({ explanation, onCancel }: Props) {
  const directionColor = explanation.direction === 'LONG' ? 'text-green-400' : 'text-red-400';
  const directionEmoji = explanation.direction === 'LONG' ? '📈' : '📉';

  const eqsProgress = (explanation.eqsNow / explanation.eqsRequired) * 100;
  const hasProjection = explanation.eqsProjected && explanation.projectionConfidence;

  return (
    <div className="bg-gradient-to-br from-blue-900/40 to-blue-800/30 border border-blue-500/30 rounded-lg p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-500/20 rounded-full flex items-center justify-center">
            <Clock className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">
              Waiting for Higher Edge Setup
            </h3>
            <p className="text-sm text-gray-400">
              {explanation.symbol} {directionEmoji} {explanation.direction}
            </p>
          </div>
        </div>
        {onCancel && (
          <button
            onClick={onCancel}
            className="px-3 py-1 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Entry Quality Progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-300">Entry Quality</span>
          <span className="text-white font-medium">
            {explanation.eqsNow}/{explanation.eqsRequired}
            {hasProjection && (
              <span className="text-blue-400 ml-2">
                → {explanation.eqsProjected} ({explanation.projectionConfidence}% conf)
              </span>
            )}
          </span>
        </div>
        <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-yellow-500 to-blue-500 transition-all duration-500"
            style={{ width: `${Math.min(eqsProgress, 100)}%` }}
          />
        </div>
        <p className="text-xs text-gray-400">
          {eqsProgress >= 100
            ? 'Quality threshold met - Waiting for optimal conditions'
            : `${(100 - eqsProgress).toFixed(0)}% improvement needed`}
        </p>
      </div>

      {/* Key Improvements We're Waiting For */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-300">
          <Target className="w-4 h-4 text-blue-400" />
          <span>Waiting For:</span>
        </div>
        <div className="space-y-1">
          {explanation.eqsFocus.slice(0, 5).map((focus, idx) => (
            <div key={idx} className="flex items-start gap-2 text-sm">
              <span className="text-blue-400 mt-0.5">•</span>
              <span className="text-gray-300">{formatFocusItem(focus)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* TPS Comparison (Why WAIT beats NOW) */}
      {explanation.alternativeNowScore && (
        <div className="bg-blue-900/30 border border-blue-500/20 rounded p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-300">
            <TrendingUp className="w-4 h-4" />
            <span>Why This Beats Immediate Execution</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <div className="space-y-1">
              <div className="text-gray-400">
                WAIT Score: <span className="text-white font-semibold">{explanation.tpsScore.toFixed(1)}</span>
              </div>
              <div className="text-gray-400">
                NOW Score: <span className="text-gray-300">{explanation.alternativeNowScore.toFixed(1)}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-green-400 font-semibold">
                +{(explanation.tpsScore - explanation.alternativeNowScore).toFixed(1)}
              </div>
              <div className="text-xs text-gray-400">advantage</div>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Patience gate applied: Waiting provides significantly better risk/reward
          </p>
        </div>
      )}

      {/* Runaway Policy */}
      <div className="flex items-start gap-2 text-xs text-gray-400 bg-gray-800/40 rounded p-2">
        <AlertCircle className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
        <span>
          {explanation.runawayPolicy === 'RESCAN'
            ? 'If price runs away, we will rescan for new opportunities automatically'
            : 'If price runs away, we will execute on the first pullback (continuation entry)'}
        </span>
      </div>

      {/* Time Tracking */}
      <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t border-gray-700">
        <span>Monitoring for {explanation.minutesWaiting} minutes</span>
        <span>Checking conditions every 3 seconds</span>
      </div>
    </div>
  );
}
