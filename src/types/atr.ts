/**
 * Official Pipnosis ATR Contract
 *
 * SINGLE SOURCE OF TRUTH for ATR representation and validation
 *
 * CRITICAL RULES:
 * 1. ATR MUST always include explicit timeframe declaration
 * 2. ATR MUST be in price units (NOT pips)
 * 3. Timeframe mismatches MUST throw hard errors (not warnings)
 * 4. All ATR consumers MUST request the timeframe they need
 *
 * This prevents the class of bugs where:
 * - Code claims H1 but data is M5 (10-20x underestimation)
 * - Stop loss calculations become absurdly wide (200x ATR)
 * - Time-to-fill calculations explode into days
 * - Trades get blocked incorrectly due to "dead market" misdiagnosis
 */

export type ATRTimeframe = 'M5' | 'M15' | 'H1' | 'H4' | 'D1';

/**
 * Typed ATR value with explicit timeframe tracking
 *
 * This is the ONLY way ATR should be passed around in the system.
 * Raw numbers are ambiguous and lead to subtle bugs.
 */
export interface ATRValue {
  /**
   * ATR value in PRICE UNITS (not pips)
   * Examples:
   * - EURUSD: 0.00045 (= 4.5 pips when divided by 0.0001)
   * - USDJPY: 0.04370 (= 4.37 pips when divided by 0.01)
   * - XAUUSD: 2.50 (= 25 pips when divided by 0.1)
   * - BTCUSD: 800.00 (= 800 pips when divided by 1.0)
   */
  value: number;

  /**
   * Timeframe this ATR was calculated from
   * CRITICAL: This must match the candle data used
   */
  timeframe: ATRTimeframe;

  /**
   * ATR period (typically 14)
   */
  period: number;

  /**
   * Always 'price' to make conversion requirements explicit
   */
  unit: 'price';

  /**
   * Timestamp when ATR was calculated
   */
  calculatedAt: Date;
}

/**
 * Expected ATR ranges by timeframe and asset class
 *
 * These are GUIDELINES for relative validation, not hard limits.
 * Actual values vary by session, news, and market conditions.
 */
export const ATR_TYPICAL_RANGES = {
  // Forex majors (EURUSD, GBPUSD, USDJPY)
  forex_major: {
    M5: { min: 0.00005, max: 0.00030 }, // ~0.5-3 pips
    M15: { min: 0.00010, max: 0.00050 }, // ~1-5 pips
    H1: { min: 0.00020, max: 0.00150 }, // ~2-15 pips (Asia) to ~40-80 pips (London/NY)
    H4: { min: 0.00050, max: 0.00300 }, // ~5-30 pips
    D1: { min: 0.00100, max: 0.00500 }  // ~10-50 pips
  },

  // JPY pairs (multiply by 100 vs other pairs)
  forex_jpy: {
    M5: { min: 0.005, max: 0.030 },
    M15: { min: 0.010, max: 0.050 },
    H1: { min: 0.020, max: 1.500 },
    H4: { min: 0.050, max: 3.000 },
    D1: { min: 0.100, max: 5.000 }
  },

  // Gold (XAUUSD)
  gold: {
    M5: { min: 0.05, max: 0.50 },
    M15: { min: 0.10, max: 1.00 },
    H1: { min: 0.50, max: 5.00 },
    H4: { min: 1.00, max: 10.00 },
    D1: { min: 2.00, max: 20.00 }
  },

  // Crypto (BTCUSD, ETHUSD)
  crypto: {
    M5: { min: 10, max: 200 },
    M15: { min: 20, max: 400 },
    H1: { min: 50, max: 1000 },
    H4: { min: 100, max: 2000 },
    D1: { min: 200, max: 5000 }
  }
} as const;

/**
 * Validation result for ATR consistency checks
 */
export interface ATRValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  metadata: {
    expectedRange?: { min: number; max: number };
    actualValue: number;
    avgCandleRange?: number;
    deviationMultiple?: number;
  };
}

/**
 * Create a typed ATR value
 * Use this factory function to ensure all required fields are present
 */
export function createATRValue(
  value: number,
  timeframe: ATRTimeframe,
  period: number = 14
): ATRValue {
  if (value <= 0) {
    throw new Error(`ATR value must be positive, got ${value}`);
  }

  if (period < 1 || period > 100) {
    throw new Error(`ATR period must be 1-100, got ${period}`);
  }

  return {
    value,
    timeframe,
    period,
    unit: 'price',
    calculatedAt: new Date()
  };
}

/**
 * Validate timeframe consistency
 * THROWS on mismatch - this is a hard invariant, not a soft warning
 */
export function enforceTimeframeMatch(
  atr: ATRValue,
  requestedTimeframe: ATRTimeframe,
  context: string
): void {
  if (atr.timeframe !== requestedTimeframe) {
    throw new Error(
      `SSOT VIOLATION in ${context}: ` +
      `ATR timeframe mismatch! ` +
      `Requested: ${requestedTimeframe}, Got: ${atr.timeframe}. ` +
      `This indicates a fundamental data integrity issue.`
    );
  }
}

/**
 * Validate ATR against recent candle structure (relative consistency)
 *
 * This is MUCH better than hardcoded pip ranges because it catches:
 * - Wrong timeframe (ATR wildly different from candle ranges)
 * - Corrupt candle data (ATR deviates from price action)
 * - Decimal/pip conversion errors
 *
 * WITHOUT being fragile to market conditions (Asia vs news, etc.)
 */
export function validateATRConsistency(
  atr: ATRValue,
  recentCandles: Array<{ high: number; low: number }>,
  symbol: string
): ATRValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (recentCandles.length < 20) {
    return {
      valid: false,
      errors: ['Insufficient candle data for ATR validation (need 20+)'],
      warnings: [],
      metadata: { actualValue: atr.value }
    };
  }

  // Calculate average candle range from recent data
  const candleRanges = recentCandles.map(c => c.high - c.low);
  const avgCandleRange = candleRanges.reduce((sum, r) => sum + r, 0) / candleRanges.length;

  // ATR should be within 0.3x to 3x of average candle range
  // (ATR smooths over 14 periods, so some deviation is expected)
  const minExpected = avgCandleRange * 0.3;
  const maxExpected = avgCandleRange * 3.0;

  const deviationMultiple = atr.value / avgCandleRange;

  if (atr.value < minExpected) {
    errors.push(
      `ATR suspiciously LOW for ${atr.timeframe} (${atr.value.toFixed(5)} vs ` +
      `avg candle range ${avgCandleRange.toFixed(5)}, ${deviationMultiple.toFixed(2)}x). ` +
      `Possible causes: wrong timeframe, corrupt data, or extreme compression.`
    );
  } else if (atr.value > maxExpected) {
    errors.push(
      `ATR suspiciously HIGH for ${atr.timeframe} (${atr.value.toFixed(5)} vs ` +
      `avg candle range ${avgCandleRange.toFixed(5)}, ${deviationMultiple.toFixed(2)}x). ` +
      `Possible causes: wrong timeframe, corrupt data, or extreme volatility spike.`
    );
  }

  // Warning zone: 0.5x to 0.3x or 2x to 3x (still valid but worth noting)
  if (deviationMultiple < 0.5 && deviationMultiple >= 0.3) {
    warnings.push(`ATR on low end of expected range (${deviationMultiple.toFixed(2)}x avg candle range)`);
  } else if (deviationMultiple > 2.0 && deviationMultiple <= 3.0) {
    warnings.push(`ATR on high end of expected range (${deviationMultiple.toFixed(2)}x avg candle range)`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metadata: {
      expectedRange: { min: minExpected, max: maxExpected },
      actualValue: atr.value,
      avgCandleRange,
      deviationMultiple
    }
  };
}

/**
 * Get ATR from snapshot with explicit timeframe request
 *
 * This is the CORRECT way to extract ATR from a snapshot.
 * Forces caller to declare what timeframe they expect.
 */
export function getATRFromSnapshot(
  snapshot: { atr: ATRValue },
  requestedTimeframe: ATRTimeframe,
  context: string
): ATRValue {
  enforceTimeframeMatch(snapshot.atr, requestedTimeframe, context);
  return snapshot.atr;
}

/**
 * Convert legacy raw ATR number to typed ATRValue
 *
 * Use this ONLY during migration period to wrap old code.
 * All new code should use typed ATRValue from the start.
 *
 * @deprecated Use createATRValue() instead
 */
export function legacyATRToTyped(
  rawATR: number,
  assumedTimeframe: ATRTimeframe,
  period: number = 14
): ATRValue {
  console.warn(
    `[ATR Migration] Converting legacy raw ATR to typed. ` +
    `Assuming timeframe: ${assumedTimeframe}. ` +
    `Update caller to use typed ATR instead.`
  );

  return createATRValue(rawATR, assumedTimeframe, period);
}

/**
 * Format ATR for logging/display
 */
export function formatATR(atr: ATRValue, pipValue: number): string {
  const atrPips = atr.value / pipValue;
  return `${atr.value.toFixed(5)} (${atrPips.toFixed(1)} pips) [${atr.timeframe}, ${atr.period}-period]`;
}

/**
 * Environment-aware validation configuration
 * - Development: Strict errors that throw immediately
 * - Production: Resilient logging without crashes
 *
 * IMPORTANT: Must work in both browser (Vite) and Node.js (Netlify Functions)
 */
const isProduction = typeof window !== 'undefined'
  ? window.location?.hostname !== 'localhost'
  : (typeof import.meta !== 'undefined' && import.meta.env?.PROD === true) || process.env.NODE_ENV === 'production';

const isStrictValidation = !isProduction ||
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_STRICT_TYPE_VALIDATION === 'true') ||
  (typeof process !== 'undefined' && process.env?.VITE_STRICT_TYPE_VALIDATION === 'true');

/**
 * ATR Type Validation Error - thrown only in strict mode
 */
export class ATRTypeError extends Error {
  constructor(
    public readonly context: string,
    public readonly expected: string,
    public readonly received: string,
    public readonly severity: 'error' | 'warning' = 'error'
  ) {
    super(`[ATR Type Error] ${context}: Expected ${expected}, received ${received}`);
    this.name = 'ATRTypeError';
  }
}

/**
 * Log ATR validation issue with appropriate severity
 * In production: logs warning but continues
 * In development: throws error
 */
function handleATRValidationIssue(
  context: string,
  message: string,
  severity: 'error' | 'warning' = 'error'
): void {
  const fullMessage = `[ATR SSOT] ${context}: ${message}`;

  if (isStrictValidation && severity === 'error') {
    throw new ATRTypeError(context, 'typed ATRValue', 'raw number or undefined', severity);
  }

  if (severity === 'error') {
    console.error(fullMessage);
  } else {
    console.warn(fullMessage);
  }
}

/**
 * Safely extract ATR value from mixed input (number | ATRValue | undefined)
 * SSOT-compliant: warns about legacy usage, returns safe default
 */
export function safeExtractATRValue(
  atr: number | ATRValue | undefined,
  context: string,
  fallbackValue: number = 0
): number {
  if (atr === undefined) {
    handleATRValidationIssue(context, 'ATR is undefined, using fallback', 'warning');
    return fallbackValue;
  }

  if (typeof atr === 'number') {
    handleATRValidationIssue(
      context,
      `Legacy raw number ATR (${atr}) - migrate to typed ATRValue`,
      'warning'
    );
    return atr;
  }

  if (!isValidATRValue(atr)) {
    handleATRValidationIssue(context, `Malformed ATRValue object: ${JSON.stringify(atr)}`, 'error');
    return fallbackValue;
  }

  return atr.value;
}

/**
 * Safely extract ATR timeframe from mixed input
 * Returns undefined for legacy raw numbers
 */
export function safeExtractATRTimeframe(
  atr: number | ATRValue | undefined,
  context: string
): ATRTimeframe | undefined {
  if (atr === undefined || typeof atr === 'number') {
    return undefined;
  }

  if (!isValidATRValue(atr)) {
    handleATRValidationIssue(context, 'Malformed ATRValue - cannot extract timeframe', 'warning');
    return undefined;
  }

  return atr.timeframe;
}

/**
 * Type guard to check if value is a valid ATRValue
 */
export function isValidATRValue(value: unknown): value is ATRValue {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.value === 'number' &&
    typeof obj.timeframe === 'string' &&
    ['M5', 'M15', 'H1', 'H4', 'D1'].includes(obj.timeframe) &&
    typeof obj.period === 'number' &&
    obj.unit === 'price' &&
    obj.calculatedAt instanceof Date
  );
}

/**
 * Type guard with relaxed Date check (for JSON deserialization)
 */
export function isATRValueLike(value: unknown): value is ATRValue {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.value === 'number' &&
    typeof obj.timeframe === 'string' &&
    ['M5', 'M15', 'H1', 'H4', 'D1'].includes(obj.timeframe) &&
    typeof obj.period === 'number' &&
    obj.unit === 'price'
  );
}

/**
 * Coerce mixed ATR input to typed ATRValue
 * Use when you MUST have a typed ATRValue (e.g., for storage or strict APIs)
 */
export function coerceToATRValue(
  atr: number | ATRValue | undefined,
  assumedTimeframe: ATRTimeframe,
  context: string,
  period: number = 14
): ATRValue | null {
  if (atr === undefined) {
    handleATRValidationIssue(context, 'Cannot coerce undefined ATR', 'error');
    return null;
  }

  if (typeof atr === 'number') {
    handleATRValidationIssue(
      context,
      `Coercing legacy ATR (${atr}) to ${assumedTimeframe} - caller should migrate`,
      'warning'
    );
    return createATRValue(atr, assumedTimeframe, period);
  }

  if (isATRValueLike(atr)) {
    if (!(atr.calculatedAt instanceof Date)) {
      return {
        ...atr,
        calculatedAt: new Date(atr.calculatedAt as unknown as string | number)
      };
    }
    return atr;
  }

  handleATRValidationIssue(context, `Invalid ATR structure: ${JSON.stringify(atr)}`, 'error');
  return null;
}

/**
 * Assert ATR has expected timeframe (environment-aware)
 * In production: logs warning and continues
 * In development: throws error
 */
export function assertATRTimeframe(
  atr: number | ATRValue | undefined,
  expectedTimeframe: ATRTimeframe,
  context: string
): void {
  if (atr === undefined) {
    handleATRValidationIssue(context, `ATR undefined, expected ${expectedTimeframe}`, 'warning');
    return;
  }

  if (typeof atr === 'number') {
    handleATRValidationIssue(
      context,
      `Cannot verify timeframe on raw number ATR (expected ${expectedTimeframe})`,
      'warning'
    );
    return;
  }

  if (atr.timeframe !== expectedTimeframe) {
    handleATRValidationIssue(
      context,
      `Timeframe mismatch: expected ${expectedTimeframe}, got ${atr.timeframe}`,
      'error'
    );
  }
}

/**
 * Get validation mode status for debugging
 */
export function getATRValidationMode(): {
  isProduction: boolean;
  isStrict: boolean;
  mode: string;
} {
  return {
    isProduction,
    isStrict: isStrictValidation,
    mode: isStrictValidation ? 'STRICT (throws errors)' : 'RESILIENT (logs warnings)'
  };
}
