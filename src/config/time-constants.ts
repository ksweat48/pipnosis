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

  CACHE: {
    SHORT: 30_000,
    MEDIUM: 60_000,
    LONG: 120_000,
    EXTENDED: 300_000,
    INTELLIGENCE: 7_200_000,
    DAILY: 86_400_000,
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
