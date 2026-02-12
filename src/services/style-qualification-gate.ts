/**
 * Style Qualification Gate Service
 *
 * AUTHORITY: HARD ENFORCEMENT
 * This service enforces style execution contracts. It validates that a trade's
 * characteristics (duration, momentum, consensus, targets) match the selected style.
 *
 * CRITICAL DISTINCTION:
 * - Alpha has AUTHORITY to choose direction, timing, and specific parameters
 * - Alpha does NOT have authority to REDEFINE what a style means
 * - SCALP must execute like SCALP (M5 reality, 15-60 min duration)
 * - INTRADAY must execute like INTRADAY (H1 reality, 2-10 hour duration)
 *
 * ENFORCEMENT LOGIC:
 * 1. Expected Fill Time validation (style duration contracts)
 * 2. Omega Consensus validation (minimum agreement threshold)
 * 3. ATR Gate validation (volatility appropriateness)
 * 4. Target/Stop appropriateness (style swing size contracts)
 *
 * Rejected trades are logged to `style_gate_blocks` table for governance tracking.
 */

import { logger, LogCategory } from '../lib/logger';
import { supabaseAdmin } from '../lib/supabase-admin';
import { ALPHA_IDENTITY } from '../config/alpha-identity';
import { getAtrGate } from '../config/trade-constraints';
import type { TradeStyle } from '../types';

export interface StyleQualificationInput {
  symbol: string;
  style: TradeStyle;
  assetClass: 'FOREX' | 'CRYPTO' | 'METAL' | 'INDEX';

  // Duration validation
  expectedFillTimeHours: number;

  // Consensus validation
  omegaConsensusPercent: number; // Real Omega voting consensus
  alphaFinalConfidence: number; // Alpha's inflated confidence

  // Volatility validation
  atrPercent: number;

  // Target/Stop validation
  targetPips: number;
  stopPips: number;

  // Context
  sessionId?: string;
  userId?: string;
  goalAmount?: number;
}

export interface StyleQualificationResult {
  qualified: boolean;
  blockReason?: string;
  violations: StyleViolation[];
  advisory?: string;
}

export interface StyleViolation {
  type: 'DURATION' | 'CONSENSUS' | 'ATR_GATE' | 'TARGET_SIZE' | 'STOP_SIZE';
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  actual: number;
  required: number;
  detail: string;
}

/**
 * Style Execution Contracts - SSOT for style duration/target boundaries
 * These define what each style IS, not what Alpha prefers.
 */
const STYLE_CONTRACTS = {
  SCALP: {
    name: 'M5 Momentum Scalp',
    minFillTimeMinutes: 5,
    maxFillTimeMinutes: 60,
    typicalDurationMinutes: '15-60',
    minTargetPips: { FOREX: 10, CRYPTO: 30, METAL: 10, INDEX: 15 },
    maxTargetPips: { FOREX: 60, CRYPTO: 150, METAL: 60, INDEX: 80 },
    minStopPips: { FOREX: 5, CRYPTO: 15, METAL: 5, INDEX: 8 },
    maxStopPips: { FOREX: 25, CRYPTO: 80, METAL: 25, INDEX: 35 },
    minOmegaConsensus: 40, // At least 40% Omega agreement for SCALP
    description: 'M5 chart execution, captures ONE M5 swing leg, 3-5 candles'
  },
  MICRO_INTRADAY: {
    name: 'M15/H1 Structure',
    minFillTimeMinutes: 30,
    maxFillTimeMinutes: 240,
    typicalDurationMinutes: '60-240',
    minTargetPips: { FOREX: 30, CRYPTO: 80, METAL: 30, INDEX: 40 },
    maxTargetPips: { FOREX: 120, CRYPTO: 300, METAL: 120, INDEX: 150 },
    minStopPips: { FOREX: 15, CRYPTO: 40, METAL: 15, INDEX: 20 },
    maxStopPips: { FOREX: 50, CRYPTO: 150, METAL: 50, INDEX: 70 },
    minOmegaConsensus: 35, // 35% for MICRO_INTRADAY
    description: 'M15/H1 structure, 2-3 M15 swings, 1-4 hours'
  },
  INTRADAY: {
    name: 'H1 Price Action',
    minFillTimeMinutes: 120,
    maxFillTimeMinutes: 600,
    typicalDurationMinutes: '120-600',
    minTargetPips: { FOREX: 50, CRYPTO: 150, METAL: 50, INDEX: 60 },
    maxTargetPips: { FOREX: 200, CRYPTO: 500, METAL: 200, INDEX: 250 },
    minStopPips: { FOREX: 25, CRYPTO: 80, METAL: 25, INDEX: 30 },
    maxStopPips: { FOREX: 80, CRYPTO: 250, METAL: 80, INDEX: 100 },
    minOmegaConsensus: 30, // 30% for longer-term INTRADAY
    description: 'H1 chart execution, full H1 swing or liquidity pool, 2-10 hours'
  }
} as const;

/**
 * Validate if a trade qualifies for its selected style
 * Returns qualification result with violations and block reasons
 */
export async function validateStyleQualification(
  input: StyleQualificationInput
): Promise<StyleQualificationResult> {
  logger.info(
    LogCategory.AI_TRADING,
    `[Style Gate] Validating ${input.symbol} ${input.style} trade qualification`
  );

  const violations: StyleViolation[] = [];
  const contract = STYLE_CONTRACTS[input.style];

  // VALIDATION 1: Expected Fill Time (CRITICAL)
  const expectedFillMinutes = input.expectedFillTimeHours * 60;
  if (
    expectedFillMinutes < contract.minFillTimeMinutes ||
    expectedFillMinutes > contract.maxFillTimeMinutes
  ) {
    violations.push({
      type: 'DURATION',
      severity: 'CRITICAL',
      actual: expectedFillMinutes,
      required: contract.maxFillTimeMinutes,
      detail: `${input.style} requires ${contract.typicalDurationMinutes} min fill time. Actual: ${expectedFillMinutes.toFixed(0)} min (${input.expectedFillTimeHours.toFixed(1)}h). This violates style execution contract.`
    });

    logger.error(
      LogCategory.AI_TRADING,
      `[Style Gate] DURATION VIOLATION: ${input.style} expected fill ${expectedFillMinutes.toFixed(0)}min exceeds max ${contract.maxFillTimeMinutes}min`
    );
  }

  // VALIDATION 2: Omega Consensus (MAJOR)
  if (input.omegaConsensusPercent < contract.minOmegaConsensus) {
    violations.push({
      type: 'CONSENSUS',
      severity: 'MAJOR',
      actual: input.omegaConsensusPercent,
      required: contract.minOmegaConsensus,
      detail: `Omega consensus ${input.omegaConsensusPercent.toFixed(1)}% below ${input.style} minimum ${contract.minOmegaConsensus}%. Alpha inflated to ${input.alphaFinalConfidence}% but true consensus insufficient.`
    });

    logger.warn(
      LogCategory.AI_TRADING,
      `[Style Gate] CONSENSUS VIOLATION: Real Omega ${input.omegaConsensusPercent.toFixed(1)}% < required ${contract.minOmegaConsensus}% for ${input.style}`
    );
  }

  // VALIDATION 3: ATR Gate (MAJOR)
  const atrGateThreshold = getAtrGate(input.assetClass, input.style);
  if (input.atrPercent < atrGateThreshold) {
    violations.push({
      type: 'ATR_GATE',
      severity: 'MAJOR',
      actual: input.atrPercent,
      required: atrGateThreshold,
      detail: `ATR ${(input.atrPercent * 100).toFixed(2)}% below ${input.style} gate ${(atrGateThreshold * 100).toFixed(2)}%. Insufficient volatility for style.`
    });

    logger.warn(
      LogCategory.AI_TRADING,
      `[Style Gate] ATR GATE VIOLATION: ${(input.atrPercent * 100).toFixed(2)}% < ${(atrGateThreshold * 100).toFixed(2)}% for ${input.style}`
    );
  }

  // VALIDATION 4: Target Size (CRITICAL)
  const minTarget = contract.minTargetPips[input.assetClass];
  const maxTarget = contract.maxTargetPips[input.assetClass];
  if (input.targetPips < minTarget || input.targetPips > maxTarget) {
    violations.push({
      type: 'TARGET_SIZE',
      severity: 'CRITICAL',
      actual: input.targetPips,
      required: maxTarget,
      detail: `Target ${input.targetPips.toFixed(0)} pips outside ${input.style} range ${minTarget}-${maxTarget} pips for ${input.assetClass}. Style execution contract violated.`
    });

    logger.error(
      LogCategory.AI_TRADING,
      `[Style Gate] TARGET VIOLATION: ${input.targetPips.toFixed(0)} pips outside ${input.style} bounds ${minTarget}-${maxTarget}`
    );
  }

  // VALIDATION 5: Stop Size (MAJOR)
  const minStop = contract.minStopPips[input.assetClass];
  const maxStop = contract.maxStopPips[input.assetClass];
  if (input.stopPips < minStop || input.stopPips > maxStop) {
    violations.push({
      type: 'STOP_SIZE',
      severity: 'MAJOR',
      actual: input.stopPips,
      required: maxStop,
      detail: `Stop ${input.stopPips.toFixed(0)} pips outside ${input.style} range ${minStop}-${maxStop} pips for ${input.assetClass}.`
    });

    logger.warn(
      LogCategory.AI_TRADING,
      `[Style Gate] STOP VIOLATION: ${input.stopPips.toFixed(0)} pips outside ${input.style} bounds ${minStop}-${maxStop}`
    );
  }

  // DECISION LOGIC: Block on CRITICAL violations
  const criticalViolations = violations.filter(v => v.severity === 'CRITICAL');
  const majorViolations = violations.filter(v => v.severity === 'MAJOR');

  const qualified = criticalViolations.length === 0 && majorViolations.length < 2;

  let blockReason: string | undefined;
  if (!qualified) {
    if (criticalViolations.length > 0) {
      blockReason = `CRITICAL STYLE VIOLATION: ${criticalViolations.map(v => v.detail).join(' | ')}`;
    } else {
      blockReason = `MULTIPLE MAJOR VIOLATIONS: ${majorViolations.map(v => v.detail).join(' | ')}`;
    }
  }

  // Log to database if blocked
  if (!qualified && input.sessionId) {
    await logStyleGateBlock(input, violations, blockReason);
  }

  const result: StyleQualificationResult = {
    qualified,
    blockReason,
    violations,
    advisory: violations.length > 0 && qualified ?
      `Trade qualified with ${violations.length} minor violations. Review style appropriateness.` :
      undefined
  };

  logger.info(
    LogCategory.AI_TRADING,
    `[Style Gate] ${input.symbol} ${input.style}: ${qualified ? '✅ QUALIFIED' : '🚫 BLOCKED'} (${violations.length} violations, ${criticalViolations.length} critical)`
  );

  return result;
}

/**
 * Log blocked trade to style_gate_blocks table for governance tracking
 */
async function logStyleGateBlock(
  input: StyleQualificationInput,
  violations: StyleViolation[],
  blockReason?: string
): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from('style_gate_blocks')
      .insert({
        user_id: input.userId,
        session_id: input.sessionId,
        symbol: input.symbol,
        style: input.style,
        asset_class: input.assetClass,
        block_reason: blockReason || 'Style qualification failed',
        violations: violations,
        expected_fill_time_hours: input.expectedFillTimeHours,
        omega_consensus_percent: input.omegaConsensusPercent,
        alpha_final_confidence: input.alphaFinalConfidence,
        atr_percent: input.atrPercent,
        target_pips: input.targetPips,
        stop_pips: input.stopPips,
        goal_amount: input.goalAmount
      });

    if (error) {
      logger.error(
        LogCategory.DATABASE,
        `[Style Gate] Failed to log block to database: ${error.message}`,
        { error }
      );
    } else {
      logger.info(
        LogCategory.AI_TRADING,
        `[Style Gate] Logged block to database: ${input.symbol} ${input.style}`
      );
    }
  } catch (err) {
    logger.error(
      LogCategory.DATABASE,
      `[Style Gate] Exception logging block: ${err}`,
      { error: err }
    );
  }
}

/**
 * Get style contract details for a specific style
 * Useful for displaying contract requirements to Alpha
 */
export function getStyleContract(style: TradeStyle) {
  return STYLE_CONTRACTS[style];
}

/**
 * Check if Omega consensus meets style requirements
 */
export function meetsConsensusRequirement(
  omegaConsensusPercent: number,
  style: TradeStyle
): boolean {
  const contract = STYLE_CONTRACTS[style];
  return omegaConsensusPercent >= contract.minOmegaConsensus;
}

/**
 * Check if expected fill time meets style requirements
 */
export function meetsDurationRequirement(
  expectedFillTimeHours: number,
  style: TradeStyle
): boolean {
  const contract = STYLE_CONTRACTS[style];
  const fillMinutes = expectedFillTimeHours * 60;
  return fillMinutes >= contract.minFillTimeMinutes &&
         fillMinutes <= contract.maxFillTimeMinutes;
}
