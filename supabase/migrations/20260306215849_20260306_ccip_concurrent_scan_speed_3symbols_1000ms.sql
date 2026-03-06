/*
  # CCIP-2026-03-06: Concurrent Scan Speed Upgrade

  ## Summary
  Increases trade scanning throughput by ~40% by raising concurrent symbol analysis
  from 2 to 3 symbols per batch. The LLM queue inter-call spacing is simultaneously
  reduced from 1500ms to 1000ms to keep the total queue wait budget identical.

  ## Changes
  - `src/config/concurrent-execution-config.ts`: maxConcurrentSymbols 2 → 3
  - `src/services/openai-client.ts`: minInterCallMs 1500ms → 1000ms

  ## Budget Math (Queue Wait Must Stay Constant)
  Old: (2 symbols × 2 LLM calls) × 1500ms = 6s queue wait
  New: (3 symbols × 2 LLM calls) × 1000ms = 6s queue wait
  Total pipeline remains: 6s queue + 10s API latency + 5s snapshot build = ~21s
  Session timeouts (90s-120s) still provide 4-5× safety margin.

  ## Impact
  9 symbols processed in 3 batches of 3 instead of 5 batches of 2.
  Theoretical total scan time reduction: ~40%.

  ## Anti-Thundering-Herd
  1000ms minimum inter-call spacing still prevents back-to-back 429 errors.
  OpenAI rate limit is 20 req/s; we send at most 1 req/s — well within limits.

  ## SSOT Compliance
  Single source of truth for concurrency: concurrent-execution-config.ts
  Single source of truth for LLM rate limiting: openai-client.ts LLMRequestQueue
  No other files require changes.
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata
) VALUES (
  'thesis_immutability_guard',
  gen_random_uuid(),
  'ccip_migration_applied',
  jsonb_build_object(
    'maxConcurrentSymbols', 2,
    'minInterCallMs', 1500,
    'batchCount_for_9_symbols', 5,
    'queue_wait_budget_ms', 6000
  ),
  jsonb_build_object(
    'maxConcurrentSymbols', 3,
    'minInterCallMs', 1000,
    'batchCount_for_9_symbols', 3,
    'queue_wait_budget_ms', 6000,
    'scan_speed_improvement_pct', 40
  ),
  'CCIP-2026-03-06: Concurrent scan speed upgrade. maxConcurrentSymbols 2→3, minInterCallMs 1500→1000ms. Queue budget unchanged at 6s. 9 symbols now process in 3 batches vs 5 batches (~40% faster).',
  jsonb_build_object(
    'ccip_id', 'CCIP-2026-03-06',
    'files_changed', jsonb_build_array(
      'src/config/concurrent-execution-config.ts',
      'src/services/openai-client.ts'
    ),
    'ssot_compliant', true,
    'ccip_compliant', true,
    'anti_thundering_herd_maintained', true,
    'openai_rate_limit_req_per_sec', 20,
    'our_max_req_per_sec', 1
  )
);
