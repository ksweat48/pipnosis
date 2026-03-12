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

    // Overall council evaluation timeout (milliseconds)
    // Wraps the entire evaluateMultipleSymbols() call.
    // Must be >= (numBatches × maxSessionTimeout) + buffer.
    councilTimeoutMs: number;

    // Session-specific timeouts
    // Adjusts timeout based on market complexity
    useSessionTimeouts: boolean;
    sessionTimeouts: SessionTimeouts;
  };

  // Early-exit optimization
  earlyExit: {
    // Enable early-exit when first viable trade found
    enabled: boolean;

    // Confidence threshold for early-exit trigger.
    // Raised from 60 to 72: at 60% the threshold was rarely met cleanly,
    // causing all 9 symbols to be evaluated even when a strong signal existed.
    // At 72% a clear high-confidence signal terminates the batch immediately.
    minConfidenceThreshold: number;

    // Wait for additional symbols before exiting (in case better trade exists)
    // Set to 0 to exit immediately on first viable trade
    // Set to N to wait for N additional results after first viable trade
    gracePeriodSymbols: number;
  };

  // Omega-8 deterministic threshold
  // Confidence value below which Omega-8 routes to LLM refinement (slow path).
  // Above or equal to this value Omega-8 uses its deterministic result (fast path).
  // SSOT: All Omega-8 consumers MUST read this via getOmega8DeterministicThreshold().
  omega8: {
    deterministicThreshold: number;
    // When true, conflicting directional signals (e.g. swept highs AND swept lows)
    // force an LLM refinement call regardless of confidence level.
    // When false (CCIP-2026-03-12), symbols with conf > LLM_CONFIDENCE_UPPER skip the
    // conflict LLM path — saves 1 call per ambiguous symbol (~5-10s each).
    conflictingSignalsLlmEnabled: boolean;
  };

  // Resilience — retry policy for LLM API calls
  // SSOT: openai-client.ts MUST read these via getMaxRetries() / getRetryDelayMs().
  resilience: {
    // Maximum number of retries per LLM call (after initial attempt).
    // Reduced 2→1: a symbol that 504s twice becomes NO_TRADE for this scan cycle.
    // Each retry burns ~28s. Reducing from 2 to 1 caps worst-case at 57s vs 88s.
    maxRetries: number;
    // Base delay between retries (milliseconds). Doubles on each subsequent attempt.
    retryDelayMs: number;
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

    // Stagger delay between symbols within a batch (milliseconds).
    // DEPRECATED: Set to 0. Rate limiting is now enforced at openai-client.ts via
    // LLMRequestQueue singleton (4000ms min inter-call spacing). The stagger here was
    // applied at pipeline start and symbols converged at the LLM call point anyway.
    intraBatchStaggerMs: number;
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

// CCIP-2026-03-12: 2-3x scan speed improvement — rolling concurrency pool + queue tightening.
//
// ROOT CAUSE: Four compounding bottlenecks were slowing full scans to 228s worst-case:
//   1. Batch-sequential execution: 3 batches of 3, waiting for the slowest symbol in each
//      batch before starting the next. If symbol 1 finishes in 25s but symbol 3 takes 88s,
//      the next batch is blocked for 63s of idle time.
//   2. LLM queue spacing 500ms was 10x more conservative than needed. OpenAI allows 20
//      req/s; we were sending 2 req/s. 18 calls × 500ms = 9s of pure queue wait per scan.
//   3. Omega-8 conflicting-signals bypass: symbols with conf >65 but both sweptHighs AND
//      sweptLows would still trigger an extra LLM refinement call, adding 5-10s per
//      affected symbol. This was firing on ~3-4 of 9 symbols per scan in forex pairs.
//   4. maxRetries=2 meant a double-504 symbol blocked 88s total (28s initial + 28s retry
//      + 28s retry + 500ms backoffs) instead of accepting NO_TRADE after 57s.
//
// FIX PART 1 (this file):
//   - maxConcurrentSymbols: 3 → 5. Rolling pool replaces batch-sequential in orchestrator.
//     With rolling concurrency, when any of the 5 slots frees up the next symbol starts
//     immediately — no waiting for the entire batch to drain.
//   - omega8.conflictingSignalsLlmEnabled: false. Symbols above the LLM_CONFIDENCE_UPPER
//     window (65) skip the conflict LLM bypass. The deterministic score already resolved
//     the direction confidently; LLM refinement on conflicts at conf>65 rarely changed
//     the outcome but always cost 5-10s extra.
//   - resilience.maxRetries: 1 (down from 2 in errorHandling.maxRetries).
//     openai-client.ts MUST consume getMaxRetries() — do NOT use errorHandling.maxRetries.
//   - resilience.retryDelayMs: 500 (same value, now formally SSOT-governed).
//   - councilTimeoutMs: 420000 → 300000. With 5-wide rolling pool and 1 retry, worst-case
//     is 2 waves of ~120s each = 240s + 60s buffer = 300s.
//
// FIX PART 2: openai-client.ts minInterCallMs: 500ms → 100ms.
//   Queue budget: 10 calls (5 symbols × 2 calls) × 100ms = 1s queue wait (down from 9s).
//   OpenAI rate limit is 20 req/s; 100ms spacing = 10 req/s — 2x below the allowed rate.
//   Anti-thundering-herd protection maintained: calls still cannot burst simultaneously.
//
// FIX PART 3: alpha-omega-orchestrator.ts evaluateConcurrently() rewritten.
//   Replaces for-loop batch chunks with a concurrency-limited rolling pool.
//   As each slot drains, the next symbol is submitted immediately.
//   Early-exit still fires: when a viable trade is found, pending symbols are abandoned.
//
// EXPECTED IMPROVEMENT:
//   Current worst-case: ~228s (3 batches × 76s avg, dominated by slowest-per-batch)
//   Target worst-case:  ~80-100s (rolling pool eliminates inter-batch idle time)
//   Target best-case:   ~45-60s (early-exit after first batch with strong signal)
//   Net improvement:    2.3-2.8x faster
//
// CCIP-2026-03-04: Concurrent execution config updated to fix Alpha NO_TRADE cascade.
//
// ROOT CAUSE: The LLM queue (openai-client.ts) enforces a minimum inter-call spacing.
// With maxConcurrentSymbols=3, up to 6 LLM calls (Omega-8 + Alpha per symbol) queue
// sequentially. At 4000ms spacing, 6 calls take 20s of queue wait alone, pushing most
// London session evaluations (70s timeout) past their limit before the Alpha LLM fires.
// Timeout returns confidence=0, which fails Gate #5 (CONFIDENCE_THRESHOLD) in
// best-symbol-selector.ts, so ALL symbols get rejected and NO_TRADE is returned.
//
// FIX PART 1: openai-client.ts minInterCallMs reduced 4000ms → 1500ms (anti-thundering-herd
// still maintained, but queue clears within session timeout budgets).
//
// FIX PART 2 (this file): maxConcurrentSymbols 3 → 2 reduces peak queue pressure.
// Session timeouts extended to account for realistic pipeline budget:
//   Budget = (queue_wait) + (API_latency) + (snapshot_build)
//          = (2 symbols × 2 LLM calls × 1500ms) + (10s API) + (5s build)
//          = 6s queue + 15s processing = ~21s actual + 2× safety margin = ~45s minimum
// New timeouts provide comfortable headroom above that budget per session complexity.
//
// CCIP-2026-03-06: Scan speed improvement — maxConcurrentSymbols 2 → 3.
// Enabled by reducing openai-client.ts minInterCallMs 1500ms → 1000ms.
// Queue budget stays identical:
//   Old: (2 symbols × 2 calls) × 1500ms = 6s queue wait
//   New: (3 symbols × 2 calls) × 1000ms = 6s queue wait
// Result: 9 symbols processed in 3 batches of 3 vs 5 batches of 2 = ~40% faster total scan.
// Session timeouts unchanged — same safety margins apply.
//
// CCIP-2026-03-11: Scan speed and timeout stability improvements.
//
// ROOT CAUSE: Three compounding issues caused scan cycles to exceed 4 minutes:
//   1. councilTimeoutMs (goal-session-live-engine.ts) was hardcoded 180s — a magic number
//      violating SSOT. Worst-case: 3 batches × overlap session timeout (120s) = 360s,
//      so 180s fired mid-scan on legitimate long evaluations.
//   2. HIGH_CONFIDENCE = 70 in alpha-omega-orchestrator.ts was a local magic number
//      violating SSOT. Omega-8 was routing ~5-6 of 9 symbols through the slow LLM
//      refinement path, adding 3-8s of latency per symbol.
//   3. earlyExit.minConfidenceThreshold = 60 was rarely met cleanly, so all 9 symbols
//      were evaluated even after a strong trade signal was found in batch 1.
//   4. minInterCallMs = 1000ms in openai-client.ts meant 9 symbols × ~2 LLM calls = 18
//      calls = 18s of pure queue wait on top of actual API latency.
//
// FIX PART 1 (this file):
//   - councilTimeoutMs added to interface (SSOT); set to 420,000ms.
//     Budget: 3 batches × 120s overlap timeout × headroom = 360s + 60s buffer = 420s.
//     goal-session-live-engine.ts MUST consume getCouncilTimeoutMs() instead of hardcode.
//   - omega8.deterministicThreshold added to interface (SSOT); set to 60.
//     alpha-omega-orchestrator.ts MUST consume getOmega8DeterministicThreshold().
//     Lowering 70→60 pushes more symbols to the fast deterministic path, cutting
//     ~3-8s of LLM refinement latency per borderline symbol.
//   - earlyExit.minConfidenceThreshold raised 60→72.
//     At 72% the first strong signal terminates the batch, skipping 6+ remaining symbols.
//
// FIX PART 2: openai-client.ts minInterCallMs reduced 1000ms → 500ms.
//   Queue budget: (3 symbols × 2 calls) × 500ms = 3s queue wait (down from 6s).
//   OpenAI rate limit is 20 req/s; 500ms spacing = 2 req/s — well within limit.
//   fetchTimeoutMs reduced 55,000ms → 35,000ms to align with tightened Netlify timeout.
//
// FIX PART 3: netlify/functions/openai-chat.ts OPENAI_REQUEST_TIMEOUT_MS 38,000→28,000ms.
//   38s was too close to the 50s Netlify limit; with 3-8s pre-call overhead the function
//   was getting killed mid-stream, producing hard 504s. 28s + 8s overhead = 36s, leaving
//   14s of recovery margin before Netlify terminates.
export const CONCURRENT_EXECUTION_CONFIG: ConcurrentExecutionConfig = {
  enabled: true,

  concurrency: {
    // CCIP-2026-03-12: Increased 3→5. Combined with rolling concurrency pool in
    // orchestrator (replaces batch-sequential), 5 slots means up to 5 symbols evaluate
    // in parallel at all times. As soon as any slot frees the next symbol starts.
    // Queue budget: 5 symbols × 2 LLM calls × 100ms = 1s — well within OpenAI 20 req/s.
    maxConcurrentSymbols: 5,
    symbolTimeoutMs: 90000,  // 90s base — unchanged, still provides 4× headroom over ~21s pipeline
    batchTimeoutMs: 360000,  // 360s total — retained for compatibility
    // CCIP-2026-03-12: Reduced 420s → 300s. With 5-wide rolling pool and 1 retry,
    // worst-case is 2 waves of ~120s each = 240s + 60s buffer = 300s.
    // Previous budget (3 batches × 120s + 60s) no longer applies with rolling pool.
    councilTimeoutMs: 300000,

    useSessionTimeouts: true,
    sessionTimeouts: {
      asian: 90000,      // 90s — was 60s. Queue wait 6s + API 10s + build 5s = 21s actual; 90s gives 4× headroom
      london: 100000,    // 100s — was 70s. Prevents NAS100/US30 timeout that was logged in prod
      nyse: 110000,      // 110s — was 80s. High volatility requires complex thesis generation
      overlap: 120000,   // 120s — was 90s. London+NYSE overlap: highest complexity allowed
      off_hours: 75000,  // 75s — was 50s. Limited activity but queue wait unchanged
    },
  },

  earlyExit: {
    enabled: true,
    // CCIP-2026-03-11: Raised 60→72. At 60% the threshold was rarely met cleanly, causing
    // all 9 symbols to be evaluated even when a strong signal existed in batch 1.
    // At 72% a clear high-confidence signal terminates the batch immediately, cutting
    // scan time from 3 full batches to 1 batch when a strong trade is present.
    minConfidenceThreshold: 72,
    gracePeriodSymbols: 0,
  },

  // CCIP-2026-03-11: Added omega8 section to eliminate magic number in alpha-omega-orchestrator.ts.
  // HIGH_CONFIDENCE = 70 was a local constant violating SSOT. Consumers MUST call
  // getOmega8DeterministicThreshold() — do NOT redeclare this value locally.
  // Lowered 70→60: pushes more symbols to Omega-8 deterministic path, cutting ~3-8s
  // of LLM refinement latency per symbol. Conflict detection quality is preserved because
  // the threshold only determines LLM refinement routing, not final trade confidence.
  omega8: {
    deterministicThreshold: 60,
    // CCIP-2026-03-12: Set to false. Symbols with conf > LLM_CONFIDENCE_UPPER (65) skip
    // the conflict bypass LLM call. The deterministic scoring already resolved the direction
    // at that confidence level. LLM refinement on conflicting signals at conf>65 rarely
    // changed the final direction but always added 5-10s extra per affected symbol.
    conflictingSignalsLlmEnabled: false,
  },

  // CCIP-2026-03-12: Resilience block added as SSOT for retry policy.
  // openai-client.ts MUST read maxRetries via getMaxRetries() — do NOT use errorHandling.
  // maxRetries reduced 2→1: worst-case double-504 caps at 57s (1 retry) vs 88s (2 retries).
  resilience: {
    maxRetries: 1,
    retryDelayMs: 500,
  },

  rateLimiting: {
    enabled: true,
    maxLLMCallsPerSecond: 20,
    minBatchDelayMs: 100,
    // ARCHITECTURAL NOTE: intraBatchStaggerMs is intentionally set to 0.
    // Rate limiting is enforced at the correct layer: openai-client.ts LLMRequestQueue.
    // The queue enforces minimum inter-call spacing between ALL OpenAI calls, regardless
    // of how many concurrent symbol evaluations are in flight. The stagger here was
    // solving the problem at the wrong layer (pipeline start vs LLM call point), causing
    // symbols that start together to still converge at the LLM call after processing.
    intraBatchStaggerMs: 0,
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
    enabled: true,
    alertThresholdMs: 120000, // Alert if batch takes > 120 seconds
    alertErrorRatePercent: 30, // Alert if > 30% of symbols fail
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
 * SSOT: Get Omega-8 deterministic confidence threshold.
 * Omega-8 votes at or above this threshold use the fast deterministic path.
 * Votes below this threshold are routed to the LLM refinement path (slower).
 * All Omega-8 consumers MUST call this function — do NOT redeclare locally.
 */
export function getOmega8DeterministicThreshold(): number {
  return CONCURRENT_EXECUTION_CONFIG.omega8.deterministicThreshold;
}

/**
 * SSOT: Get the council evaluation timeout (milliseconds).
 * This wraps the entire multi-symbol evaluateMultipleSymbols() call.
 * goal-session-live-engine.ts MUST call this function — do NOT hardcode.
 */
export function getCouncilTimeoutMs(): number {
  return CONCURRENT_EXECUTION_CONFIG.concurrency.councilTimeoutMs;
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
 * SSOT: Whether Omega-8 conflicting-signals bypass should trigger an LLM call.
 * When false (CCIP-2026-03-12), symbols with conf > LLM_CONFIDENCE_UPPER skip
 * the conflict-bypass LLM path, saving 5-10s per affected symbol.
 */
export function getOmega8ConflictingSignalsLlmEnabled(): boolean {
  return CONCURRENT_EXECUTION_CONFIG.omega8.conflictingSignalsLlmEnabled;
}

/**
 * SSOT: Maximum LLM retries per call.
 * openai-client.ts MUST call this — do NOT hardcode a retry count locally.
 */
export function getMaxRetries(): number {
  return CONCURRENT_EXECUTION_CONFIG.resilience.maxRetries;
}

/**
 * SSOT: Base delay between LLM retries (milliseconds).
 */
export function getRetryDelayMs(): number {
  return CONCURRENT_EXECUTION_CONFIG.resilience.retryDelayMs;
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
Mode: ${mode} | Concurrency: ${concurrency} | Pool: ROLLING
Early-Exit: ${config.earlyExit.enabled ? `YES (${config.earlyExit.minConfidenceThreshold}% threshold)` : 'NO'}
Rate Limiting: ${config.rateLimiting.enabled ? `${config.rateLimiting.maxLLMCallsPerSecond} calls/sec` : 'DISABLED'}
Timeouts (Base): ${config.concurrency.symbolTimeoutMs}ms/symbol, ${config.concurrency.batchTimeoutMs}ms/batch
Council Timeout: ${config.concurrency.councilTimeoutMs}ms
Session Timeouts: ${sessionTimeoutsStr}
Omega-8 Deterministic Threshold: ${config.omega8.deterministicThreshold}% | Conflict LLM Bypass: ${config.omega8.conflictingSignalsLlmEnabled ? 'ENABLED' : 'DISABLED'}
Resilience: maxRetries=${config.resilience.maxRetries}, retryDelay=${config.resilience.retryDelayMs}ms
Tracking: ${config.tracking.enabled ? 'ENABLED' : 'DISABLED'}
Governance: ${config.governance.enabled ? 'ENABLED' : 'DISABLED'}
`.trim();
}
