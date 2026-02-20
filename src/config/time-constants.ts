/**
 * TIME CONSTANTS - Single Source of Truth
 *
 * All time-related values MUST be defined here.
 * DO NOT hardcode time values elsewhere in the codebase.
 *
 * Usage: import { TIME_CONSTANTS, TIME_MS } from '@/config/time-constants';
 */

export const TIME_CONSTANTS = {
  SECONDS: {
    PRICE_STALENESS_WARNING: 30,
    PRICE_STALENESS_CRITICAL: 60,
    PRICE_STALENESS_BLOCK_TRADING: 120,
    PRICE_STALENESS_ABSOLUTE_MAX: 600, // 10 minutes - reject anything older than this

    CACHE_TTL_SHORT: 30,
    CACHE_TTL_MEDIUM: 60,
    CACHE_TTL_LONG: 120,
    CACHE_TTL_EXTENDED: 300,

    COOLDOWN_SHORT: 30,
    COOLDOWN_STANDARD: 60,
    COOLDOWN_LONG: 120,
    COOLDOWN_EXTENDED: 300,

    NOTIFICATION_DEDUPE_WINDOW: 60,

    EMERGENCY_PRICE_THRESHOLD: 120,

    CIRCUIT_BREAKER_RESET: 300,
  },

  MINUTES: {
    SESSION_TIMEOUT: 15,
    WELLNESS_CHECK_INTERVAL: 15,
    PERIODIC_CHECK_INTERVAL: 30,
    GAP_FILL_INTERVAL: 5,

    PRICE_STALE_WARNING: 5,
    PRICE_STALE_CRITICAL: 10,

    MAX_TRADE_DURATION: 1440,
  },

  HOURS: {
    CACHE_INTELLIGENCE: 2,
    CACHE_DAILY: 24,
    MAX_SESSION_DURATION: 4,
  },
} as const;

export const TIME_MS = {
  POLLING: {
    FAST: 1000,
    CRYPTO: 1000,
    STANDARD: 3000,
    FOREX: 3000,
    SLOW: 5000,
    VERY_SLOW: 10000,
  },

  TIMEOUTS: {
    SHORT: 30_000,
    STANDARD: 60_000,
    LONG: 120_000,
    EXTENDED: 300_000,
    MAX_FUNCTION: 600_000,
  },

  // Service-specific timeout configurations (CCIP Governance SSOT)
  // These override TIMEOUTS above for specific services
  // All consumers MUST use these through their respective coordinators
  SERVICE_TIMEOUTS: {
    PRICE_COORDINATOR: {
      QUERY_TIMEOUT: 10_000,      // How long to wait for a price query
      RETRY_COUNT: 3,              // Maximum retry attempts
      BACKOFF_MULTIPLIER: 1.5,     // Exponential backoff: 1s, 1.5s, 2.25s
      CIRCUIT_BREAKER_THRESHOLD: 0.05, // Activate at 5% timeout rate
    },
    POSITION_MONITOR: {
      QUERY_TIMEOUT: 15_000,       // Extended timeout for position monitoring
      RETRY_COUNT: 2,              // Fewer retries (position monitor is frequent)
      BACKOFF_MULTIPLIER: 2.0,     // More aggressive backoff to reduce load
      CIRCUIT_BREAKER_THRESHOLD: 0.1, // Activate at 10% timeout rate
    },
    REALTIME_SLTP_MONITOR: {
      QUERY_TIMEOUT: 12_000,       // SL/TP monitoring needs quick response
      RETRY_COUNT: 2,
      BACKOFF_MULTIPLIER: 1.5,
      CIRCUIT_BREAKER_THRESHOLD: 0.08, // 8% threshold
    },
    MID_TRADE_MONITOR: {
      QUERY_TIMEOUT: 20_000,       // Less frequent but critical
      RETRY_COUNT: 1,              // Minimal retries
      BACKOFF_MULTIPLIER: 1.0,     // No backoff (fail fast)
      CIRCUIT_BREAKER_THRESHOLD: 0.15, // 15% threshold
    },
    ENTRY_MONITORING: {
      QUERY_TIMEOUT: 10_000,       // Entry monitoring is not time-critical
      RETRY_COUNT: 3,
      BACKOFF_MULTIPLIER: 1.5,
      CIRCUIT_BREAKER_THRESHOLD: 0.05, // 5% threshold
    },
    GOAL_SESSION_SCANNER: {
      QUERY_TIMEOUT: 30_000,       // Batch operation, can wait longer
      RETRY_COUNT: 1,
      BACKOFF_MULTIPLIER: 1.0,
      CIRCUIT_BREAKER_THRESHOLD: 0.2, // 20% threshold (less critical)
    },
  },

  CACHE: {
    SHORT: 30_000,
    MEDIUM: 60_000,
    LONG: 120_000,
    EXTENDED: 300_000,
    INTELLIGENCE: 7_200_000,
    DAILY: 86_400_000,

    // CCIP-STALENESS-FIX-2026-02-20: Alpha intelligence cache authorities
    // These are the canonical TTLs for Alpha thesis and deterministic sentiment.
    // THESIS: 5 minutes aligns with SEVERITY_THRESHOLDS.ALPHA.CRITICAL (300s) in
    //   trade-execution-freshness-gate.ts — the gate already knows 300s is the
    //   "must regenerate" threshold, the thesis TTL now matches it exactly.
    // SENTIMENT: 5 minutes — deterministic computation, zero API cost.
    //   Early invalidation also fires on H1+ candle close via candle-cache-manager.
    ALPHA_THESIS: 300_000,   // 5 minutes (was 900_000 / 15 min)
    MARKET_CONTEXT: 300_000, // 5 minutes (was 15 min in sentiment-aggregator.ts)
  },

  DEBOUNCE: {
    FAST: 100,
    STANDARD: 300,
    SLOW: 500,
    VERY_SLOW: 1000,
  },

  THROTTLE: {
    PRICE_UPDATE: 1000,
    UI_REFRESH: 500,
    API_CALL: 3000,
    NOTIFICATION: 60_000,
  },

  INTERVALS: {
    POSITION_MONITOR: 3_000,
    CANDLE_AGGREGATION: 5_000,
    HEALTH_CHECK: 30_000,
    WELLNESS_CHECK: 900_000,
    GAP_FILL: 300_000,
  },
} as const;

export function secondsToMs(seconds: number): number {
  return seconds * 1000;
}

export function minutesToMs(minutes: number): number {
  return minutes * 60 * 1000;
}

export function hoursToMs(hours: number): number {
  return hours * 60 * 60 * 1000;
}

export function msToSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

export function msToMinutes(ms: number): number {
  return Math.floor(ms / 60000);
}

export function isOlderThan(timestamp: Date | number, maxAgeMs: number): boolean {
  const timestampMs = typeof timestamp === 'number' ? timestamp : timestamp.getTime();
  return Date.now() - timestampMs > maxAgeMs;
}

export function getAgeInSeconds(timestamp: Date | number): number {
  const timestampMs = typeof timestamp === 'number' ? timestamp : timestamp.getTime();
  return msToSeconds(Date.now() - timestampMs);
}
