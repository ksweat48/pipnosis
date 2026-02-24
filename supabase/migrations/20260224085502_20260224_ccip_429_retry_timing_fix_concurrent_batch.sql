/*
  # CCIP Fix: Concurrent Batch 429 Retry Timing — Reduce Cap from 30s to 5s with Jitter

  ## Title
  OpenAI Transient 429 Retry Wait Cap Reduction (Concurrent Batch Safety Fix)

  ## Problem
  The previous session introduced OpenAI 429 source tagging and a retry-with-wait
  mechanic. The retry cap was set to 30,000ms (30 seconds). In the concurrent batch
  architecture (3 symbols evaluated simultaneously via Promise.allSettled), all 3
  symbols fire LLM calls at the same time. When all 3 receive a 429:

  - All 3 wait 30 seconds simultaneously (thundering-herd)
  - All 3 retry simultaneously at the same moment
  - All 3 get 429 again, wait another 30 seconds
  - All 3 exhaust maxRetries = 2 and return NO_TRADE @ 0%
  - Total: ~60s waiting against 70s London session timeout

  ## Root Cause
  openai-client.ts: Math.min(retryAfterMs, 30000) cap too large.
  openai-chat.ts: fallback retryAfterMs = 60000 when no Retry-After header.
  OpenAI TPM rate limits reset in 1-5 seconds, not 30s.

  ## Changes Made
  1. openai-client.ts: fallback 30000 -> 3000, cap 30000 -> 5000, added 0-2000ms jitter
  2. openai-chat.ts: fallback 60000 -> 3000
  Worst-case wait: 60s -> ~14s (well within 70s London timeout)

  ## Security
  No security changes. No new tables or RLS policies required.
*/

INSERT INTO governance_change_log (
  id,
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  created_at
) VALUES (
  gen_random_uuid(),
  'llm_pipeline_governance',
  gen_random_uuid(),
  'configuration_change',
  jsonb_build_object(
    'component', 'openai-client.ts + openai-chat.ts',
    'retry_cap_ms', 30000,
    'retryAfterMs_fallback_proxy', 60000,
    'retryAfterMs_fallback_client', 30000,
    'jitter_ms', 0,
    'worst_case_wait_ms', 60000,
    'symptom', 'All symbols return NO_TRADE at 0 percent — thundering-herd 429 retry pattern exhausts 70s London session timeout'
  ),
  jsonb_build_object(
    'component', 'openai-client.ts + openai-chat.ts',
    'retry_cap_ms', 5000,
    'retryAfterMs_fallback_proxy', 3000,
    'retryAfterMs_fallback_client', 3000,
    'jitter_ms', '0-2000 random per attempt',
    'worst_case_wait_ms', 14000,
    'rationale', 'OpenAI TPM rate limits reset in 1-5s. Jitter staggers concurrent retries to prevent simultaneous thundering-herd on the 3-symbol batch'
  ),
  'Fix: concurrent batch 429 retry cap 30s to 5s plus jitter resolves NO_TRADE scan failure',
  now()
);
