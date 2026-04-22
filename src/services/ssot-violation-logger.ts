/**
 * SSOT Violation Logger - Monitoring and Alerting
 *
 * Logs all SSOT violations to Supabase for monitoring, alerting, and analysis.
 * Violations include:
 * - Missing TradeContext
 * - Hash mismatches (symbol config changed during trade)
 * - Stale contexts (> 5 minutes old)
 * - Invalid units (type safety violations at runtime)
 * - Execution-time validation failures
 *
 * This provides visibility into SSOT compliance and helps identify bypass attempts.
 */

import { supabase } from '../lib/supabase';

function deriveComponent(callLocation: string | undefined, violationType: string): string {
  const loc = callLocation ?? '';
  if (loc.includes('alpha') || violationType.startsWith('ALPHA_')) return 'alpha-brain';
  if (loc.includes('omega') || violationType.startsWith('OMEGA_')) return 'omega-council';
  if (loc.includes('validation') || loc.includes('gateway')) return 'validation-gateway';
  if (loc.includes('execution') || loc.includes('trade-execution')) return 'trade-execution';
  if (loc.includes('freshness') || violationType.includes('FRESHNESS')) return 'freshness-gate';
  if (loc.includes('position') || violationType.includes('POSITION')) return 'position-manager';
  if (loc.includes('style') || violationType.startsWith('STYLE_')) return 'style-engine';
  if (loc.includes('constraint') || violationType.includes('CONSTRAINT')) return 'constraint-validator';
  return loc || 'unknown';
}

function deriveSeverity(violationType: string): string {
  const criticalTypes = ['ALPHA_TP_WRONG_SIDE', 'ALPHA_SL_WRONG_SIDE', 'VALIDATION_GATEWAY_BYPASSED', 'POSITION_SIZE_MISMATCH'];
  const warningTypes = ['ALPHA_CONSTRAINT_VIOLATION_UNRESOLVED', 'EXECUTION_VALIDATION_FAILED', 'PRICE_FRESHNESS_BYPASS', 'ALPHA_SL_TP_INVERTED', 'ALPHA_ZERO_DISTANCE', 'STYLE_ENVELOPE_TP_CAP'];
  const infoTypes = ['ALPHA_GEOMETRY_AUTO_CORRECTED'];
  if (infoTypes.includes(violationType)) return 'info';
  if (criticalTypes.includes(violationType)) return 'critical';
  if (warningTypes.includes(violationType)) return 'warning';
  return 'info';
}

export interface ViolationLogEntry {
  violationType: string;
  symbol: string;
  attemptedOperation: string;
  callLocation: string;
  blocked: boolean;
  errorDetails: Record<string, any>;
}

/**
 * Log SSOT violation to database
 *
 * Called by guardrails when violations are detected.
 * Violations are stored in ssot_violations table for monitoring.
 *
 * @param entry The violation details
 */
export async function logViolation(entry: ViolationLogEntry): Promise<void> {
  try {
    const component = deriveComponent(entry.callLocation, entry.violationType);
    const severity = deriveSeverity(entry.violationType);

    const { error } = await supabase
      .from('ssot_violations')
      .insert({
        violation_type: entry.violationType,
        symbol: entry.symbol,
        attempted_operation: entry.attemptedOperation,
        call_location: entry.callLocation,
        blocked: entry.blocked,
        error_details: entry.errorDetails,
        component,
        severity,
      });

    if (error) {
      console.error('[SSOT Violation Logger] Failed to log violation:', error);
      // Don't throw - logging failures shouldn't block trades
    } else {
      if (import.meta.env?.DEV) console.log(`[SSOT Violation] ${entry.violationType} at ${entry.callLocation}: ${entry.symbol}`);
    }
  } catch (error) {
    console.error('[SSOT Violation Logger] Exception while logging:', error);
    // Don't throw - logging failures shouldn't block trades
  }
}

/**
 * Log execution guardrail violation
 *
 * Called when execution-time validation fails (lot size, SL/TP precision, etc.)
 */
export async function logExecutionViolation(
  symbol: string,
  lotSize: number,
  entryPrice: number,
  stopLoss: number,
  takeProfit: number,
  error: string
): Promise<void> {
  await logViolation({
    violationType: 'EXECUTION_VALIDATION_FAILED',
    symbol,
    attemptedOperation: 'trade_execution',
    callLocation: 'trade-execution-engine',
    blocked: true,
    errorDetails: {
      error,
      lotSize,
      entryPrice,
      stopLoss,
      takeProfit,
      timestamp: new Date().toISOString(),
    }
  });
}

/**
 * Log unit type violation
 *
 * Called when branded type validation fails at runtime
 */
export async function logUnitViolation(
  symbol: string,
  operation: string,
  expectedType: string,
  receivedValue: any,
  location: string
): Promise<void> {
  await logViolation({
    violationType: 'INVALID_UNITS',
    symbol,
    attemptedOperation: operation,
    callLocation: location,
    blocked: true,
    errorDetails: {
      expectedType,
      receivedValue,
      receivedType: typeof receivedValue,
      timestamp: new Date().toISOString(),
    }
  });
}

/**
 * Get violation statistics for monitoring
 *
 * Returns counts by type for the last N hours
 */
export async function getViolationStats(
  hoursBack: number = 24
): Promise<{ type: string; count: number; blocked: number }[]> {
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('ssot_violations')
    .select('violation_type, blocked')
    .gte('created_at', cutoff);

  if (error || !data) {
    console.error('[SSOT Violation Logger] Failed to fetch stats:', error);
    return [];
  }

  // Aggregate by type
  const stats = data.reduce((acc, row) => {
    const existing = acc.find(s => s.type === row.violation_type);
    if (existing) {
      existing.count++;
      if (row.blocked) existing.blocked++;
    } else {
      acc.push({
        type: row.violation_type,
        count: 1,
        blocked: row.blocked ? 1 : 0,
      });
    }
    return acc;
  }, [] as { type: string; count: number; blocked: number }[]);

  return stats;
}

/**
 * Check if violation rate exceeds threshold
 *
 * Returns true if violations in the last hour exceed the threshold
 */
export async function isViolationRateHigh(
  threshold: number = 5
): Promise<{ high: boolean; count: number }> {
  const stats = await getViolationStats(1); // Last 1 hour
  const totalBlocked = stats.reduce((sum, s) => sum + s.blocked, 0);

  return {
    high: totalBlocked >= threshold,
    count: totalBlocked,
  };
}

/**
 * Log warning (non-blocking violation)
 *
 * Use for suspicious patterns that don't block execution but should be monitored
 */
export async function logWarning(
  symbol: string,
  operation: string,
  warning: string,
  location: string
): Promise<void> {
  await logViolation({
    violationType: 'WARNING',
    symbol,
    attemptedOperation: operation,
    callLocation: location,
    blocked: false,
    errorDetails: {
      warning,
      timestamp: new Date().toISOString(),
    }
  });
}

/**
 * Clear old violation logs (maintenance function)
 *
 * Call periodically to prevent table bloat
 */
export async function cleanupOldViolations(daysToKeep: number = 30): Promise<number> {
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();

  const { error, count } = await supabase
    .from('ssot_violations')
    .delete()
    .lt('created_at', cutoff);

  if (error) {
    console.error('[SSOT Violation Logger] Failed to cleanup old violations:', error);
    return 0;
  }

  if (import.meta.env?.DEV) console.log(`[SSOT Violation Logger] Cleaned up ${count || 0} violations older than ${daysToKeep} days`);

  return count || 0;
}
