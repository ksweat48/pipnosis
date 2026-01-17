/**
 * Entry Urgency Phase Timer Component
 *
 * Real-time countdown timer showing current urgency phase and time until next phase transition.
 * Uses entryTimeDecayCoordinator as SSOT for phase logic.
 *
 * Features:
 * - Live MM:SS countdown to next phase
 * - Visual phase progression timeline
 * - Threshold decay meter
 * - Phase transition detection with visual feedback
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Clock, Zap, Timer, AlertCircle } from 'lucide-react';
import { entryTimeDecayCoordinator, UrgencyPhaseResult } from '../services/entry-time-decay-coordinator';
import type { EntryIntentData } from '../services/entry-intent-monitor-mode';

interface EntryUrgencyPhaseTimerProps {
  activeIntent: EntryIntentData;
}

export const EntryUrgencyPhaseTimer: React.FC<EntryUrgencyPhaseTimerProps> = ({ activeIntent }) => {
  const [urgencyResult, setUrgencyResult] = useState<UrgencyPhaseResult | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(0);
  const [previousPhase, setPreviousPhase] = useState<1 | 2 | 3 | null>(null);
  const [showPhaseTransition, setShowPhaseTransition] = useState(false);

  // Calculate urgency result from intent data
  const calculateUrgency = useCallback(async () => {
    const createdAt = new Date(activeIntent.created_at);
    const style = activeIntent.trade_style || activeIntent.style || 'MICRO_INTRADAY';

    const result = await entryTimeDecayCoordinator.calculateUrgencyPhase(
      style,
      createdAt
    );

    // Detect phase transition
    if (previousPhase !== null && previousPhase !== result.phase) {
      setShowPhaseTransition(true);
      setTimeout(() => setShowPhaseTransition(false), 2000);
    }

    setPreviousPhase(result.phase);
    setUrgencyResult(result);

    // Calculate seconds remaining to next phase
    if (result.minutesUntilNextPhase !== null) {
      const totalSeconds = Math.floor(result.minutesUntilNextPhase * 60);
      setSecondsRemaining(totalSeconds);
    } else {
      setSecondsRemaining(0);
    }
  }, [activeIntent, previousPhase]);

  // Update urgency calculation every 10 seconds and countdown every 1 second
  useEffect(() => {
    calculateUrgency();

    // Recalculate urgency every 10 seconds to stay in sync
    const urgencyInterval = setInterval(calculateUrgency, 10000);

    // Update countdown every 1 second
    const countdownInterval = setInterval(() => {
      setSecondsRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => {
      clearInterval(urgencyInterval);
      clearInterval(countdownInterval);
    };
  }, [calculateUrgency]);

  if (!urgencyResult) {
    return null;
  }

  const formatMMSS = (totalSeconds: number): string => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const getPhaseColors = (phase: 1 | 2 | 3) => {
    switch (phase) {
      case 1:
        return {
          bg: 'bg-blue-500/20',
          text: 'text-blue-400',
          border: 'border-blue-500/40',
          gradient: 'from-blue-500/30 to-blue-600/30',
        };
      case 2:
        return {
          bg: 'bg-yellow-500/20',
          text: 'text-yellow-400',
          border: 'border-yellow-500/40',
          gradient: 'from-yellow-500/30 to-yellow-600/30',
        };
      case 3:
        return {
          bg: 'bg-red-500/20',
          text: 'text-red-400',
          border: 'border-red-500/40',
          gradient: 'from-red-500/30 to-red-600/30',
        };
    }
  };

  const colors = getPhaseColors(urgencyResult.phase);
  const isWarning = secondsRemaining <= 120; // Less than 2 minutes
  const minutesElapsed = (Date.now() - new Date(activeIntent.created_at).getTime()) / 60000;

  return (
    <div
      className={`relative rounded-lg border-2 p-3 sm:p-4 transition-all duration-500 ${
        showPhaseTransition ? 'scale-105 shadow-lg' : 'scale-100'
      } ${colors.bg} ${colors.border} bg-gradient-to-br ${colors.gradient}`}
    >
      {/* Phase Transition Flash */}
      {showPhaseTransition && (
        <div className="absolute inset-0 bg-white/20 rounded-lg animate-pulse" />
      )}

      {/* Top: Phase Indicator and Countdown */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
        {/* Phase Badge */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg border-2 ${colors.border} ${colors.bg}`}>
            <Zap className={`w-4 h-4 sm:w-5 sm:h-5 ${colors.text} ${urgencyResult.phase === 3 ? 'animate-pulse' : ''}`} />
            <div>
              <div className="text-xs text-gray-400">Phase</div>
              <div className={`text-xl sm:text-2xl font-bold ${colors.text}`}>{urgencyResult.phase}</div>
            </div>
          </div>

          {/* Phase Description */}
          <div>
            <div className={`text-xs sm:text-sm font-semibold ${colors.text}`}>
              {urgencyResult.timeDescription}
            </div>
            <div className="text-xs text-gray-400">
              EQS: {urgencyResult.eqsThreshold}
            </div>
          </div>
        </div>

        {/* Countdown Timer */}
        <div className="flex flex-col items-end">
          <>
            <div className="text-xs text-gray-400 mb-1">
              {urgencyResult.minutesUntilNextPhase !== null ? 'Next Phase In' : 'Phase 3 Active'}
            </div>
            <div className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg border-2 ${
              isWarning ? 'bg-orange-500/30 border-orange-500 animate-pulse' : `${colors.bg} ${colors.border}`
            }`}>
              <Timer className={`w-4 h-4 sm:w-5 sm:h-5 ${isWarning ? 'text-orange-400' : colors.text}`} />
              <span className={`text-xl sm:text-3xl font-mono font-bold ${isWarning ? 'text-orange-400' : colors.text}`}>
                {formatMMSS(secondsRemaining)}
              </span>
            </div>
          </>
        </div>
      </div>

      {/* Phase Timeline */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-400">Phase Progression</span>
          <span className="text-xs text-gray-400">
            Elapsed: {formatMMSS(Math.floor(minutesElapsed * 60))}
          </span>
        </div>
        <div className="flex gap-1.5 sm:gap-2">
          {[1, 2, 3].map((phase) => (
            <div
              key={phase}
              className={`flex-1 h-1.5 sm:h-2 rounded-full transition-all duration-500 ${
                urgencyResult.phase >= phase
                  ? urgencyResult.phase === phase
                    ? `${colors.bg} border-2 ${colors.border}`
                    : 'bg-gray-600 border-2 border-gray-700'
                  : 'bg-gray-800 border border-gray-700'
              }`}
            />
          ))}
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-xs text-gray-500">Strict</span>
          <span className="text-xs text-gray-500">Relaxed</span>
          <span className="text-xs text-gray-500">Urgent</span>
        </div>
      </div>

      {/* Threshold Decay Meter */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-400">EQS Threshold</span>
          <span className={`text-xs sm:text-sm font-mono font-bold ${colors.text}`}>
            {urgencyResult.eqsThreshold}
          </span>
        </div>
        <div className="relative w-full h-2.5 sm:h-3 bg-gray-800 rounded-full border border-gray-700 overflow-hidden">
          {/* Current threshold indicator */}
          <div
            className={`absolute top-0 bottom-0 h-full transition-all duration-500 bg-gradient-to-r ${
              urgencyResult.phase === 1
                ? 'from-blue-500 to-blue-600'
                : urgencyResult.phase === 2
                ? 'from-yellow-500 to-yellow-600'
                : 'from-red-500 to-red-600'
            }`}
            style={{ width: `${Math.min(100, (urgencyResult.eqsThreshold / 70) * 100)}%` }}
          />
        </div>
        <div className="flex justify-between mt-1 text-xs text-gray-500">
          <span>Phase 1: 70</span>
          <span>Phase 2: 60</span>
          <span>Phase 3: 50</span>
        </div>
      </div>

      {/* Zone Tolerance Display */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-400">Entry Zone Tolerance</span>
          <span className={`text-xs sm:text-sm font-mono font-bold ${colors.text}`}>
            {urgencyResult.zoneTolerance === 0 ? 'Exact' : `±${urgencyResult.zoneTolerance}%`}
          </span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700">
          {urgencyResult.zoneTolerance === 0 ? (
            <div className="flex items-center gap-2 text-xs text-gray-300">
              <div className="w-2 h-2 rounded-full bg-blue-400" />
              <span>Must be exactly in zone</span>
            </div>
          ) : urgencyResult.phase === 2 ? (
            <div className="flex items-center gap-2 text-xs text-gray-300">
              <div className="w-2 h-2 rounded-full bg-yellow-400" />
              <span>Near zone acceptable (within {urgencyResult.zoneTolerance}% tolerance)</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-gray-300">
              <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
              <span>Continuation entries allowed (within {urgencyResult.zoneTolerance}% tolerance)</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
