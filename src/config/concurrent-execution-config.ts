/**
 * Concurrent Symbol Analysis Configuration
 *
 * SINGLE SOURCE OF TRUTH for concurrent multi-symbol processing behavior.
 * Controls how Alpha evaluates multiple trading pairs simultaneously.
 *
 * SSOT COMPLIANCE:
 * - This is the ONLY place where concurrent execution parameters are defined
 * - All concurrent processing behavior references this config
 * - Changes here automatically affect all symbol analysis operations
 *
 * GOVERNANCE:
 * - All concurrent execution is tracked and audited
 * - Performance metrics logged to database for analysis
 * - Rate limiting prevents LLM provider overload
 *
 * CCIP COMPLIANCE:
 * - Version tracked for change control
 * - Configuration changes require audit trail
 */

export type MarketSession = 'asian' | 'london' | 'nyse' | 'overlap' | 'off_hours';

export interface SessionTimeouts {
  asian: number;      // Lower volatility = faster analysis
  london: number;     // Moderate complexity
  nyse: number;       // High volatility = moderate analysis time
  overlap: number;    // Highest complexity (London+NYSE)
  off_hours: number;  // Limited activity = fast rejections
}

export interface ConcurrentExecutionConfig {
  // Master switch for concurrent processing
  enabled: boolean;

  // Concurrency control
  concurrency: {
    // Maximum number of symbols to analyze simultaneously
    // Set to 0 for unlimited (analyze all symbols at once)
    // Set to 1 for sequential (original behavior)
    maxConcurrentSymbols: number;

    // Base timeout per symbol analysis (milliseconds)
    // Used when session-specific timeouts are disabled
    symbolTimeoutMs: number;

    // Total batch timeout (milliseconds)
    // Maximum time to wait for entire batch
    batchTimeoutMs: number;

    // Session-specific timeouts
    // Adjusts timeout based on market complexity
    useSessionTimeouts: boolean;
    sessionTimeouts: SessionTimeouts;
  };

  // Early-exit optimization
  earlyExit: {
    // Enable early-exit when first viable trade found
    enabled: boolean;

    // Confidence threshold for early-exit trigger
    // MUST match Alpha's base confidence threshold (60%)
    minConfidenceThreshold: number;

    // Wait for additional symbols before exiting (in case better trade exists)
    // Set to 0 to exit immediately on first viable trade
    // Set to N to wait for N additional results after first viable trade
    gracePeriodSymbols: number;
  };

  // Rate limiting (to prevent LLM provider throttling)
  rateLimiting: {
    // Enable rate limiting
    enabled: boolean;

    // Maximum LLM calls per second (across all concurrent operations)
    // Increased to 20 to support 9 concurrent symbols without queueing
    maxLLMCallsPerSecond: number;

    // Minimum delay between batches (milliseconds)
    minBatchDelayMs: number;
  };

  // Error handling
  errorHandling: {
    // Continue processing other symbols if one fails
    continueOnError: boolean;

    // Maximum number of retries per symbol
    maxRetries: number;

    // Delay between retries (milliseconds)
    retryDelayMs: number;
  };

  // Performance tracking
  tracking: {
    // Log performance metrics to database
    enabled: boolean;

    // Log detailed timing for each symbol
    logDetailedTimings: boolean;

    // Log LLM call counts for cost analysis
    logLLMCallCounts: boolean;
  };

  // Governance and audit
  governance: {
    // Track all concurrent executions in database
    enabled: boolean;

    // Alert if concurrent execution takes longer than threshold
    alertThresholdMs: number;

    // Alert if error rate exceeds threshold
    alertErrorRatePercent: number;
  };
}

export const CONCURRENT_EXECUTION_CONFIG: ConcurrentExecutionConfig = {
  enabled: true, // Master switch - enable concurrent processing

  concurrency: {
    maxConcurrentSymbols: 0, // 0 = unlimited, analyze all symbols at once
    symbolTimeoutMs: 45000, // 45 seconds per symbol (increased for real-world LLM latency)
    batchTimeoutMs: 90000, // 90 seconds total batch timeout (increased proportionally)

    // Session-specific timeouts optimized for real-world OpenAI API latency
    // TIER7 FIX: Increased from 25-35s to 40-70s based on production timeout analysis
    useSessionTimeouts: true,
    sessionTimeouts: {
      asian: 40000,     // 40s - Lower volatility but accounting for API latency
      london: 50000,    // 50s - Moderate complexity with LLM calls
      nyse: 60000,      // 60s - High volatility + complex thesis generation
      overlap: 70000,   // 70s - Highest complexity (London+NYSE concurrent + thesis cache misses)
      off_hours: 35000, // 35s - Limited market activity but still allowing full LLM execution
    },
  },

  earlyExit: {
    enabled: true, // Enable early-exit optimization
    minConfidenceThreshold: 60, // Exit when confidence >= 60% (matches Alpha base threshold)
    gracePeriodSymbols: 0, // Exit immediately on first viable trade
  },

  rateLimiting: {
    enabled: true,
    maxLLMCallsPerSecond: 20, // Increased to support 9 concurrent symbols (2-3 calls each)
    minBatchDelayMs: 100, // 100ms between batches
  },

  errorHandling: {
    continueOnError: true, // Don't let one symbol failure crash the batch
    maxRetries: 2, // Retry failed symbols up to 2 times
    retryDelayMs: 500, // Wait 500ms between retries
  },

  tracking: {
    enabled: true, // Enable performance tracking
    logDetailedTimings: true, // Log timing for each symbol
    logLLMCallCounts: true, // Track LLM usage for cost analysis
  },

  governance: {
    enabled: true, // Enable governance tracking
    alertThresholdMs: 75000, // Alert if batch takes > 75 seconds (adjusted for 40-70s timeouts)
    alertErrorRatePercent: 20, // Alert if > 20% of symbols fail
  },
};

/**
 * SSOT: Get concurrent execution configuration
 * All concurrent processing MUST use this function
 */
export function getConcurrentExecutionConfig(): ConcurrentExecutionConfig {
  return CONCURRENT_EXECUTION_CONFIG;
}

/**
 * SSOT: Check if concurrent execution is enabled
 */
export function isConcurrentExecutionEnabled(): boolean {
  return CONCURRENT_EXECUTION_CONFIG.enabled;
}

/**
 * SSOT: Get maximum concurrent symbols
 * Returns 0 for unlimited, positive number for limit
 */
export function getMaxConcurrentSymbols(): number {
  return CONCURRENT_EXECUTION_CONFIG.concurrency.maxConcurrentSymbols;
}

/**
 * SSOT: Check if early-exit is enabled
 */
export function isEarlyExitEnabled(): boolean {
  return CONCURRENT_EXECUTION_CONFIG.earlyExit.enabled;
}

/**
 * SSOT: Get early-exit confidence threshold
 */
export function getEarlyExitThreshold(): number {
  return CONCURRENT_EXECUTION_CONFIG.earlyExit.minConfidenceThreshold;
}

/**
 * SSOT: Get timeout for current market session
 * Returns session-specific timeout if enabled, otherwise base timeout
 */
export function getSessionTimeout(session: MarketSession): number {
  const config = CONCURRENT_EXECUTION_CONFIG;

  if (!config.concurrency.useSessionTimeouts) {
    return config.concurrency.symbolTimeoutMs;
  }

  return config.concurrency.sessionTimeouts[session];
}

/**
 * SSOT: Get session timeout multiplier (for logging/analysis)
 */
export function getSessionTimeoutMultiplier(session: MarketSession): number {
  const sessionTimeout = getSessionTimeout(session);
  const baseTimeout = CONCURRENT_EXECUTION_CONFIG.concurrency.symbolTimeoutMs;
  return sessionTimeout / baseTimeout;
}

/**
 * Format config for logging (CCIP audit trail)
 */
export function formatConcurrentConfigForLogging(): string {
  const config = CONCURRENT_EXECUTION_CONFIG;
  const mode = config.enabled ? 'CONCURRENT' : 'SEQUENTIAL';
  const concurrency = config.concurrency.maxConcurrentSymbols === 0
    ? 'UNLIMITED'
    : `MAX ${config.concurrency.maxConcurrentSymbols}`;

  const sessionTimeoutsStr = config.concurrency.useSessionTimeouts
    ? `Asian: ${config.concurrency.sessionTimeouts.asian}ms, London: ${config.concurrency.sessionTimeouts.london}ms, NYSE: ${config.concurrency.sessionTimeouts.nyse}ms, Overlap: ${config.concurrency.sessionTimeouts.overlap}ms, Off-Hours: ${config.concurrency.sessionTimeouts.off_hours}ms`
    : 'DISABLED';

  return `
[Concurrent Execution Config - SSOT]
Mode: ${mode} | Concurrency: ${concurrency}
Early-Exit: ${config.earlyExit.enabled ? `YES (${config.earlyExit.minConfidenceThreshold}% threshold)` : 'NO'}
Rate Limiting: ${config.rateLimiting.enabled ? `${config.rateLimiting.maxLLMCallsPerSecond} calls/sec` : 'DISABLED'}
Timeouts (Base): ${config.concurrency.symbolTimeoutMs}ms/symbol, ${config.concurrency.batchTimeoutMs}ms/batch
Session Timeouts: ${sessionTimeoutsStr}
Tracking: ${config.tracking.enabled ? 'ENABLED' : 'DISABLED'}
Governance: ${config.governance.enabled ? 'ENABLED' : 'DISABLED'}
`.trim();
}
