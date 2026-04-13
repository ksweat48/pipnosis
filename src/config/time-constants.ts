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
    //
    // CCIP-STABILITY-FIX-2026-03-03: ALPHA_THESIS restored to 15 minutes.
    // REASON: The 5-minute TTL (set 2026-02-20) was too aggressive. In low-volatility
    // sideways markets it forced full LLM thesis regeneration for all 9 symbols every
    // scan cycle, driving scan times to 126s (>120s governance alert threshold) and
    // a 66.7% symbol error rate (NAS100/EURUSD timing out at 40s per symbol).
    //
    // CCIP-CACHE-WRITE-FIX-2026-03-19: ALPHA_THESIS extended to 30 minutes.
    // REASON: The platform switched from gpt-4o-mini to gpt-4o (CCIP-2026-0317A), making
    // each scan approximately 15x more expensive ($0.004 → $0.055 per call). A longer TTL
    // ensures more users benefit from a single shared thesis before it expires.
    // Two independent early-invalidation mechanisms ensure freshness is never compromised:
    //   1. Structural early-invalidation: H1+ candle close evicts local cache immediately
    //      via SharedIntelligenceCoordinator.invalidateThesisForSymbol() (candle-cache-manager)
    //   2. Regime signature change: detectRegimeChange() invalidates cache on any material
    //      htfBias / microRegime / volatilityRegime / structureState shift
    //
    // The 5-minute floor in trade-execution-freshness-gate.ts (SEVERITY_THRESHOLDS.ALPHA.CRITICAL)
    // controls execution staleness rejection, not how long a structurally valid thesis lives.
    // These are orthogonal concerns. A 30-minute thesis is valid as long as its regime
    // signature matches — the freshness gate remains the executor's independent guard.
    //
    // MARKET_CONTEXT unchanged at 5 minutes: deterministic computation, zero API cost,
    // no LLM regeneration risk.
    ALPHA_THESIS: 1_800_000, // 30 minutes (extended from 15 min — see CCIP-CACHE-WRITE-FIX-2026-03-19)
    MARKET_CONTEXT: 300_000, // 5 minutes (deterministic, zero API cost)

    // CCIP-COORDINATOR-AUDIT-2026-03-03: Fresh cache threshold below which hash
    // validation is skipped. Just-created theses are validated at creation time;
    // a mismatch this early indicates a JSON serialisation artifact, not corruption.
    //
    // CCIP-CACHE-HASH-FIX-2026-03-08: Extended from 60 → 120 seconds.
    // In multi-symbol sessions the same thesis may be retrieved 65-110 seconds
    // after creation (second scan cycle). The 60 s window was too narrow, causing
    // legitimate fresh theses to fail the hash check on their first retrieval.
    // Root cause hash mismatch is also fixed separately (regimeSignature coercion),
    // but the wider window provides an additional safety margin while DB caches warm.
    FRESH_SKIP_HASH_SECONDS: 120,

    // Maximum character length for error messages stored in the audit trail.
    // Matches the column definition in cache_write_events (VARCHAR 255).
    AUDIT_ERROR_MESSAGE_MAX_LENGTH: 255,

    // CCIP-SNAPSHOT-TTL-SSOT-2026-03-03: Market snapshot cache TTLs per timeframe.
    // These were previously hardcoded inline in market-snapshot-cache.ts (SSOT violation).
    // Centralised here alongside ALPHA_THESIS so all cache lifetimes are governed in one place.
    //
    // Rationale for each TTL:
    //   M5:  10 s — rapid scalp setups; stale after one candle
    //   M15: 60 s — intraday context; acceptable within candle
    //   H1:  300 s (5 min) — structural context; valid across most of a candle
    //   H4:  600 s (10 min) — session-level context; very slow-moving
    //   D:   900 s (15 min) — daily bias; effectively static intraday
    //   DEFAULT: 60 s — safe fallback for unlisted timeframes
    SNAPSHOT_TTL_M5: 10_000,
    SNAPSHOT_TTL_M15: 60_000,
    SNAPSHOT_TTL_H1: 300_000,
    SNAPSHOT_TTL_H4: 600_000,
    SNAPSHOT_TTL_D: 900_000,
    SNAPSHOT_TTL_DEFAULT: 60_000,

    // CCIP-SNAPSHOT-TTL-SSOT-2026-03-03: Minimum candle counts required in snapshot building.
    // Previously magic numbers inside market-snapshot-cache.ts.
    SNAPSHOT_MIN_CANDLES_REQUIRED: 50,  // Hard minimum to build any snapshot
    SNAPSHOT_MIN_CANDLES_ATR: 10,       // Minimum non-zero ranges for valid ATR
    SNAPSHOT_CANDLE_FETCH_LIMIT: 300,   // How many candles to request from DB
  },

  // BROKER CLOCK DOMAIN — Single Source of Truth
  //
  // CCIP-BROKER-CLOCK-SKEW-2026-04-13:
  // Root cause: AAAfx broker writes open_time to the database in UTC+3 (EET/EEST).
  // Any DB query that uses Date.now() (UTC) as its upper bound silently excludes
  // all candles whose open_time is between UTC+now and UTC+now+3h.
  //
  // Symptom: charts loaded blank on the first render after a weekend/holiday break,
  // because the only new candles for that day had broker-timestamped open_times
  // that were approximately 3 hours ahead of UTC, outside the query window.
  //
  // Fix contract: every service that queries candles with a time upper bound MUST
  // add BROKER_CLOCK_SKEW_MS to the upper bound before issuing the query.
  //   endTime = new Date(Date.now() + TIME_MS.BROKER.CLOCK_SKEW_MS)
  //
  // SKEW value rationale:
  //   UTC+3 broker offset  = 3 hours = 10 800 000 ms
  //   DST safety headroom  = 1 hour  =  3 600 000 ms
  //   Total buffer         = 4 hours = 14 400 000 ms
  //
  // Do NOT apply this buffer to:
  //   - Crypto pairs (BTCUSD, ETHUSD): they trade 24/7 in UTC, no broker offset.
  //   - Forming-candle period boundaries: use broker_time from realtime_prices
  //     as the anchor instead (see chart-candle-poller.ts CCIP-2026-04-02).
  //   - Server-side aggregators: probe latestBrokerTime from realtime_prices and
  //     work entirely in the broker's clock domain (see continuous-candle-aggregator.ts).
  //
  // Owners of this contract:
  //   Primary  — ChartDataGuarantor.guaranteeChartData()
  //   Verify   — Any future service querying candles with a UTC upper bound
  BROKER: {
    CLOCK_SKEW_MS: 4 * 60 * 60 * 1000, // 14 400 000 ms — 3h broker offset + 1h DST headroom
    BROKER_OFFSET_HOURS: 3,             // AAAfx EET UTC offset (without DST)
    SAFETY_HEADROOM_HOURS: 1,           // Extra margin for DST transitions
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
