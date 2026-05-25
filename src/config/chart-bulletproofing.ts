/**
 * Chart Bulletproofing Configuration
 *
 * Central control for all chart protection features.
 * Set any flag to false to disable that protection layer.
 */

export const BULLETPROOF_CONFIG = {
  // Phase 1: Database Resilience
  enableDatabaseRetry: true,
  maxDatabaseRetries: 1,
  databaseRetryDelayMs: 1000,
  databaseTimeoutMs: 5000,

  // Phase 2: Race Condition Prevention
  enableMutexLocks: true,
  mutexTimeoutMs: 30000,

  // Phase 3: Network Resilience
  enableNetworkFallback: true,
  maxNetworkRetries: 3,
  networkRetryDelayMs: 2000,

  // Phase 4: Database Deduplication (migration controlled)
  enableDuplicateDetection: true,

  // Phase 5: Memory Management
  enableMemoryManager: true,
  maxCachedCandles: 1000,
  memoryCleanupIntervalMs: 5 * 60 * 1000, // 5 minutes

  // Phase 6: Failsafe Manager
  enableFailsafe: true,
  cacheDurationMs: 5 * 60 * 1000, // 5 minutes
  enableDemoDataFallback: true,

  // Phase 7: Health Monitoring
  enableHealthMonitoring: true,
  healthCheckIntervalMs: 10000,

  // Phase 8: Enhanced Error Messages
  enableEnhancedErrors: true,

  // Phase 9: Exponential Backoff Strategy (CCIP Governance - SSOT)
  // Prevents thundering-herd on timeouts through exponential backoff
  enableExponentialBackoff: true,
  backoffInitialDelayMs: 1000,           // Start with 1 second
  backoffMaxDelayMs: 32000,              // Cap at 32 seconds (prevents extreme wait)
  backoffMultiplier: 1.5,                // Multiply by 1.5 on each retry: 1s, 1.5s, 2.25s, 3.375s...
  backoffJitterEnabled: true,            // Add random jitter to prevent synchronized retries
  backoffJitterPercentage: 0.2,          // Add 20% random jitter to delay

  // Circuit Breaker Configuration
  // Gracefully degrade under sustained load
  enableCircuitBreaker: true,
  circuitBreakerFailureThreshold: 5,     // Trigger after 5 consecutive failures
  circuitBreakerRecoveryTimeMs: 30000,   // Try to recover after 30 seconds
  circuitBreakerResetFailureCount: 2,    // Reset on 2 consecutive successes
};

export type BulletproofConfig = typeof BULLETPROOF_CONFIG;
