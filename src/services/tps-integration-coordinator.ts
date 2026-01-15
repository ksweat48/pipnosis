/**
 * TPS Integration Coordinator
 *
 * SSOT for integrating TPS system with scan loop and entry monitoring.
 * Handles mode-aware scanning and candidate evaluation.
 *
 * Responsibilities:
 * - Check if scanning should proceed (mode-aware blocking)
 * - Collect all candidates (new scan + existing intents)
 * - Run TPS evaluation
 * - Select winners and assign to trade slots
 * - Create/update/cancel intents based on TPS results
 * - Store TPS metadata with intents
 */

import { supabase } from '../lib/supabase';
import type { AlphaDecision } from '../brains/coordinator-alpha';
import type { TPSCandidate, TPSComparisonData, TradeSlotAssignment } from '../types/tps';
import { logger } from '../lib/logger';
import {
  getTradeModeConfig,
  shouldBlockScanning,
  getAvailableSlots,
} from './trade-mode-manager';
import {
  convertAlphaDecisionToCandidate,
  getAllCandidates,
  getExistingIntentScores,
} from './trade-candidate-manager';
import {
  evaluateMultipleCandidates,
  selectForTradeSlots,
  logTPSEvaluation,
} from './trade-priority-score';

export interface TPSEvaluationResult {
  shouldProceed: boolean;
  winnerCandidates: TPSCandidate[];
  slotAssignments: TradeSlotAssignment[];
  comparisonData: TPSComparisonData;
  blockedReason?: string;
}

/**
 * Check if scanning should proceed based on trade mode and active monitors.
 *
 * @param sessionId - Goal session ID
 * @returns Object with shouldScan flag and reason
 */
export async function checkScanEligibility(sessionId: string): Promise<{
  shouldScan: boolean;
  reason: string;
}> {
  const modeConfig = await getTradeModeConfig(sessionId);
  const blocked = await shouldBlockScanning(sessionId);

  if (blocked) {
    if (modeConfig.mode === 'SINGLE') {
      return {
        shouldScan: false,
        reason: 'SINGLE mode: Monitoring active, blocking all scans',
      };
    } else {
      return {
        shouldScan: false,
        reason: `MULTI mode: All ${modeConfig.maxConcurrentTrades} slots filled`,
      };
    }
  }

  const availableSlots = await getAvailableSlots(sessionId);

  return {
    shouldScan: true,
    reason: `Scanning allowed: ${availableSlots} slots available (${modeConfig.mode} mode)`,
  };
}

/**
 * Evaluate new scan result with TPS system.
 * Handles both single and multi-trade modes.
 *
 * @param sessionId - Goal session ID
 * @param newDecision - New Alpha decision from scan
 * @param currentPrice - Current market price
 * @param atr - Current ATR value
 * @returns TPS evaluation result with winners
 */
export async function evaluateWithTPS(
  sessionId: string,
  newDecision: AlphaDecision,
  currentPrice: number,
  atr: number
): Promise<TPSEvaluationResult> {
  const modeConfig = await getTradeModeConfig(sessionId);

  logger.info('[TPSIntegration] Starting TPS evaluation', {
    sessionId,
    mode: modeConfig.mode,
    maxSlots: modeConfig.maxConcurrentTrades,
    newDecisionAction: newDecision.action,
  });

  // Single-trade mode: Simple evaluation (no multi-candidate comparison)
  if (modeConfig.mode === 'SINGLE') {
    return await evaluateSingleTradeMode(sessionId, newDecision, currentPrice, atr);
  }

  // Multi-trade mode: Comprehensive TPS evaluation with existing intents
  return await evaluateMultiTradeMode(sessionId, newDecision, currentPrice, atr, modeConfig.maxConcurrentTrades);
}

/**
 * Single-trade mode evaluation.
 * No TPS comparison, simple decision processing.
 */
async function evaluateSingleTradeMode(
  sessionId: string,
  newDecision: AlphaDecision,
  currentPrice: number,
  atr: number
): Promise<TPSEvaluationResult> {
  // Check if there's already a monitoring intent
  const { count } = await supabase
    .from('entry_intents')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('status', 'monitoring');

  if (count && count > 0) {
    return {
      shouldProceed: false,
      winnerCandidates: [],
      slotAssignments: [],
      comparisonData: {
        winnerScore: 0,
        candidatesEvaluated: 0,
        patienceGateApplied: false,
        evaluatedAt: new Date().toISOString(),
        reasoning: 'SINGLE mode: Monitoring already active',
      },
      blockedReason: 'SINGLE mode: Monitoring already active',
    };
  }

  // Convert to candidate for consistency
  const candidate = convertAlphaDecisionToCandidate(newDecision, sessionId, currentPrice, atr);

  // No comparison needed in single mode
  return {
    shouldProceed: true,
    winnerCandidates: [candidate],
    slotAssignments: [{
      slotNumber: 1,
      evaluation: {
        candidate,
        scores: { confidence: 0, readiness: 0, urgency: 0, total: 0 },
        reasoning: 'SINGLE mode: Direct acceptance',
        shouldExecute: newDecision.action !== 'WAIT',
        patienceGateApplied: false,
      },
    }],
    comparisonData: {
      winnerScore: 0,
      candidatesEvaluated: 1,
      patienceGateApplied: false,
      evaluatedAt: new Date().toISOString(),
      reasoning: 'SINGLE mode: No TPS comparison needed',
    },
  };
}

/**
 * Multi-trade mode evaluation with full TPS comparison.
 */
async function evaluateMultiTradeMode(
  sessionId: string,
  newDecision: AlphaDecision,
  currentPrice: number,
  atr: number,
  maxSlots: number
): Promise<TPSEvaluationResult> {
  // Collect all candidates (new + existing)
  const allCandidates = await getAllCandidates(sessionId, newDecision, currentPrice, atr);

  if (allCandidates.length === 0) {
    return {
      shouldProceed: false,
      winnerCandidates: [],
      slotAssignments: [],
      comparisonData: {
        winnerScore: 0,
        candidatesEvaluated: 0,
        patienceGateApplied: false,
        evaluatedAt: new Date().toISOString(),
        reasoning: 'No viable candidates',
      },
      blockedReason: 'No viable candidates',
    };
  }

  // Run TPS evaluation
  const tpsResult = evaluateMultipleCandidates(allCandidates);

  // Log evaluation
  logTPSEvaluation(tpsResult.winner, { sessionId, mode: 'MULTI' });
  for (const runner of tpsResult.runners) {
    logTPSEvaluation(runner, { sessionId, mode: 'MULTI', rank: 'runner' });
  }

  // Get existing intent scores for slot assignment
  const existingScores = await getExistingIntentScores(sessionId);

  // Determine slot assignments
  const availableSlots = await getAvailableSlots(sessionId);
  const slotAssignments = selectForTradeSlots(
    allCandidates,
    Math.min(availableSlots + existingScores.length, maxSlots),
    existingScores
  );

  // Extract winner candidates
  const winnerCandidates = slotAssignments.map(a => a.evaluation.candidate);

  const comparisonData: TPSComparisonData = {
    winnerScore: tpsResult.winner.scores.total,
    runnerUpScore: tpsResult.runners.length > 0 ? tpsResult.runners[0].scores.total : undefined,
    candidatesEvaluated: allCandidates.length,
    patienceGateApplied: tpsResult.patienceGateTriggered,
    evaluatedAt: new Date().toISOString(),
    reasoning: tpsResult.comparisonReasoning,
  };

  logger.info('[TPSIntegration] MULTI mode evaluation complete', {
    sessionId,
    totalCandidates: allCandidates.length,
    winnersSelected: winnerCandidates.length,
    patienceGate: tpsResult.patienceGateTriggered,
  });

  return {
    shouldProceed: true,
    winnerCandidates,
    slotAssignments,
    comparisonData,
  };
}

/**
 * Store TPS metadata with entry intent.
 *
 * @param intentId - Entry intent ID
 * @param slotAssignment - Slot assignment with TPS evaluation
 * @param comparisonData - TPS comparison data
 */
export async function storeTPSMetadata(
  intentId: string,
  slotAssignment: TradeSlotAssignment,
  comparisonData: TPSComparisonData
): Promise<void> {
  const { candidate, scores } = slotAssignment.evaluation;

  const { error } = await supabase
    .from('entry_intents')
    .update({
      tps_score: scores.total,
      tps_confidence_component: scores.confidence,
      tps_readiness_component: scores.readiness,
      tps_urgency_component: scores.urgency,
      entry_mode: candidate.entryMode,
      eqs_required: candidate.eqsRequired,
      momentum_state: candidate.momentumState,
      trade_slot: slotAssignment.slotNumber,
      tps_comparison_data: comparisonData,
    })
    .eq('id', intentId);

  if (error) {
    logger.error('[TPSIntegration] Failed to store TPS metadata', { intentId, error });
    throw new Error(`Failed to store TPS metadata: ${error.message}`);
  }

  logger.info('[TPSIntegration] TPS metadata stored', {
    intentId,
    tpsScore: scores.total,
    slot: slotAssignment.slotNumber,
  });
}

/**
 * Cancel intent that was replaced by higher-TPS candidate.
 *
 * @param intentId - Intent ID to cancel
 * @param reason - Cancellation reason
 */
export async function cancelReplacedIntent(intentId: string, reason: string): Promise<void> {
  const { error } = await supabase
    .from('entry_intents')
    .update({
      status: 'canceled',
      canceled_at: new Date().toISOString(),
      canceled_reason: reason,
    })
    .eq('id', intentId);

  if (error) {
    logger.error('[TPSIntegration] Failed to cancel replaced intent', { intentId, error });
    throw new Error(`Failed to cancel intent: ${error.message}`);
  }

  logger.info('[TPSIntegration] Intent canceled (replaced by higher TPS)', { intentId, reason });
}
