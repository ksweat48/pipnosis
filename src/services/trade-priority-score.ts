/**
 * Trade Priority Score (TPS) Engine
 *
 * SSOT for TPS calculation and candidate evaluation.
 * Implements intelligent EXECUTE_NOW vs WAIT arbitration with patience gates.
 *
 * Core algorithm:
 * - TPS = (confidence × 0.62) + (readiness × 0.30) + (urgency × 0.08)
 * - Patience gate: WAIT must beat NOW by margin to prevent premature execution
 * - Style-specific urgency decay curves
 * - Momentum-aware modifiers
 */

import type {
  TPSCandidate,
  TPSEvaluation,
  TPSScoreComponents,
  TPSComparisonResult,
  TradeSlotAssignment,
} from '../types/tps';
import {
  TPS_WEIGHTS,
  READINESS_THRESHOLDS,
  calculateUrgency,
  isIntentExpired,
  getPatienceGateMargin,
} from '../config/tps-urgency-curves';
import { logger } from '../lib/logger';

/**
 * Calculate entry readiness score based on EQS satisfaction.
 *
 * Readiness logic:
 * - EXECUTE_NOW: If EQS >= required, score 30. Otherwise scale from 0-30.
 * - WAIT: If EQS >= required, score 30. Add projection bonus if improving.
 *
 * @param candidate - TPS candidate to evaluate
 * @returns Readiness score (0-30 + projection bonus)
 */
function calculateReadiness(candidate: TPSCandidate): number {
  const { eqsNow, eqsRequired, eqsProjected, projectionConfidence, entryMode } = candidate;

  // For EXECUTE_NOW
  if (entryMode === 'EXECUTE_NOW') {
    if (eqsNow >= eqsRequired) {
      return 30;
    }
    // Partial readiness: scale from 0 to 30 based on how close we are
    const fraction = eqsNow / eqsRequired;
    if (fraction >= READINESS_THRESHOLDS.partialReadinessStart) {
      return 30 * ((fraction - READINESS_THRESHOLDS.partialReadinessStart) / (1 - READINESS_THRESHOLDS.partialReadinessStart));
    }
    return 0;
  }

  // For WAIT modes
  if (eqsNow >= eqsRequired) {
    // Already at threshold
    return 30;
  }

  // Check projection
  if (eqsProjected && projectionConfidence && eqsProjected >= eqsRequired) {
    // Give credit for improvement trajectory
    const projectionBonus = READINESS_THRESHOLDS.improvementProjectionBonus +
      (projectionConfidence / 100) * READINESS_THRESHOLDS.maxProjectionBonus;

    // Base partial score + projection bonus
    const fraction = eqsNow / eqsRequired;
    const baseScore = fraction >= READINESS_THRESHOLDS.partialReadinessStart
      ? 30 * ((fraction - READINESS_THRESHOLDS.partialReadinessStart) / (1 - READINESS_THRESHOLDS.partialReadinessStart))
      : 0;

    return Math.min(30, baseScore + projectionBonus);
  }

  // Partial credit for current EQS
  const fraction = eqsNow / eqsRequired;
  if (fraction >= READINESS_THRESHOLDS.partialReadinessStart) {
    return 30 * ((fraction - READINESS_THRESHOLDS.partialReadinessStart) / (1 - READINESS_THRESHOLDS.partialReadinessStart));
  }

  return 0;
}

/**
 * Compute complete TPS score for a candidate.
 *
 * @param candidate - Candidate to score
 * @returns TPS evaluation with score components and reasoning
 */
export function computeTPS(candidate: TPSCandidate): TPSEvaluation {
  // Check expiration first
  if (isIntentExpired(candidate.minutesSinceSignal, candidate.style)) {
    return {
      candidate,
      scores: { confidence: 0, readiness: 0, urgency: 0, total: 0 },
      reasoning: `Intent expired after ${candidate.minutesSinceSignal} minutes (${candidate.style} limit exceeded)`,
      shouldExecute: false,
      patienceGateApplied: false,
    };
  }

  // Calculate components
  const confidenceScore = candidate.tradeConfidence * TPS_WEIGHTS.confidence;
  const readinessScore = calculateReadiness(candidate) * TPS_WEIGHTS.readiness;
  const urgencyScore = calculateUrgency(
    candidate.minutesSinceSignal,
    candidate.style,
    candidate.momentumState
  ) * TPS_WEIGHTS.urgency;

  const totalScore = confidenceScore + readinessScore + urgencyScore;

  const scores: TPSScoreComponents = {
    confidence: confidenceScore,
    readiness: readinessScore,
    urgency: urgencyScore,
    total: totalScore,
  };

  // Generate reasoning
  const reasoning = [
    `TPS ${totalScore.toFixed(1)}:`,
    `Confidence ${confidenceScore.toFixed(1)} (${candidate.tradeConfidence}% × 0.62)`,
    `Readiness ${readinessScore.toFixed(1)} (EQS ${candidate.eqsNow}/${candidate.eqsRequired})`,
    `Urgency ${urgencyScore.toFixed(1)} (${candidate.minutesSinceSignal}min, ${candidate.momentumState})`,
  ].join(' | ');

  return {
    candidate,
    scores,
    reasoning,
    shouldExecute: candidate.entryMode === 'EXECUTE_NOW',
    patienceGateApplied: false,
  };
}

/**
 * Evaluate multiple candidates and select winner(s) with patience gate.
 *
 * Patience gate logic:
 * - If WAIT has higher TPS than NOW by required margin → choose WAIT
 * - If NOW has higher TPS or WAIT margin insufficient → choose NOW
 * - Margin requirement varies by momentum state
 *
 * @param candidates - Array of candidates to evaluate
 * @returns Comparison result with winner and runners-up
 */
export function evaluateMultipleCandidates(candidates: TPSCandidate[]): TPSComparisonResult {
  if (candidates.length === 0) {
    throw new Error('No candidates provided for TPS evaluation');
  }

  // Compute TPS for all candidates
  const evaluations = candidates.map(computeTPS).filter(e => e.scores.total > 0);

  if (evaluations.length === 0) {
    throw new Error('All candidates expired or invalid');
  }

  // Sort by TPS descending
  evaluations.sort((a, b) => b.scores.total - a.scores.total);

  const topCandidate = evaluations[0];
  const runnerUp = evaluations[1];

  // Apply patience gate if we have both NOW and WAIT candidates
  const hasNow = evaluations.some(e => e.candidate.entryMode === 'EXECUTE_NOW');
  const hasWait = evaluations.some(e => e.candidate.entryMode !== 'EXECUTE_NOW');

  let patienceGateTriggered = false;
  let winner = topCandidate;
  let comparisonReasoning = topCandidate.reasoning;

  if (hasNow && hasWait && runnerUp) {
    // Find top NOW and top WAIT
    const topNow = evaluations.find(e => e.candidate.entryMode === 'EXECUTE_NOW');
    const topWait = evaluations.find(e => e.candidate.entryMode !== 'EXECUTE_NOW');

    if (topNow && topWait) {
      const margin = Math.abs(topWait.scores.total - topNow.scores.total);
      const requiredMargin = getPatienceGateMargin(topCandidate.candidate.momentumState);

      // Check if WAIT wins with sufficient margin
      if (topWait.scores.total > topNow.scores.total) {
        if (margin >= requiredMargin) {
          // WAIT wins with sufficient margin
          winner = topWait;
          patienceGateTriggered = true;
          comparisonReasoning = `WAIT selected: TPS ${topWait.scores.total.toFixed(1)} beats NOW ${topNow.scores.total.toFixed(1)} by ${margin.toFixed(1)} (required: ${requiredMargin})`;
          logger.info('[TPS] Patience gate: WAIT wins', {
            waitScore: topWait.scores.total,
            nowScore: topNow.scores.total,
            margin,
            requiredMargin,
          });
        } else {
          // WAIT has higher score but insufficient margin → execute NOW
          winner = topNow;
          patienceGateTriggered = true;
          comparisonReasoning = `NOW executed: WAIT margin ${margin.toFixed(1)} < required ${requiredMargin} (momentum: ${topCandidate.candidate.momentumState})`;
          logger.info('[TPS] Patience gate: Insufficient margin, executing NOW', {
            waitScore: topWait.scores.total,
            nowScore: topNow.scores.total,
            margin,
            requiredMargin,
          });
        }
      } else {
        // NOW has higher score
        winner = topNow;
        comparisonReasoning = `NOW wins: TPS ${topNow.scores.total.toFixed(1)} > WAIT ${topWait.scores.total.toFixed(1)}`;
      }
    }
  }

  const marginToSecondPlace = runnerUp
    ? winner.scores.total - runnerUp.scores.total
    : 0;

  return {
    winner,
    runners: evaluations.slice(1),
    marginToSecondPlace,
    patienceGateTriggered,
    comparisonReasoning,
  };
}

/**
 * Select best candidates for available trade slots (multi-trade mode).
 *
 * @param candidates - All candidates to consider
 * @param availableSlots - Number of slots available (1-3)
 * @param existingIntents - Currently active intents with their slot assignments
 * @returns Array of slot assignments, may include replacements
 */
export function selectForTradeSlots(
  candidates: TPSCandidate[],
  availableSlots: number,
  existingIntents: Array<{ intentId: string; slotNumber: number; tpsScore: number }>
): TradeSlotAssignment[] {
  if (availableSlots < 1 || availableSlots > 3) {
    throw new Error(`Invalid availableSlots: ${availableSlots}, must be 1-3`);
  }

  // Evaluate all candidates
  const evaluations = candidates
    .map(computeTPS)
    .filter(e => e.scores.total > 0)
    .sort((a, b) => b.scores.total - a.scores.total);

  const assignments: TradeSlotAssignment[] = [];
  const usedSlots = new Set<number>();

  // First, preserve existing intents that still score well
  for (const existing of existingIntents) {
    usedSlots.add(existing.slotNumber);
  }

  // Assign new winners to slots
  for (let i = 0; i < Math.min(evaluations.length, availableSlots); i++) {
    const evaluation = evaluations[i];

    // Find an available slot or replace weakest existing
    let slotNumber = i + 1;
    let replacedIntentId: string | undefined;

    // Check if this new candidate should replace an existing one
    const weakestExisting = existingIntents
      .sort((a, b) => a.tpsScore - b.tpsScore)
      .find(e => evaluation.scores.total > e.tpsScore + 5); // Require 5 point margin to replace

    if (weakestExisting && usedSlots.has(weakestExisting.slotNumber)) {
      slotNumber = weakestExisting.slotNumber;
      replacedIntentId = weakestExisting.intentId;
      logger.info('[TPS] Replacing lower-scoring intent', {
        slot: slotNumber,
        oldScore: weakestExisting.tpsScore,
        newScore: evaluation.scores.total,
        symbol: evaluation.candidate.symbol,
      });
    } else {
      // Find first available slot
      for (let s = 1; s <= availableSlots; s++) {
        if (!usedSlots.has(s)) {
          slotNumber = s;
          break;
        }
      }
    }

    usedSlots.add(slotNumber);
    assignments.push({
      slotNumber,
      evaluation,
      replacedIntentId,
    });
  }

  return assignments;
}

/**
 * Log TPS evaluation for debugging and audit.
 *
 * @param evaluation - TPS evaluation to log
 * @param context - Additional context
 */
export function logTPSEvaluation(evaluation: TPSEvaluation, context?: Record<string, unknown>): void {
  logger.info('[TPS] Evaluation complete', {
    symbol: evaluation.candidate.symbol,
    direction: evaluation.candidate.direction,
    style: evaluation.candidate.style,
    entryMode: evaluation.candidate.entryMode,
    tpsTotal: evaluation.scores.total.toFixed(1),
    confidence: evaluation.scores.confidence.toFixed(1),
    readiness: evaluation.scores.readiness.toFixed(1),
    urgency: evaluation.scores.urgency.toFixed(1),
    reasoning: evaluation.reasoning,
    patienceGate: evaluation.patienceGateApplied,
    ...context,
  });
}
