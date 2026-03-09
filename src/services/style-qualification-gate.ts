/**
 * Style Qualification Gate Service
 *
 * AUTHORITY: ADVISORY + SAFETY GATING
 *
 * CCIP-2026-02-24: Omega consensus validation removed.
 * Omegas no longer vote on direction — Alpha reasons from raw data.
 *
 * ✅ GOVERNANCE MODEL (Updated):
 * - "Engines validate. Alpha decides. Trades degrade intelligently."
 * - Style mismatches (duration) are ADVISORY warnings
 * - Safety violations (extreme ATR, dangerous stops) may block
 * - Alpha has FINAL AUTHORITY on trade execution
 *
 * VALIDATION TIERS:
 * 1. ADVISORY (MAJOR): Duration mismatches → WARN but allow
 * 2. SAFETY (CRITICAL): Extreme volatility, dangerous stops → May block
 *
 * VALIDATION CHECKS:
 * 1. Expected Fill Time validation (style duration appropriateness)
 * 2. ATR Gate validation (volatility safety check)
 * 3. Target/Stop appropriateness (style swing size validation)
 *
 * All violations logged to `style_gate_blocks` for governance tracking.
 */

import { logger, LogCategory } from '../lib/logger';
import { supabaseAdmin } from '../lib/supabase-admin';
import { getAtrGate } from '../config/trade-constraints';
import { type CanonicalTradeStyle } from '../config/timeframe-hierarchy';

type CanonicalStyle = CanonicalTradeStyle;

export interface StyleQualificationInput {
  symbol: string;
  style: CanonicalStyle;
  assetClass: 'FOREX' | 'CRYPTO' | 'METAL' | 'INDEX';

  // Duration validation
  expectedFillTimeHours: number;

  // Alpha confidence (for logging only)
  alphaFinalConfidence: number;

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
  // CRITICAL = Safety violation (may block)
  // MAJOR = Style advisory (warns, does not block)
  // MINOR = Informational note
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
    maxTargetPips: { FOREX: 25, CRYPTO: 150, METAL: 60, INDEX: 80 },
    minStopPips: { FOREX: 5, CRYPTO: 15, METAL: 5, INDEX: 8 },
    maxStopPips: { FOREX: 25, CRYPTO: 80, METAL: 25, INDEX: 35 },
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

  // VALIDATION 1: Expected Fill Time (ADVISORY - MAJOR)
  // ✅ Duration mismatches are style preference issues, not safety violations
  const expectedFillMinutes = input.expectedFillTimeHours * 60;
  if (
    expectedFillMinutes < contract.minFillTimeMinutes ||
    expectedFillMinutes > contract.maxFillTimeMinutes
  ) {
    violations.push({
      type: 'DURATION',
      severity: 'MAJOR', // Changed from CRITICAL - this is advisory, not blocking
      actual: expectedFillMinutes,
      required: contract.maxFillTimeMinutes,
      detail: `${input.style} typically ${contract.typicalDurationMinutes} min duration. Actual: ${expectedFillMinutes.toFixed(0)} min (${input.expectedFillTimeHours.toFixed(1)}h). Consider style adjustment.`
    });

    logger.warn(
      LogCategory.AI_TRADING,
      `[Style Gate] DURATION ADVISORY: ${input.style} expected fill ${expectedFillMinutes.toFixed(0)}min vs typical ${contract.maxFillTimeMinutes}min (proceeding)`
    );
  }

  // VALIDATION 2: ATR Gate (MAJOR)
  const atrLookupStyle = input.style === 'MICRO_INTRADAY' ? 'INTRADAY' : input.style;
  const atrGateThreshold = getAtrGate(input.assetClass, atrLookupStyle as any);
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

  // VALIDATION 4: Target Size (ADVISORY - MAJOR)
  // ✅ Oversized targets are style preference issues, not safety violations
  const minTarget = contract.minTargetPips[input.assetClass];
  const maxTarget = contract.maxTargetPips[input.assetClass];
  if (input.targetPips < minTarget || input.targetPips > maxTarget) {
    violations.push({
      type: 'TARGET_SIZE',
      severity: 'MAJOR', // Changed from CRITICAL - oversized targets are advisory
      actual: input.targetPips,
      required: maxTarget,
      detail: `Target ${input.targetPips.toFixed(0)} pips outside ${input.style} typical range ${minTarget}-${maxTarget} pips for ${input.assetClass}. Consider style adjustment.`
    });

    logger.warn(
      LogCategory.AI_TRADING,
      `[Style Gate] TARGET ADVISORY: ${input.targetPips.toFixed(0)} pips vs ${input.style} typical ${minTarget}-${maxTarget} (proceeding)`
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

  // ✅ DECISION LOGIC (Updated): Advisory flagging, not hard blocking
  // Philosophy: "Engines validate. Alpha decides."
  // - Style Gate provides advisory warnings
  // - Executor determines if violations are actual safety concerns
  // - Alpha has final authority on execution
  const criticalViolations = violations.filter(v => v.severity === 'CRITICAL');
  const majorViolations = violations.filter(v => v.severity === 'MAJOR');

  // "Qualified" means < 2 advisory warnings (still proceeds, just flagged)
  const qualified = criticalViolations.length === 0 && majorViolations.length < 2;

  let blockReason: string | undefined;
  if (!qualified) {
    if (criticalViolations.length > 0) {
      blockReason = `SAFETY CONCERN: ${criticalViolations.map(v => v.detail).join(' | ')}`;
    } else {
      blockReason = `STYLE ADVISORY: ${majorViolations.map(v => v.detail).join(' | ')}`;
    }
  }

  // Log to database for governance tracking (not blocking)
  if (!qualified && input.sessionId) {
    await logStyleGateBlock(input, violations, blockReason);
  }

  const result: StyleQualificationResult = {
    qualified,
    blockReason,
    violations,
    advisory: violations.length > 0 ?
      `${violations.length} style ${violations.length === 1 ? 'advisory' : 'advisories'}: ${violations.map(v => v.type).join(', ')}` :
      undefined
  };

  logger.info(
    LogCategory.AI_TRADING,
    `[Style Gate] ${input.symbol} ${input.style}: ${qualified ? '✅ ADVISORY' : '⚠️ FLAGGED'} (${violations.length} advisories, ${criticalViolations.length} safety concerns)`
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
    if (!supabaseAdmin) {
      logger.warn(
        LogCategory.DATABASE,
        '[Style Gate] supabaseAdmin not available - skipping block log'
      );
      return;
    }
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
export function getStyleContract(style: CanonicalStyle) {
  return STYLE_CONTRACTS[style];
}

export function meetsDurationRequirement(
  expectedFillTimeHours: number,
  style: CanonicalStyle
): boolean {
  const contract = STYLE_CONTRACTS[style];
  const fillMinutes = expectedFillTimeHours * 60;
  return fillMinutes >= contract.minFillTimeMinutes &&
         fillMinutes <= contract.maxFillTimeMinutes;
}
