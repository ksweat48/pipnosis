/*
  # CCIP-2026-03-12-FETCHFIX: Alpha LLM Timeout Budget Correction

  ## Summary
  Two production errors fixed:
    - "AbortError: signal is aborted without reason" (client-side timer collision)
    - "504 Gateway Timeout — OpenAI request timeout" (max_tokens too high)

  ## Root Causes

  ### Error 1 — AbortError (client-side, src/services/openai-client.ts)
  The browser fetch AbortController (fetchTimeoutMs = 30s) fired BEFORE the Netlify
  function could complete. Server pre-work (Supabase auth + rate-limit RPC + TLS)
  consumes 5-12s before OPENAI_REQUEST_TIMEOUT_MS (25s) starts. Total worst-case
  server wall-clock: 12s + 25s = 37s. The 30s client timer fired at t=30s, cancelling
  the request 7s early and producing an opaque AbortError instead of a clean 504.

  Fix: fetchTimeoutMs raised from 30000ms to 45000ms.
  Formula: OPENAI_REQUEST_TIMEOUT_MS (25s) + max_pre_work (12s) + 8s buffer = 45s.

  ### Error 2 — 504 Gateway Timeout (server-side, src/brains/coordinator-alpha.ts)
  max_tokens was 4000. gpt-4o-mini generating 4000 tokens under load takes 20-30s,
  exceeding OPENAI_REQUEST_TIMEOUT_MS (25s). Alpha JSON schema requires 300-800 tokens
  in practice. 4000 was never necessary and directly caused OpenAI to exceed the timeout.

  Fix: max_tokens reduced from 4000 to 1500.
  At 1500 tokens gpt-4o-mini completes in 5-10s under load. 1500 = ~2x observed worst-case.

  ## Timeout Budget Hierarchy (SSOT — post-fix, all invariants satisfied)
  | Layer                       | Value | Owner                             |
  |-----------------------------|-------|-----------------------------------|
  | Netlify platform hard limit | 60s   | netlify.toml                      |
  | FUNCTION_TIMEOUT_MS         | 58s   | netlify/functions/openai-chat.ts  |
  | OPENAI_REQUEST_TIMEOUT_MS   | 25s   | netlify/functions/openai-chat.ts  |
  | fetchTimeoutMs (client)     | 45s   | src/services/openai-client.ts     |
  | symbolTimeoutMs             | 90s   | concurrent-execution-config.ts    |
  | councilTimeoutMs            | 300s  | concurrent-execution-config.ts    |

  ## Invariants (all satisfied post-fix)
  1. fetchTimeoutMs (45s) >= OPENAI_REQUEST_TIMEOUT_MS (25s) + max_pre_work (12s) = 37s ✓
  2. OPENAI_REQUEST_TIMEOUT_MS (25s) + max_overhead (8s) = 33s < FUNCTION_TIMEOUT_MS (58s) ✓
  3. FUNCTION_TIMEOUT_MS (58s) < Netlify platform hard limit (60s) ✓
  4. symbolTimeoutMs (90s) > fetchTimeoutMs (45s) + pre_work_max (12s) = 57s ✓

  ## No schema changes — governance audit record only
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata
) VALUES
(
  'llm_pipeline_governance',
  gen_random_uuid(),
  'configuration_change',
  jsonb_build_object('fetchTimeoutMs', 30000),
  jsonb_build_object('fetchTimeoutMs', 45000),
  'CCIP-2026-03-12-FETCHFIX-001: fetchTimeoutMs raised 30s→45s. Client timer fired 7s before server wall-clock max (37s). Caused AbortError instead of clean 504.',
  jsonb_build_object(
    'ccip_id', 'CCIP-2026-03-12-FETCHFIX-001',
    'file', 'src/services/openai-client.ts',
    'field', 'fetchTimeoutMs',
    'formula', 'OPENAI_REQUEST_TIMEOUT_MS (25s) + max_pre_work (12s) + safety_buffer (8s) = 45s',
    'risk_level', 'low',
    'errors_fixed', ARRAY['AbortError: signal is aborted without reason']
  )
),
(
  'alpha_coordinator',
  gen_random_uuid(),
  'configuration_change',
  jsonb_build_object('max_tokens', 4000),
  jsonb_build_object('max_tokens', 1500),
  'CCIP-2026-03-12-FETCHFIX-002: max_tokens reduced 4000→1500. gpt-4o-mini at 4000 tokens takes 20-30s, exceeding OPENAI_REQUEST_TIMEOUT_MS (25s). Alpha JSON schema requires 300-800 tokens in practice.',
  jsonb_build_object(
    'ccip_id', 'CCIP-2026-03-12-FETCHFIX-002',
    'file', 'src/brains/coordinator-alpha.ts',
    'field', 'max_tokens',
    'observed_token_range', '300-800 tokens',
    'headroom', '1500 / 800 = 1.875x',
    'safety_net', 'finish_reason === length detection returns NO_TRADE with CRITICAL log if truncation occurs',
    'risk_level', 'low',
    'errors_fixed', ARRAY['POST https://pipnosis.com/.netlify/functions/openai-chat 504 (Gateway Timeout)', 'OpenAI API error: 504 - OpenAI request timeout']
  )
);
