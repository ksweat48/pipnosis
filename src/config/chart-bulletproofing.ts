/**
 * Chart Bulletproofing Configuration
 *
 * Central control for all chart protection features.
 * Set any flag to false to disable that protection layer.
 */

export const BULLETPROOF_CONFIG = {
  // Phase 1: Database Resilience
  enableDatabaseRetry: true,
  maxDatabaseRetries: 3,
  databaseRetryDelayMs: 1000,
  databaseTimeoutMs: 10000,

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
};

export type BulletproofConfig = typeof BULLETPROOF_CONFIG;
