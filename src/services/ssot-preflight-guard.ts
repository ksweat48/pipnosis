/**
 * SSOT Pre-Flight Guard (Legacy Stub)
 *
 * DEPRECATED: SSOT validation is now handled by UnifiedRiskAuthority.
 * This stub exists only for backward compatibility.
 *
 * New validation logic is in:
 * - src/services/unified-risk-authority.ts (TradeContext validation)
 * - src/services/core-validation-gate.ts (Omega + Geometry validation)
 */

import type { TradeContext } from '../types/trade-context';
import { validateTradeContext } from '../utils/tradeMath';

export interface PreFlightValidationResult {
  passed: boolean;
  error?: string;
  errorCode?: 'MATH_NOT_SSOT';
  violationType?: string;
  blockReason?: string;
}

/**
 * Validate TradeContext (stub - delegates to validateTradeContext)
 */
export async function validatePreFlight(
  context: TradeContext | undefined,
  symbol: string,
  location: string = 'unknown'
): Promise<PreFlightValidationResult> {
  console.log('[SSOT Preflight Guard] STUB: validatePreFlight called (UnifiedRiskAuthority handles this)');

  const validation = validateTradeContext(context);

  if (!validation.valid) {
    return {
      passed: false,
      error: validation.error,
      errorCode: 'MATH_NOT_SSOT',
      violationType: validation.violationType,
      blockReason: `Pre-flight check failed: ${validation.error}`
    };
  }

  return { passed: true };
}

/**
 * Validate at checkpoint (stub)
 */
export async function validateAtCheckpoint(
  context: TradeContext | undefined,
  checkpointName: string,
  symbol?: string
): Promise<PreFlightValidationResult> {
  console.log('[SSOT Preflight Guard] STUB: validateAtCheckpoint called at', checkpointName);

  const validation = validateTradeContext(context);

  if (!validation.valid) {
    return {
      passed: false,
      error: validation.error,
      errorCode: 'MATH_NOT_SSOT',
      violationType: validation.violationType,
      blockReason: `Checkpoint ${checkpointName} failed: ${validation.error}`
    };
  }

  return { passed: true };
}

/**
 * Create blocked decision (stub)
 */
export function createBlockedDecision(
  validation: PreFlightValidationResult,
  symbol: string
): {
  action: 'NO_TRADE';
  reason: string;
  confidence: number;
  errorCode: string;
  violationType: string;
  symbol: string;
} {
  return {
    action: 'NO_TRADE',
    reason: validation.blockReason || 'SSOT validation failed',
    confidence: 0,
    errorCode: 'MATH_NOT_SSOT',
    violationType: validation.violationType || 'UNKNOWN',
    symbol,
  };
}

/**
 * Check if context is present (stub)
 */
export function isContextPresent(context: TradeContext | undefined): boolean {
  return context !== undefined && context !== null;
}

/**
 * Require TradeContext (stub)
 */
export function requireTradeContext(
  context: TradeContext | undefined,
  functionName: string
): asserts context is TradeContext {
  if (!context) {
    throw new Error(
      `[SSOT Violation] ${functionName} requires TradeContext but received undefined.`
    );
  }

  const validation = validateTradeContext(context);
  if (!validation.valid) {
    throw new Error(
      `[SSOT Violation] ${functionName} received invalid TradeContext: ${validation.error}`
    );
  }
}
