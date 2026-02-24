/*
  # CCIP Fix: Intra-Batch Stagger — Thundering-Herd 429 Resolution

  ## Summary
  Documents the governance change for the intra-batch stagger fix applied to the
  concurrent symbol evaluation pipeline.

  ## Root Cause
  The concurrent evaluation pipeline fired all 3 symbol analysis promises via
  Promise.allSettled() simultaneously with zero staggering. This caused all 3
  LLM proxy calls to hit OpenAI at the exact same millisecond per batch, triggering
  TPM (tokens-per-minute) rate limits on all 3 simultaneously. Each exhausted
  maxRetries=2 and returned NO_TRADE @ 0%, making sessions find no trades.

  ## Fix Applied
  1. Added intraBatchStaggerMs: 1500 to concurrent-execution-config.ts (SSOT)
  2. Added staggerDelayMs parameter to createSymbolEvaluationPromise()
  3. Each symbol in a batch now starts with: symbolIndex * 1500ms delay
     - symbol[0]: T+0ms (immediate)
     - symbol[1]: T+1500ms
     - symbol[2]: T+3000ms

  ## SSOT Compliance
  All stagger behavior controlled exclusively via concurrent-execution-config.ts

  ## CCIP Compliance
  Non-breaking: timeout values unchanged, only adds pre-call delay.
  Worst-case batch time increase: +3s per 3-symbol batch.
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
  'system_configuration',
  gen_random_uuid(),
  'configuration_update',
  '{"intraBatchStaggerMs": 0, "thunderingHerdProtection": false}'::jsonb,
  '{"intraBatchStaggerMs": 1500, "thunderingHerdProtection": true}'::jsonb,
  'CCIP-2026-02-24: Add 1500ms intra-batch stagger to prevent thundering-herd 429s. All 3 concurrent symbols were hitting OpenAI at the exact same millisecond causing all to 429-fail simultaneously.',
  '{"ccip": true, "root_cause": "thundering_herd_429", "fix": "intra_batch_stagger_1500ms", "affected_files": ["src/config/concurrent-execution-config.ts", "src/services/alpha-omega-orchestrator.ts"]}'::jsonb
);
