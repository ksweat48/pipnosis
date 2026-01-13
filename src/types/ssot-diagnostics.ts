/**
 * SSOT Math Corruption Diagnostics
 *
 * Centralized types and logging for SSOT calculation errors.
 * These diagnostics help identify when unit mismatches or invalid ranges
 * poison trading constraints and Alpha's decisions.
 */

export type SSOTCorruptionType =
  | 'UNITS_MISMATCH'     // Price units stored as pips, or vice versa
  | 'INVALID_RANGE'      // Min > Max (mathematically impossible)
  | 'ZERO_TP'            // TP calculation produces near-zero pips
  | 'RR_CATASTROPHIC'    // R:R below 1:0.05 (likely bug, not Alpha's choice)
  | 'INVALID_LOT_SIZE'   // Lot size < 0.01 or NaN
  | 'LOW_PROFIT';        // Profit calculation produces suspiciously low value

export type SSOTSeverity = 'ERROR' | 'WARNING';

export interface SSOT_MATH_CORRUPTION_EVENT {
  type: SSOTCorruptionType;
  severity: SSOTSeverity;
  symbol: string;
  issue?: string;
  values?: {
    raw: number;
    expected: number;
    actual: number;
    unit: 'PRICE_UNITS' | 'PIPS' | 'PERCENT';
  };
  callsite: string;
  message: string;
  timestamp?: string;
  [key: string]: any; // Allow additional diagnostic fields
}

/**
 * Log SSOT math corruption event with consistent formatting
 *
 * These events indicate serious calculation bugs that poison Alpha's
 * decision-making. They should be investigated and fixed immediately.
 *
 * @param event - Corruption event details
 */
export function logSSOTCorruption(event: SSOT_MATH_CORRUPTION_EVENT): void {
  const fullEvent = {
    ...event,
    timestamp: new Date().toISOString()
  };

  console.error('[SSOT_MATH_CORRUPTION]', fullEvent);

  // TODO: Send to error tracking service (Sentry, etc.) for production monitoring
  // if (import.meta.env.PROD) {
  //   Sentry.captureException(new Error('SSOT Math Corruption'), {
  //     contexts: { ssot_corruption: fullEvent }
  //   });
  // }
}

/**
 * Check if a TP range is suspiciously low (likely units mismatch)
 *
 * @param tpPips - TP range in pips
 * @param symbol - Trading symbol for diagnostic
 * @returns true if corruption detected
 */
export function detectTPCorruption(tpPips: number, symbol: string): boolean {
  if (tpPips < 1.0) {
    logSSOTCorruption({
      type: 'ZERO_TP',
      severity: 'ERROR',
      symbol,
      message: `TP calculation produced ${tpPips.toFixed(4)} pips - likely units mismatch (price stored as pips)`,
      callsite: 'detectTPCorruption',
      values: {
        raw: tpPips,
        expected: 20.0, // Reasonable TP floor
        actual: tpPips,
        unit: 'PIPS'
      }
    });
    return true;
  }
  return false;
}

/**
 * Check if a range is mathematically invalid (min > max)
 *
 * @param min - Minimum value
 * @param max - Maximum value
 * @param rangeType - Type of range (for diagnostic)
 * @param symbol - Trading symbol for diagnostic
 * @returns true if corruption detected
 */
export function detectRangeCorruption(
  min: number,
  max: number,
  rangeType: string,
  symbol: string
): boolean {
  if (min > max) {
    logSSOTCorruption({
      type: 'INVALID_RANGE',
      severity: 'ERROR',
      symbol,
      message: `${rangeType} range invalid: min (${min.toFixed(1)}) > max (${max.toFixed(1)})`,
      callsite: 'detectRangeCorruption',
      values: {
        raw: min,
        expected: max,
        actual: min,
        unit: 'PIPS'
      }
    });
    return true;
  }
  return false;
}

/**
 * Check if R:R is catastrophically bad (likely system bug)
 *
 * @param rrRatio - Risk:Reward ratio
 * @param symbol - Trading symbol for diagnostic
 * @returns true if corruption detected (R:R < 0.05)
 */
export function detectRRCorruption(rrRatio: number, symbol: string): boolean {
  if (rrRatio < 0.05) {
    logSSOTCorruption({
      type: 'RR_CATASTROPHIC',
      severity: 'ERROR',
      symbol,
      message: `R:R ${rrRatio.toFixed(4)}:1 is catastrophically bad - likely system bug, not Alpha's choice`,
      callsite: 'detectRRCorruption',
      rrRatio
    });
    return true;
  }
  return false;
}
