/**
 * SSOT Pre-Flight Guard - Enforcement Layer
 *
 * This guardrail blocks all trade decisions that lack proper SSOT provenance.
 * It runs BEFORE Omega consensus and Alpha decision making to ensure mathematical
 * integrity from the start.
 *
 * ENFORCEMENT POLICY:
 * - TradeContext MUST be present
 * - ProfileHash MUST match current symbol registry
 * - Context MUST NOT be stale (< 5 minutes)
 * - Any violation results in NO_TRADE with MATH_NOT_SSOT error code
 *
 * This is NON-NEGOTIABLE. No trade may proceed without valid TradeContext.
 */

import type { TradeContext } from '../types/trade-context';
import { validateTradeContext } from '../utils/tradeMath';
import { logViolation } from './ssot-violation-logger';

export interface PreFlightValidationResult {
  passed: boolean;
  error?: string;
  errorCode?: 'MATH_NOT_SSOT';
  violationType?: string;
  blockReason?: string;
}

/**
 * Validate TradeContext before allowing trade decision pipeline to proceed
 *
 * This is the FIRST guardrail checkpoint. Called at the very start of
 * makeTradeDecision() in alpha-omega-orchestrator.ts
 *
 * @param context The TradeContext to validate
 * @param symbol The symbol being traded (for logging)
 * @param location Call location for violation logging
 * @returns Validation result with blocking details
 */
export async function validatePreFlight(
  context: TradeContext | undefined,
  symbol: string,
  location: string = 'alpha-omega-orchestrator'
): Promise<PreFlightValidationResult> {
  // Run validation
  const validation = validateTradeContext(context);

  if (!validation.valid) {
    // Log violation to database for monitoring
    await logViolation({
      violationType: validation.violationType || 'UNKNOWN',
      symbol,
      attemptedOperation: 'pre_flight_check',
      callLocation: location,
      blocked: true,
      errorDetails: {
        error: validation.error,
        violationType: validation.violationType,
        timestamp: new Date().toISOString(),
      }
    });

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
 * Create NO_TRADE decision with SSOT violation details
 *
 * Use this when pre-flight validation fails to generate proper decision object
 *
 * @param validation The failed validation result
 * @param symbol The symbol that was being evaluated
 * @returns NO_TRADE decision with error details
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
 * Validate TradeContext at any checkpoint
 *
 * Use this in Omega brains, execution layers, or any other place that
 * receives a TradeContext and needs to verify its integrity
 *
 * @param context The context to validate
 * @param checkpointName Name of the checkpoint for logging
 * @returns Validation result
 */
export async function validateAtCheckpoint(
  context: TradeContext | undefined,
  checkpointName: string,
  symbol?: string
): Promise<PreFlightValidationResult> {
  const validation = validateTradeContext(context);

  if (!validation.valid) {
    await logViolation({
      violationType: validation.violationType || 'UNKNOWN',
      symbol: symbol || context?.symbol || 'UNKNOWN',
      attemptedOperation: `checkpoint_${checkpointName}`,
      callLocation: checkpointName,
      blocked: true,
      errorDetails: {
        error: validation.error,
        violationType: validation.violationType,
        checkpoint: checkpointName,
        timestamp: new Date().toISOString(),
      }
    });

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
 * Check if context is present (simpler check without database logging)
 *
 * Use for quick checks in non-critical paths
 */
export function isContextPresent(context: TradeContext | undefined): boolean {
  return context !== undefined && context !== null;
}

/**
 * Require TradeContext (throws if missing)
 *
 * Use in functions that absolutely require context and cannot proceed without it
 *
 * @param context The context that must be present
 * @param functionName Name of the function requiring context
 * @throws Error if context is missing
 */
export function requireTradeContext(
  context: TradeContext | undefined,
  functionName: string
): asserts context is TradeContext {
  if (!context) {
    throw new Error(
      `[SSOT Violation] ${functionName} requires TradeContext but received undefined. ` +
      `All trade-related functions must accept TradeContext to ensure SSOT compliance.`
    );
  }

  // Additional validation
  const validation = validateTradeContext(context);
  if (!validation.valid) {
    throw new Error(
      `[SSOT Violation] ${functionName} received invalid TradeContext: ${validation.error}`
    );
  }
}
