/**
 * Style Qualification Gate — RETIRED (CCIP-2026-03-18)
 *
 * AUTHORITY: NONE — this module no longer participates in trade execution.
 *
 * HISTORY:
 * This module previously ran post-Alpha validation checking ATR%, duration,
 * and pip range suitability against pre-defined style contracts.
 *
 * REASON FOR RETIREMENT:
 * Alpha receives full market context (ATR, session, regime) in its briefing
 * and is the sole authority on whether current volatility is suitable for a
 * given trade style. A secondary gate computing the same information from
 * hardcoded thresholds violated SSOT and created a misleading audit trail
 * (NO_TRADE summaries were attributed to this gate rather than Alpha's reasoning).
 *
 * WHAT REMAINS:
 * - Type exports (StyleQualificationInput, StyleQualificationResult, StyleViolation)
 *   are retained for backward compatibility with the test file and governance docs.
 * - getStyleContract() is retained as a pure reference utility for pip range
 *   documentation — it does not participate in any execution path.
 * - meetsDurationRequirement() is retained as a pure utility.
 * - logStyleGateBlock() and validateStyleQualification() are REMOVED.
 *   The style_gate_blocks table is preserved for historical record;
 *   no new rows will be written.
 *
 * GOVERNANCE:
 * CCIP-2026-03-18 | Owner: Alpha Coordinator | Reviewer: Architecture SSOT
 * Migration: 20260318_ccip_retire_style_gate_authority.sql
 */

import { type CanonicalTradeStyle } from '../config/timeframe-hierarchy';

type CanonicalStyle = CanonicalTradeStyle;

export interface StyleQualificationInput {
  symbol: string;
  style: CanonicalStyle;
  assetClass: 'FOREX' | 'CRYPTO' | 'METAL' | 'INDEX';
  expectedFillTimeHours: number;
  alphaFinalConfidence: number;
  atrPercent: number;
  targetPips: number;
  stopPips: number;
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
 * Style Execution Contracts — reference documentation only.
 * These define typical pip and duration ranges as informational
 * reference. They are NOT used in any execution or validation path.
 *
 * CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform.
 */
const STYLE_CONTRACTS = {
  MICRO_INTRADAY: {
    name: 'M5/M15 Structure',
    minFillTimeMinutes: 5,
    maxFillTimeMinutes: 240,
    typicalDurationMinutes: '30-240',
    minTargetPips: { FOREX: 10, CRYPTO: 30, METAL: 10, INDEX: 15 },
    maxTargetPips: { FOREX: 120, CRYPTO: 300, METAL: 120, INDEX: 150 },
    minStopPips: { FOREX: 5, CRYPTO: 15, METAL: 5, INDEX: 8 },
    maxStopPips: { FOREX: 50, CRYPTO: 150, METAL: 50, INDEX: 70 },
    description: 'M5 entry, TP1 = M5 leg exhaustion partial; TP2 = full intraday target. 30 minutes - 4 hours.'
  }
} as const;

/**
 * Get style contract details for reference/display purposes.
 * NOT used in execution. Reference only.
 */
export function getStyleContract(style: CanonicalStyle) {
  return STYLE_CONTRACTS[style];
}

/**
 * Pure utility: does expectedFillTimeHours fall within style duration bounds?
 * Informational only — does not gate execution.
 */
export function meetsDurationRequirement(
  expectedFillTimeHours: number,
  style: CanonicalStyle
): boolean {
  const contract = STYLE_CONTRACTS[style];
  const fillMinutes = expectedFillTimeHours * 60;
  return fillMinutes >= contract.minFillTimeMinutes &&
         fillMinutes <= contract.maxFillTimeMinutes;
}
