/**
 * Trade Priority Score (TPS) Engine
 *
 * SSOT for TPS calculation and candidate evaluation.
 *
 * Core algorithm:
 * - TPS = (confidence × 0.62) + (readiness × 0.30) + (urgency × 0.08)
 * - EXECUTE_NOW absolute priority: if any execute_now candidate exists, all wait
 *   candidates are dropped before ranking. Confidence ranks within the surviving pool.
 * - Style-specific urgency decay curves
 * - Momentum-aware modifiers
 *
 * Entry mode priority hierarchy:
 * 1. EXECUTE_NOW — take this if available, always
 * 2. WAIT_ENTRY / WAIT_HIGHER_EDGE — only when zero execute_now candidates exist
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
 * Evaluate multiple candidates and select winner using EXECUTE_NOW absolute priority.
 *
 * Category-first selection rule:
 * - If ANY candidate has entryMode === 'EXECUTE_NOW', ALL wait candidates are dropped.
 * - Confidence (via TPS) ranks candidates within the surviving pool.
 * - Wait candidates are only considered when zero execute_now candidates are present.
 *
 * This is not percentage-based. execute_now always wins as a category, regardless
 * of the confidence gap between an execute_now and a wait candidate.
 *
 * @param candidates - Array of candidates to evaluate
 * @returns Comparison result with winner and runners-up
 */
export function evaluateMultipleCandidates(candidates: TPSCandidate[]): TPSComparisonResult {
  if (candidates.length === 0) {
    throw new Error('No candidates provided for TPS evaluation');
  }

  // Compute TPS for all candidates
  const allEvaluations = candidates.map(computeTPS).filter(e => e.scores.total > 0);

  if (allEvaluations.length === 0) {
    throw new Error('All candidates expired or invalid');
  }

  // EXECUTE_NOW ABSOLUTE PRIORITY FILTER
  const executeNowPool = allEvaluations.filter(e => e.candidate.entryMode === 'EXECUTE_NOW');
  const waitPool = allEvaluations.filter(e => e.candidate.entryMode !== 'EXECUTE_NOW');
  const hasExecuteNow = executeNowPool.length > 0;

  let evaluations: TPSEvaluation[];
  let categoryFilterReasoning = '';

  if (hasExecuteNow) {
    evaluations = executeNowPool;
    if (waitPool.length > 0) {
      categoryFilterReasoning = `EXECUTE_NOW_ABSOLUTE_PRIORITY: ${waitPool.length} wait candidate(s) dropped — execute_now pool has ${executeNowPool.length} tradeable option(s)`;
      logger.info('[TPS] EXECUTE_NOW absolute priority applied', {
        executeNowCount: executeNowPool.length,
        waitDropped: waitPool.length,
        droppedSymbols: waitPool.map(e => `${e.candidate.symbol}(${e.candidate.entryMode}:${e.candidate.tradeConfidence}%)`),
        survivingSymbols: executeNowPool.map(e => `${e.candidate.symbol}(${e.candidate.tradeConfidence}%)`),
      });
    } else {
      categoryFilterReasoning = `All ${executeNowPool.length} candidate(s) are execute_now — no wait candidates present`;
    }
  } else {
    evaluations = waitPool;
    categoryFilterReasoning = `No execute_now candidates — evaluating ${waitPool.length} wait candidate(s)`;
    logger.info('[TPS] No execute_now candidates, falling back to wait pool', {
      waitCount: waitPool.length,
      symbols: waitPool.map(e => `${e.candidate.symbol}(${e.candidate.entryMode}:${e.candidate.tradeConfidence}%)`),
    });
  }

  // Sort surviving pool by TPS descending (confidence dominates)
  evaluations.sort((a, b) => b.scores.total - a.scores.total);

  const winner = evaluations[0];
  const runnerUp = evaluations[1];
  const marginToSecondPlace = runnerUp ? winner.scores.total - runnerUp.scores.total : 0;

  const comparisonReasoning = runnerUp
    ? `${categoryFilterReasoning} | Winner: ${winner.candidate.symbol} TPS ${winner.scores.total.toFixed(1)} (margin +${marginToSecondPlace.toFixed(1)} over runner-up)`
    : `${categoryFilterReasoning} | Winner: ${winner.candidate.symbol} TPS ${winner.scores.total.toFixed(1)} (only candidate)`;

  return {
    winner,
    runners: evaluations.slice(1),
    marginToSecondPlace,
    patienceGateTriggered: false,
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

  // Evaluate all candidates and apply execute_now absolute priority
  const allEvals = candidates
    .map(computeTPS)
    .filter(e => e.scores.total > 0);

  const executeNowEvals = allEvals.filter(e => e.candidate.entryMode === 'EXECUTE_NOW');
  const waitEvals = allEvals.filter(e => e.candidate.entryMode !== 'EXECUTE_NOW');
  const hasExecuteNow = executeNowEvals.length > 0;

  if (hasExecuteNow && waitEvals.length > 0) {
    logger.info('[TPS] selectForTradeSlots: EXECUTE_NOW absolute priority applied', {
      executeNowCount: executeNowEvals.length,
      waitDropped: waitEvals.length,
    });
  }

  // Use execute_now pool if available, otherwise fall back to wait pool
  const evaluations = (hasExecuteNow ? executeNowEvals : waitEvals)
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
