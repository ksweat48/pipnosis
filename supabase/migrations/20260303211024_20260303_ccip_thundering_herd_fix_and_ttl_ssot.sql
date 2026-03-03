/*
  # CCIP-THUNDERING-HERD-FIX-2026-03-03

  ## Summary
  Documents two governance-tracked fixes to shared-intelligence-coordinator.ts.
  No schema changes required — both fixes are pure TypeScript runtime changes.
  This migration records the change intent in the CCIP mutation audit trail.

  ## Change 1 (MEDIUM) — Thundering Herd Concurrency Guard
  File: src/services/shared-intelligence-coordinator.ts

  Added inFlightThesisRequests: Map<string, Promise<AlphaMarketThesis>> to
  SharedIntelligenceCoordinator. On a cache miss, the coordinator checks for an
  existing in-flight Promise for the same symbol + regimeHash before calling the LLM.
  Concurrent callers await the shared Promise; the entry is removed in a finally block.
  The map is cleared in clearLocalCache() alongside localThesisCache (SSOT compliance).

  Impact:
  - Eliminates duplicate LLM calls on concurrent cache misses (9-symbol parallel scans,
    fresh deploy, or full cache clear scenarios)
  - Eliminates duplicate DB writes to cache_alpha_thesis
  - Adds IN-FLIGHT HIT log events with note: thundering_herd_guard_active

  ## Change 2 (LOW) — TTL Log String SSOT Compliance
  File: src/services/shared-intelligence-coordinator.ts

  Replaced hardcoded string literal ttl: '15min' with a derived expression:
  Math.round(THESIS_TTL_MS / 60000) + 'min'
  THESIS_TTL_MS is the canonical SSOT constant (TIME_MS.CACHE.ALPHA_THESIS in
  time-constants.ts). Log telemetry now reflects the actual configured TTL.

  ## CCIP Protocol
  - No interface changes; no schema changes
  - In-flight key space: symbol + regimeHash (same grain as localThesisCache)
  - finally block guarantees no stale in-flight entries
  - Post-deploy verification: monitor for thundering_herd_guard_active log events
*/

INSERT INTO ccip_mutation_audit (
  table_name,
  operation,
  user_id,
  authority_service,
  operation_id,
  primary_key_values,
  changed_columns,
  reason,
  governance_note,
  status
)
VALUES (
  'shared-intelligence-coordinator',
  'INSERT',
  '30177afc-5b98-41ab-832a-a3e5a875e6c0',
  'shared-intelligence-coordinator',
  'CCIP-THUNDERING-HERD-FIX-2026-03-03',
  jsonb_build_object('file', 'src/services/shared-intelligence-coordinator.ts'),
  jsonb_build_array(
    'inFlightThesisRequests_map_added',
    'getAlphaThesis_in_flight_guard',
    'clearLocalCache_clears_inflight_map',
    'ttl_log_string_ssot_derived'
  ),
  'CCIP-THUNDERING-HERD-FIX-2026-03-03: Added in-flight deduplication guard (inFlightThesisRequests Map) to prevent concurrent cache misses from spawning duplicate LLM calls. Fixed hardcoded ttl log string to derive from THESIS_TTL_MS SSOT constant.',
  'SSOT: key space matches localThesisCache. finally block prevents stale entries. clearLocalCache() clears both maps. TTL log derives from TIME_MS.CACHE.ALPHA_THESIS via THESIS_TTL_MS.',
  'success'
);
