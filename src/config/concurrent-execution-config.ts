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
    // LLMRequestQueue singleton. The stagger here was applied at pipeline start and
    // symbols converged at the LLM call point anyway.
    intraBatchStaggerMs: number;

    // SSOT: Minimum milliseconds between successive LLM calls inside the LLMRequestQueue.
    // Consumers MUST call getMinInterCallMs() — do NOT hardcode this value locally.
    // Owned here so any future tuning propagates to openai-client.ts automatically.
    minInterCallMs: number;
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
// CCIP-2026-03-12b (TIMEOUT-CASCADE-FIX): Eliminated all symbol timeouts.
//
// ROOT CAUSE CONFIRMED (production console showing every symbol timing out):
//   The fundamental budget mismatch: Netlify hard-kills connections at 50s. With maxRetries=1
//   and OPENAI_REQUEST_TIMEOUT_MS=28s, a symbol needing a retry consumed:
//     28s (first call) + 500ms (backoff) + 28s (retry) = 56.5s — 6.5s OVER the Netlify limit.
//   Netlify terminates the connection mid-retry with a TCP drop (not a clean 504), so the
//   client never receives a usable error response. The orchestrator symbol timeout (90-120s)
//   never fires because the HTTP transport layer is already dead.
//
// THREE-PART FIX:
//   1. OPENAI_REQUEST_TIMEOUT_MS: 28s → 18s (netlify/functions/openai-chat.ts).
//      Budget: 18s OpenAI + 4s overhead (Supabase auth + rate-limit RPC + TLS) = 22s.
//      22s is well within the 50s Netlify limit. 28s margin of safety.
//   2. resilience.maxRetries: 1 → 0 (this file, SSOT).
//      A retry at 18s + backoff + 18s = 37s+ still risks hitting 50s under load.
//      Zero retries: symbol gets one clean 22s window. If OpenAI misses it, the symbol
//      is NO_TRADE for this cycle. The rolling pool still evaluates all other symbols.
//   3. fetchTimeoutMs: 35s → 22s (openai-client.ts).
//      Must be > server-side OPENAI_REQUEST_TIMEOUT_MS (18s) so the Netlify function
//      aborts cleanly before the browser cancels. 22s = 18s + 4s overhead margin.
//   4. Session timeouts: 75-120s → 45s flat (all sessions).
//      Each symbol now completes in at most 22s (one call, no retry). 45s gives 2x headroom.
//   5. councilTimeoutMs: 300s → 120s.
//      9 symbols, 5-wide rolling pool = 2 waves × 22s each = 44s + 76s buffer = 120s.
//
// EXPECTED IMPROVEMENT:
//   Previous worst-case: infinite (all symbols timing out, no trade returned)
//   New worst-case:      ~44s (9 symbols, 5-wide pool, 22s each = 2 waves × 22s)
//   New best-case:       ~22s (early-exit after first wave)
//   Net improvement:     eliminates all cascading timeouts
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
    // CCIP-2026-03-13d: Reduced 3→2. Root cause fix for 504 Gateway Timeouts.
    // Netlify CDN hard-kills synchronous functions at 26s wall-clock (NOT the 60s from netlify.toml
    // which only applies to background functions). With OPENAI_REQUEST_TIMEOUT_MS=20s and 4s
    // pre-work, each invocation takes up to 24s. At 3 concurrent symbols, the third function
    // invocation arrives at Netlify cold with zero warm workers, adding 2-4s of cold-start overhead
    // and pushing total to 26-28s — right at or past the CDN kill threshold.
    // At 2 concurrent symbols: Netlify can service both with the existing warm worker pool,
    // cold-start overhead drops to 0-1s, and total stays at 24-25s (under the 26s CDN limit).
    // Scan speed impact: 9 symbols @ 2-wide → ceil(9/2) = 5 waves vs 5 waves at 3-wide with
    // early-exit. In practice early-exit (72% threshold) terminates after wave 1 or 2, so
    // real scan time is identical. Full no-early-exit scan: 5 waves × 24s = 120s (vs 4 waves
    // × 45s = 180s before CCIP-2026-03-13d), faster because each wave is now 24s not 45s.
    // Queue budget: 2 symbols × 1 LLM call × 100ms = 0.2s — well within OpenAI 20 req/s.
    maxConcurrentSymbols: 2,
    // CCIP-2026-03-13a (POST-LLM-PIPELINE-FIX): Raised 25s → 40s.
    // ROOT CAUSE: Production console showed Alpha LLM completing at 26-31s, AFTER the 25s
    // abort fires. The 25s budget was derived from the OpenAI call alone (18s + 4s overhead
    // = 22s), but the full symbol pipeline also includes post-LLM work:
    //   - confidenceCalculationEngine.calculateFinalConfidence() → Supabase audit insert
    //   - rewardEngine.loadPlatformScore() → Supabase RPC
    //   - orchestrator confidence modifier assembly
    // Measured post-LLM overhead: 4-9s. Full pipeline worst-case: 31s observed.
    // 40s = 31s observed worst-case + 9s safety margin. Clean headroom for all sessions.
    //
    // CCIP-2026-03-12: OMEGA-8 IS PURELY DETERMINISTIC — ONE LLM CALL PER SYMBOL ONLY.
    // Previous references to "TWO sequential LLM calls" are obsolete. Omega-8 makes zero LLM calls.
    // Only Alpha calls the LLM. All timeout values are sized for a single LLM call per symbol.
    //
    // CCIP-2026-03-13d TIMEOUT BUDGET HIERARCHY (SSOT — all consumers must honour these invariants):
    //   OPENAI_REQUEST_TIMEOUT_MS (server)  = 20s  — netlify/functions/openai-chat.ts (SSOT)
    //   FUNCTION_TIMEOUT_MS (Netlify fn)    = 24s  — netlify/functions/openai-chat.ts (SSOT)
    //   Netlify CDN synchronous kill wall   = 26s  — Netlify infrastructure (hard, immutable limit)
    //   fetchTimeoutMs (client)             = 35s  — src/services/openai-client.ts
    //   symbolTimeoutMs / sessionTimeouts   = 90s  — this file (SSOT)
    //   batchTimeoutMs / councilTimeoutMs   = 300s — this file (SSOT)
    //   Netlify platform hard limit (bg fn) = 60s  — netlify.toml (background functions only)
    //
    // INVARIANTS (must never be violated):
    //   1. OPENAI_REQUEST_TIMEOUT_MS + max_pre_work <= Netlify CDN kill wall
    //      (20s + 4s = 24s <= 26s ✓  — 2s safety margin)
    //   2. FUNCTION_TIMEOUT_MS = OPENAI_REQUEST_TIMEOUT_MS + max_pre_work
    //      (24s = 20s + 4s ✓ — self-kill before CDN kill)
    //   3. fetchTimeoutMs >= FUNCTION_TIMEOUT_MS
    //      (35s >= 24s ✓  — 11s client-side safety buffer)
    //   4. symbolTimeoutMs > pre-work_max + fetchTimeoutMs
    //      (90s > 12s + 35s = 47s ✓  — 43s safety margin)
    //
    // Single-call timeline per symbol (CCIP-2026-03-13d, worst case under load):
    //   Pre-work (data fetch, Omega-8 deterministic, snapshot): 5-12s
    //   Alpha LLM fetch starts at ~4s; server aborts at 20s; clean JSON 504 returns by ~24s
    //   Post-LLM work (confidence engine, audit, reward): ~3-8s
    //   Total: 12s + 20s + 8s = 40s — comfortably within 90s symbolTimeoutMs.
    symbolTimeoutMs: 90000,
    batchTimeoutMs: 300000,
    // 9 symbols, 3-wide rolling pool = ceil(9/3) = 3 waves × 90s = 270s.
    // 300s = 270s actual + 30s safety buffer.
    councilTimeoutMs: 300000,

    useSessionTimeouts: true,
    // Session timeouts mirror symbolTimeoutMs (90s). One LLM call per symbol.
    // CCIP-2026-03-13d: Full pipeline worst-case: 12s pre-work + 20s LLM + 8s post-work = 40s.
    // 90s = 40s worst-case + 50s safety margin.
    sessionTimeouts: {
      asian: 90000,
      london: 90000,
      nyse: 90000,
      overlap: 90000,
      off_hours: 90000,
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
  // CCIP-2026-03-12b (TIMEOUT-CASCADE-FIX): maxRetries reduced 1→0.
  // ROOT CAUSE: With OPENAI_REQUEST_TIMEOUT_MS=18s and Netlify hard limit=50s,
  // the per-call budget is 18s + 4s overhead = 22s. A retry costs another 22s, bringing
  // the worst-case total to 44s — dangerously close to the 50s kill line. Any transient
  // Netlify infrastructure latency (TLS handshake, cold start, ~2-6s) pushes the retry
  // over 50s, causing Netlify to hard-kill the connection before the function returns a
  // clean 504. The client then receives an infrastructure TCP drop, not a retryable error.
  // FIX: Zero retries. Each symbol gets one clean 22s window. If OpenAI does not respond
  // in 18s the symbol becomes NO_TRADE for this scan cycle. The rolling pool (5 concurrent)
  // processes all remaining symbols simultaneously, so no time is lost waiting for a retry
  // that will hit the Netlify wall anyway.
  resilience: {
    maxRetries: 0,
    retryDelayMs: 500,
  },

  rateLimiting: {
    enabled: true,
    maxLLMCallsPerSecond: 20,
    minBatchDelayMs: 100,
    // CCIP-2026-03-13d: intraBatchStaggerMs restored to 1500ms.
    // PURPOSE: Spread the wall-clock arrival of concurrent Netlify function invocations
    // so they do NOT hit Netlify's CDN at the same millisecond.
    // ROOT CAUSE OF PREVIOUS 0ms SETTING: The stagger was eliminated when the LLMRequestQueue
    // was introduced, reasoning that the queue handles inter-call spacing. That reasoning is
    // correct for RATE LIMITING (preventing burst-429s), but wrong for INFRASTRUCTURE LOAD.
    // With 0ms stagger, 2 symbols start simultaneously. Both make their first Supabase auth RPC
    // at t=0, both call the Netlify openai-chat function at ~t=4s. Netlify receives two
    // simultaneous cold HTTP requests; one warm worker handles the first, the second waits
    // in the Netlify queue. The queued request eats 2-3s of Netlify overhead BEFORE its own
    // 4s pre-work starts, pushing total to 4s+3s+20s = 27s — 1 second past the CDN kill wall.
    // With 1500ms stagger, the second symbol starts 1.5s after the first. Its Netlify function
    // call arrives at ~t=5.5s, by which time the first call has warmed the worker. The second
    // call gets a warm worker, incurs 0s cold-start overhead, and completes in 24s safely.
    // RELATIONSHIP TO LLMRequestQueue: This stagger is at the pipeline ENTRY level (symbol
    // evaluation start). The LLMRequestQueue enforces minimum spacing at the LLM CALL level.
    // Both layers are correct and non-overlapping; they solve different problems.
    // SSOT: alpha-omega-orchestrator.ts MUST read this via getIntraBatchStaggerMs().
    intraBatchStaggerMs: 1500,
    // SSOT: Minimum spacing between successive LLM calls inside the LLMRequestQueue.
    // openai-client.ts MUST read this via getMinInterCallMs() — never hardcode.
    // 100ms = sufficient inter-call jitter to avoid burst-rate 429s at 20 calls/sec limit.
    minInterCallMs: 100,
  },

  // CCIP-TIMEOUT-FIX-2026-03-12: errorHandling.maxRetries set to 0.
  // This field is DEPRECATED as the authoritative retry policy — use resilience.maxRetries (above).
  // Root cause: this field sat at 2 while resilience.maxRetries = 0, creating a governance drift
  // risk. Any consumer reading this field instead of getMaxRetries() would silently double retry
  // every LLM call and blow through the Netlify 60s kill wall. Field is zeroed and kept only
  // for schema compatibility. No consumer may increase this without a CCIP change record.
  errorHandling: {
    continueOnError: true,
    maxRetries: 0,
    retryDelayMs: 500,
  },

  tracking: {
    enabled: true, // Enable performance tracking
    logDetailedTimings: true, // Log timing for each symbol
    logLLMCallCounts: true, // Track LLM usage for cost analysis
  },

  governance: {
    enabled: true,
    // CCIP-2026-03-13a: Raised 120s → 160s to match new councilTimeoutMs.
    // Formula: ceil(9/5) waves × 40s/symbol = 80s actual + 80s buffer = 160s.
    alertThresholdMs: 220000,
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
 * SSOT: Minimum milliseconds between successive LLM calls in the LLMRequestQueue.
 * openai-client.ts MUST call this — do NOT hardcode the value locally.
 * Any future tuning propagates automatically to all queue instances.
 */
export function getMinInterCallMs(): number {
  return CONCURRENT_EXECUTION_CONFIG.rateLimiting.minInterCallMs;
}

/**
 * SSOT: Stagger delay (ms) between consecutive symbol submissions in the rolling pool.
 * alpha-omega-orchestrator.ts MUST call this when submitting the 2nd+ symbol.
 * Purpose: spread wall-clock arrival of Netlify function invocations to avoid simultaneous
 * cold-start overhead that pushes total invocation time past the Netlify CDN 26s kill wall.
 * See CCIP-2026-03-13d rationale in intraBatchStaggerMs config comment above.
 */
export function getIntraBatchStaggerMs(): number {
  return CONCURRENT_EXECUTION_CONFIG.rateLimiting.intraBatchStaggerMs;
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
