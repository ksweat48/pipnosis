/**
 * CONCURRENCY LIMITER SERVICE
 *
 * SSOT AUTHORITY: This service is the SINGLE SOURCE OF TRUTH for:
 * - Controlling maximum concurrent trade analyses (semaphore pattern)
 * - Monitoring lock contention and system health
 * - Managing circuit breaker for automatic fallback to sequential mode
 *
 * CRITICAL: This service does NOT replace TradeProcessingLockService.
 * TradeProcessingLockService remains the authority for database-backed locking.
 * This service wraps around it to enable safe concurrent execution.
 *
 * RESPONSIBILITY:
 * - Limit concurrent trade checks to prevent system overload
 * - Track lock acquisition metrics for governance/CCIP compliance
 * - Implement circuit breaker: auto-fallback when contention > 40%
 * - Provide per-trade error isolation (one failure doesn't cascade)
 *
 * USAGE:
 *   const limiter = ConcurrencyLimiterService.getInstance();
 *   const result = await limiter.executeWithLimit(tradeId, async () => {
 *     // Your async trade check logic here
 *   });
 *
 * CCIP: CCIP-20260203-001 - Concurrent Trade Analysis System
 */

import { supabase } from '../lib/supabase';

export interface ConcurrencyResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  skipped?: boolean;
  reason?: string;
  executionTimeMs?: number;
  lockWaitTimeMs?: number;
}

export interface ConcurrencyMetrics {
  activeCount: number;
  maxConcurrent: number;
  contentionPercent: number;
  isCircuitBroken: boolean;
  sequentialFallbackActive: boolean;
  locksPerSecond: number;
}

class ConcurrencyLimiterService {
  private static instance: ConcurrencyLimiterService;

  // Semaphore: tracks active operations
  private activeOperations = new Set<string>();
  private operationQueue: Array<{
    tradeId: string;
    fn: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }> = [];

  // Configuration
  private maxConcurrent = 5;
  private maxConcurrentPerSymbol = 2;
  private lockTimeoutSeconds = 30;
  private readonly MIN_LOCK_WAIT_MS = 0;
  private readonly MAX_LOCK_WAIT_MS = 5000;

  // Metrics tracking
  private lockAttempts = new Map<string, number>(); // symbol -> count in last minute
  private lockFailures = new Map<string, number>(); // symbol -> failures in last minute
  private lastContention = 0;
  private contentionMeasurementTime = Date.now();
  private metricsCleanupInterval: NodeJS.Timeout | null = null;

  // Circuit breaker state
  private isCircuitBroken = false;
  private circuitBreakReason: string | null = null;
  private sequentialFallbackActive = false;
  private circuitBreakerStartTime: number | null = null;
  private readonly CIRCUIT_BREAK_RECOVERY_TIME_MS = 5 * 60 * 1000; // 5 minutes
  private readonly LOCK_FAILURE_THRESHOLD = 0.4; // 40%
  private readonly LOCK_FAILURE_RECOVERY_THRESHOLD = 0.15; // 15%

  // Batch tracking for governance
  private currentBatchId: string | null = null;
  private batchStartTime = Date.now();
  private readonly BATCH_DURATION_MS = 60000; // 1 minute batches

  private constructor() {
    this.initializeMetricsCleanup();
    this.loadConfiguration();
  }

  static getInstance(): ConcurrencyLimiterService {
    if (!ConcurrencyLimiterService.instance) {
      ConcurrencyLimiterService.instance = new ConcurrencyLimiterService();
    }
    return ConcurrencyLimiterService.instance;
  }

  /**
   * Load configuration from database (SSOT)
   * Gracefully degrades if RPC is unavailable
   */
  private async loadConfiguration(): Promise<void> {
    try {
      const { data, error } = await supabase.rpc('get_concurrency_state');

      if (error) {
        // Graceful degradation: use default config if RPC unavailable
        // Suppress AbortError during initialization
        if (!error.message?.includes('AbortError')) {
          console.warn('[ConcurrencyLimiter] RPC unavailable, using defaults:', error.message);
        }
        this.maxConcurrent = 5;
        this.isCircuitBroken = false;
        return;
      }

      if (data && data[0]) {
        const config = data[0];
        this.maxConcurrent = config.max_concurrent_trades || 5;
        this.isCircuitBroken = config.is_circuit_broken || false;
        this.circuitBreakReason = config.circuit_break_reason;
        this.sequentialFallbackActive = config.sequential_fallback_active || false;

        console.log(
          `[ConcurrencyLimiter] ✅ Loaded config: max=${this.maxConcurrent}, ` +
          `circuit=${this.isCircuitBroken ? 'broken' : 'ok'}, ` +
          `contention=${(config.lock_contention_rate_percent || 0).toFixed(1)}%`
        );
      }
    } catch (error) {
      // Network error or service unavailable - use defaults
      console.warn('[ConcurrencyLimiter] Could not load config, using defaults');
    }
  }

  /**
   * Execute an async function with concurrency limiting
   * CRITICAL: This is the main entry point for all concurrent trade operations
   *
   * @param tradeId - ID of the trade being processed
   * @param fn - Async function to execute
   * @param symbol - (optional) Symbol for per-symbol limiting
   * @returns Result with success status and execution metrics
   */
  async executeWithLimit<T>(
    tradeId: string,
    fn: () => Promise<T>,
    symbol?: string
  ): Promise<ConcurrencyResult<T>> {
    const executionStartTime = performance.now();

    // CCIP-2026-03-09: Circuit breaker silent drop removed.
    // High lock-failure rates are logged loudly for diagnostics but NEVER block trade execution.
    // Alpha must always get an attempt — silent drops are a governance violation.
    if (this.isCircuitBroken) {
      console.error(
        `[ConcurrencyLimiter] CIRCUIT BREAKER ACTIVE (diagnostics only — execution continues): ${this.circuitBreakReason}. ` +
        `Trade ${tradeId} will attempt execution. Monitor lock-failure rate.`
      );
      // Attempt recovery in background but do not gate on it
      if (this.shouldRecoverCircuit()) {
        this.attemptCircuitRecovery().catch(() => {});
      }
    }

    // Check if we're at max concurrent capacity
    if (this.activeOperations.size >= this.maxConcurrent) {
      console.log(
        `[ConcurrencyLimiter] 📊 At capacity (${this.activeOperations.size}/${this.maxConcurrent}) - queuing trade ${tradeId}`
      );
      return new Promise((resolve) => {
        this.operationQueue.push({
          tradeId,
          fn,
          resolve: (result) => {
            resolve({
              success: result.success,
              data: result.data,
              error: result.error,
              executionTimeMs: performance.now() - executionStartTime
            });
          },
          reject: (error) => {
            resolve({
              success: false,
              error: error.message,
              executionTimeMs: performance.now() - executionStartTime
            });
          }
        });
      });
    }

    // Check per-symbol limit
    if (symbol && this.getActiveOperationsForSymbol(symbol) >= this.maxConcurrentPerSymbol) {
      console.log(
        `[ConcurrencyLimiter] 📊 Symbol limit reached for ${symbol} - queuing trade ${tradeId}`
      );
      return {
        success: false,
        skipped: true,
        reason: `Per-symbol limit reached for ${symbol}`,
        data: undefined
      };
    }

    // Add to active operations
    this.activeOperations.add(tradeId);
    console.log(`[ConcurrencyLimiter] ▶️ Started operation ${tradeId} (${this.activeOperations.size}/${this.maxConcurrent})`);

    try {
      const lockWaitStart = performance.now();
      const result = await fn();
      const lockWaitTime = Math.round(performance.now() - lockWaitStart);

      // Record success metrics
      await this.recordLockContention(tradeId, true, lockWaitTime, symbol);

      return {
        success: true,
        data: result,
        executionTimeMs: Math.round(performance.now() - executionStartTime),
        lockWaitTimeMs: lockWaitTime
      };
    } catch (error) {
      console.error(`[ConcurrencyLimiter] ❌ Operation failed for trade ${tradeId}:`, error);

      // Record failure metrics
      const lockWaitTime = Math.round(performance.now() - executionStartTime);
      await this.recordLockContention(tradeId, false, lockWaitTime, symbol);

      // Check if we should trigger circuit breaker
      await this.checkCircuitBreakerConditions();

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTimeMs: Math.round(performance.now() - executionStartTime),
        lockWaitTimeMs: Math.round(performance.now() - executionStartTime)
      };
    } finally {
      this.activeOperations.delete(tradeId);
      console.log(`[ConcurrencyLimiter] ⏹️ Completed operation ${tradeId} (${this.activeOperations.size}/${this.maxConcurrent})`);

      // Process queue
      this.processQueue();
    }
  }

  /**
   * Record lock contention metrics for governance/CCIP compliance
   * Gracefully degrades if RPC is unavailable (in-memory metrics still tracked)
   */
  private async recordLockContention(
    tradeId: string,
    acquired: boolean,
    waitTimeMs: number,
    symbol?: string
  ): Promise<void> {
    try {
      // Update in-memory metrics (always works)
      if (symbol) {
        const attempts = this.lockAttempts.get(symbol) || 0;
        this.lockAttempts.set(symbol, attempts + 1);

        if (!acquired) {
          const failures = this.lockFailures.get(symbol) || 0;
          this.lockFailures.set(symbol, failures + 1);
        }
      }

      // Try to record to database (non-blocking if fails)
      try {
        const { error } = await supabase.rpc('record_lock_contention', {
          p_trade_id: tradeId,
          p_lock_system: 'ConcurrencyLimiter',
          p_lock_acquired: acquired,
          p_acquisition_wait_time_ms: Math.min(waitTimeMs, this.MAX_LOCK_WAIT_MS),
          p_active_locks_at_attempt: this.activeOperations.size,
          p_system_load_percent: (this.activeOperations.size / this.maxConcurrent) * 100
        });

        if (error) {
          // Graceful degradation: in-memory metrics still tracked
          if (error.message?.includes('Could not find the function')) {
            // RPC function not yet deployed, that's ok
            return;
          }
          console.warn('[ConcurrencyLimiter] Database metrics unavailable:', error.message);
        }
      } catch (rpcError) {
        // Network error or database unavailable - in-memory metrics still tracked
        console.debug('[ConcurrencyLimiter] Database recording failed (non-blocking)');
      }
    } catch (error) {
      // Should never reach here, but handle gracefully
      console.error('[ConcurrencyLimiter] Error in recordLockContention:', error);
    }
  }

  /**
   * Check if we should trigger circuit breaker
   * Breaks circuit if lock failure rate > 40% in recent window
   */
  private async checkCircuitBreakerConditions(): Promise<void> {
    // Calculate failure rate
    let totalAttempts = 0;
    let totalFailures = 0;

    this.lockAttempts.forEach((count, symbol) => {
      totalAttempts += count;
      totalFailures += this.lockFailures.get(symbol) || 0;
    });

    if (totalAttempts === 0) return;

    const failureRate = totalFailures / totalAttempts;

    if (failureRate > this.LOCK_FAILURE_THRESHOLD) {
      console.error(
        `[ConcurrencyLimiter] 🔴 CIRCUIT BREAK: Lock failure rate ${(failureRate * 100).toFixed(1)}% > ${(this.LOCK_FAILURE_THRESHOLD * 100).toFixed(0)}%`
      );

      this.isCircuitBroken = true;
      this.circuitBreakReason = `Lock failure rate: ${(failureRate * 100).toFixed(1)}%`;
      this.circuitBreakerStartTime = Date.now();
      this.sequentialFallbackActive = true;

      // Try to update database (non-blocking if fails)
      try {
        await supabase
          .from('concurrency_circuit_breaker')
          .insert({
            state: 'open',
            reason: this.circuitBreakReason,
            contention_rate_at_trigger: failureRate * 100,
            triggered_at: new Date().toISOString(),
            decision_id: `circuit-break-${Date.now()}`
          });
      } catch (error) {
        // Database unavailable, but circuit breaker still active in-memory
        console.warn('[ConcurrencyLimiter] Database circuit break logging failed (in-memory active):',
          error instanceof Error ? error.message : String(error));
      }
    }

    // Update contention metrics
    this.lastContention = failureRate * 100;
    this.contentionMeasurementTime = Date.now();
  }

  /**
   * Check if circuit should attempt recovery
   */
  private shouldRecoverCircuit(): boolean {
    if (!this.circuitBreakerStartTime) return false;

    const elapsed = Date.now() - this.circuitBreakerStartTime;
    return elapsed > this.CIRCUIT_BREAK_RECOVERY_TIME_MS;
  }

  /**
   * Attempt to recover circuit
   */
  private async attemptCircuitRecovery(): Promise<void> {
    try {
      // Check current failure rate
      let totalAttempts = 0;
      let totalFailures = 0;

      this.lockAttempts.forEach((count, symbol) => {
        totalAttempts += count;
        totalFailures += this.lockFailures.get(symbol) || 0;
      });

      if (totalAttempts === 0) {
        this.resetCircuitBreaker();
        return;
      }

      const failureRate = totalFailures / totalAttempts;

      if (failureRate <= this.LOCK_FAILURE_RECOVERY_THRESHOLD) {
        console.log(`[ConcurrencyLimiter] 🟢 CIRCUIT RECOVERED: Failure rate ${(failureRate * 100).toFixed(1)}% <= ${(this.LOCK_FAILURE_RECOVERY_THRESHOLD * 100).toFixed(0)}%`);
        this.resetCircuitBreaker();

        // Try to record recovery (non-blocking if fails)
        try {
          await supabase
            .from('concurrency_circuit_breaker')
            .insert({
              state: 'closed',
              reason: 'Recovered - failure rate below threshold',
              recovery_start_at: new Date().toISOString(),
              decision_id: `circuit-recover-${Date.now()}`
            });
        } catch (error) {
          console.debug('[ConcurrencyLimiter] Database recovery logging failed (in-memory recovered)');
        }
      }
    } catch (error) {
      console.error('[ConcurrencyLimiter] Error attempting recovery:', error);
    }
  }

  /**
   * Reset circuit breaker to normal operation
   */
  private resetCircuitBreaker(): void {
    this.isCircuitBroken = false;
    this.circuitBreakReason = null;
    this.sequentialFallbackActive = false;
    this.circuitBreakerStartTime = null;
    this.lockAttempts.clear();
    this.lockFailures.clear();
  }

  /**
   * Process queued operations
   */
  private async processQueue(): Promise<void> {
    if (this.activeOperations.size >= this.maxConcurrent || this.operationQueue.length === 0) {
      return;
    }

    const next = this.operationQueue.shift();
    if (!next) return;

    try {
      const result = await this.executeWithLimit(next.tradeId, next.fn);
      next.resolve(result);
    } catch (error) {
      next.reject(error);
    }
  }

  /**
   * Get active operations for a specific symbol
   */
  private getActiveOperationsForSymbol(symbol: string): number {
    // This would need to be tracked in concurrent_operation_tracking table
    // For now, return 0 (can be enhanced later)
    return 0;
  }

  /**
   * Get current metrics
   */
  async getMetrics(): Promise<ConcurrencyMetrics> {
    await this.loadConfiguration();

    return {
      activeCount: this.activeOperations.size,
      maxConcurrent: this.maxConcurrent,
      contentionPercent: this.lastContention,
      isCircuitBroken: this.isCircuitBroken,
      sequentialFallbackActive: this.sequentialFallbackActive,
      locksPerSecond: this.activeOperations.size
    };
  }

  /**
   * Initialize automatic metrics cleanup
   */
  private initializeMetricsCleanup(): void {
    if (this.metricsCleanupInterval !== null) return;

    // Rotate batch ID every minute
    this.metricsCleanupInterval = setInterval(async () => {
      this.currentBatchId = `batch-${Date.now()}`;

      // Clear old metrics
      const now = Date.now();
      if (now - this.contentionMeasurementTime > 60000) {
        this.lockAttempts.clear();
        this.lockFailures.clear();
      }

      // Cleanup old data from database (non-blocking)
      try {
        await supabase.rpc('cleanup_old_concurrency_data');
      } catch (error) {
        // Cleanup failure is non-critical - just log and continue
        console.debug('[ConcurrencyLimiter] Database cleanup skipped');
      }
    }, 60000);
  }

  /**
   * Stop the service (for cleanup)
   */
  stop(): void {
    if (this.metricsCleanupInterval !== null) {
      clearInterval(this.metricsCleanupInterval);
      this.metricsCleanupInterval = null;
    }
    this.activeOperations.clear();
    this.operationQueue = [];
    console.log('[ConcurrencyLimiter] ⏹️ Service stopped');
  }
}

export const concurrencyLimiterService = ConcurrencyLimiterService.getInstance();
