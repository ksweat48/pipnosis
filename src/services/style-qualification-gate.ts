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
 * These define typical pip and duration ranges per style as informational
 * reference. They are NOT used in any execution or validation path.
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
