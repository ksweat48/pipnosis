/**
 * Alpha Authority Configuration - SSOT for Alpha Sovereignty Rules
 *
 * ALPHA SOVEREIGNTY PRINCIPLE:
 * Alpha is the ONLY trading decision maker. Components serve Alpha, not judge Alpha.
 *
 * This configuration defines what is allowed to block trades and what is advisory only.
 */

/**
 * Mandatory Safety Blocks - The ONLY allowed blockers
 *
 * These are the 3 categories that can prevent trade execution:
 * 1. Margin/Exposure Breach
 * 2. Market Closed / Symbol Halted
 * 3. Invalid SSOT TradeContext
 * 4. Malformed Order (NaN, invalid decimals, broker rejection)
 */
export const MANDATORY_SAFETY_BLOCKS = {
  MARGIN_BREACH: 'Account margin insufficient',
  EXPOSURE_BREACH: 'Position size limit exceeded',
  MARKET_CLOSED: 'Market is closed or symbol halted',
  INVALID_SSOT: 'Missing or corrupted trade context',
  MALFORMED_ORDER: 'Order contains invalid values (NaN, negative, wrong decimals)',
} as const;

/**
 * Advisory-Only Metrics - NEVER block execution
 *
 * These metrics inform Alpha and learning systems but NEVER prevent execution
 */
export const ADVISORY_ONLY_METRICS = [
  'confidence',           // No confidence threshold
  'eqs',                  // No Entry Quality Score gate
  'distance_atr',         // No ATR distance limit
  'volatility',           // No volatility ceiling
  'time_to_fill',         // No duration rejection
  'spread',               // No spread limit (unless economic)
  'pip_width',            // No pip width gate
  'reward_ratio',         // No R:R minimum (unless <0.5)
] as const;

/**
 * Alpha Authority Settings
 */
export const ALPHA_AUTHORITY = {
  /**
   * Enforce mandatory blocks only
   * All other checks are advisory
   */
  MANDATORY_BLOCKS_ONLY: true,

  /**
   * No confidence threshold
   * Alpha can execute at any confidence level
   * PCPE will adjust sizing (FULL/REDUCED/MICRO) but never block
   */
  MIN_CONFIDENCE: 0,

  /**
   * No Entry Quality Score gate
   * EQS is for tracking and learning only
   */
  MIN_EQS: 0,

  /**
   * No ATR distance limit
   * Alpha can WAIT for distant zones
   * Entry Optimizer monitors and may abandon, but doesn't block intent creation
   */
  MAX_ATR_DISTANCE: Infinity,

  /**
   * No volatility ceiling
   * Volatility affects sizing via PCPE, not execution permission
   */
  MAX_VOLATILITY_MULTIPLIER: Infinity,

  /**
   * No time-to-fill rejection
   * Duration affects style classification, not execution permission
   */
  MAX_TIME_TO_FILL_HOURS: Infinity,

  /**
   * Advisory Penalty Cap - GOVERNANCE GUARDRAIL
   *
   * No combination of advisory penalties may reduce confidence by more than 25%.
   * This prevents "death by a thousand cuts" where multiple advisory systems
   * stack penalties until confidence always drops below execution threshold.
   *
   * This guarantees Alpha can still act on strong conviction.
   */
  MAX_ADVISORY_PENALTY_PERCENT: 25,

  /**
   * Per-category penalty caps
   * Prevents single category from dominating penalties
   */
  ADVISORY_PENALTY_CATEGORY_CAPS: {
    risk: 15,          // Risk-related penalties (SL distance, R:R, exposure)
    timing: 10,        // Time-related penalties (urgency, decay, staleness)
    environment: 15,   // Market environment (adversarial, regime, volatility)
    quality: 10,       // Quality metrics (EQS, pattern confidence)
  },

  /**
   * Advisory metrics list
   * Components must not block based on these
   */
  ADVISORY_METRICS: ADVISORY_ONLY_METRICS,

  /**
   * Entry Optimizer role
   * Optimizer SERVES Alpha's decisions, doesn't judge them
   */
  ENTRY_OPTIMIZER: {
    CAN_MONITOR: true,              // Track price movement
    CAN_CALCULATE_METRICS: true,    // Calculate distance, EQS, etc.
    CAN_PROVIDE_TELEMETRY: true,    // Report progress
    CAN_ABANDON_IF_INVALIDATED: true, // Abandon if invalidation zone hit
    CAN_BLOCK_INTENT_CREATION: false, // NEVER block Alpha's WAIT decision
    CAN_OVERRIDE_ZONES: false,      // NEVER modify Alpha's zones
    CAN_RETURN_NO_TRADE: false,     // NEVER cancel Alpha's plan
  },

  /**
   * PCPE role
   * PCPE adjusts SIZE, not execution permission
   */
  PCPE: {
    CAN_ADJUST_SIZE: true,          // Downgrade FULL→REDUCED→MICRO
    CAN_BLOCK: false,               // NEVER block execution
    MIN_MULTIPLIER: 0.25,           // Minimum is MICRO (0.25x), never 0x
  },
} as const;

/**
 * Validate that only mandatory safety can block
 */
export function isMandatorySafetyBlock(blockReason: string): boolean {
  return Object.keys(MANDATORY_SAFETY_BLOCKS).includes(blockReason);
}

/**
 * Validate that metric is advisory-only
 */
export function isAdvisoryOnlyMetric(metric: string): boolean {
  return ADVISORY_ONLY_METRICS.includes(metric as any);
}

/**
 * Check if a block reason is valid
 * Used for auditing and validation
 */
export function validateBlockReason(blockReason: string): {
  valid: boolean;
  category: 'MANDATORY' | 'INVALID';
  message: string;
} {
  if (isMandatorySafetyBlock(blockReason)) {
    return {
      valid: true,
      category: 'MANDATORY',
      message: MANDATORY_SAFETY_BLOCKS[blockReason as keyof typeof MANDATORY_SAFETY_BLOCKS],
    };
  }

  return {
    valid: false,
    category: 'INVALID',
    message: `Block reason "${blockReason}" is not a mandatory safety block. Only mandatory safety can block trades.`,
  };
}
