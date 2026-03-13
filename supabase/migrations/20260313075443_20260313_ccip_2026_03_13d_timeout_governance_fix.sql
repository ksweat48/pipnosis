/*
  # CCIP-2026-03-13d: Netlify Synchronous Function 504 Timeout Governance Fix

  ## Summary
  Permanent governance audit record for the root-cause fix of persistent 504 Gateway Timeout
  errors on POST /.netlify/functions/openai-chat during multi-symbol Alpha LLM evaluation.

  ## Root Cause
  Netlify's `timeout = 60` in netlify.toml applies ONLY to background functions (POST to
  /.netlify/functions/function-name-background). Regular synchronous functions are hard-capped
  at 26 seconds by Netlify's CDN edge layer — regardless of netlify.toml configuration.

  Previous OPENAI_REQUEST_TIMEOUT_MS = 35s plus 8s pre-work overhead = 43s total, which is
  17 seconds past the CDN's 26s kill threshold. The CDN silently drops the TCP connection,
  producing an unrecoverable infrastructure 504 (empty body) — not the clean JSON 504 from
  the function's own AbortError handler.

  ## Changes Applied (all SSOT-compliant, CCIP-governed)

  ### netlify/functions/openai-chat.ts
  - OPENAI_REQUEST_TIMEOUT_MS: 35000ms → 20000ms
  - FUNCTION_TIMEOUT_MS: 58000ms → 24000ms
  - New budget: 20s OpenAI + 4s pre-work = 24s, under the 26s CDN kill wall

  ### src/services/openai-client.ts
  - fetchTimeoutMs: 50000ms → 35000ms (>= 24s FUNCTION_TIMEOUT_MS + 11s safety buffer)
  - max_tokens default: 2000 → 500 (Alpha JSON output is <300 tokens; reduces OpenAI gen time)
  - maxRetries comment corrected: was stale "returns 1", now correctly documents "returns 0"

  ### src/config/concurrent-execution-config.ts
  - maxConcurrentSymbols: 3 → 2 (reduce simultaneous Netlify cold-start pressure)
  - intraBatchStaggerMs: 0ms → 1500ms (spread wall-clock arrival of function invocations)
  - Added SSOT getter: getIntraBatchStaggerMs()
  - All timeout hierarchy comments updated to reflect new invariants

  ### src/services/alpha-omega-orchestrator.ts
  - evaluateConcurrently: staggerDelayMs hardcoded 0 → reads getIntraBatchStaggerMs() SSOT
  - Import: added getIntraBatchStaggerMs to import block

  ## New Timeout Invariants (must never be violated)
  1. OPENAI_REQUEST_TIMEOUT_MS (20s) + max_pre_work (4s) <= Netlify CDN wall (26s)
  2. FUNCTION_TIMEOUT_MS (24s) = OPENAI_REQUEST_TIMEOUT_MS + max_pre_work
  3. fetchTimeoutMs (35s) >= FUNCTION_TIMEOUT_MS (24s)
  4. symbolTimeoutMs (90s) > pre-work_max (12s) + fetchTimeoutMs (35s) = 47s
*/

DO $$
BEGIN
  INSERT INTO governance_change_log (
    entity_type,
    entity_id,
    change_type,
    changed_by,
    old_value,
    new_value,
    reason,
    ccip_reference
  )
  SELECT
    'system_config',
    'openai_timeout_governance',
    'CCIP_TIMEOUT_FIX',
    (SELECT id FROM user_profiles WHERE is_admin = true ORDER BY created_at LIMIT 1),
    jsonb_build_object(
      'OPENAI_REQUEST_TIMEOUT_MS', 35000,
      'FUNCTION_TIMEOUT_MS', 58000,
      'fetchTimeoutMs', 50000,
      'max_tokens_default', 2000,
      'maxConcurrentSymbols', 3,
      'intraBatchStaggerMs', 0
    ),
    jsonb_build_object(
      'OPENAI_REQUEST_TIMEOUT_MS', 20000,
      'FUNCTION_TIMEOUT_MS', 24000,
      'fetchTimeoutMs', 35000,
      'max_tokens_default', 500,
      'maxConcurrentSymbols', 2,
      'intraBatchStaggerMs', 1500
    ),
    'ROOT CAUSE FIX: Netlify CDN hard-kills synchronous functions at 26s regardless of netlify.toml timeout=60 (which only applies to background functions). Previous OPENAI_REQUEST_TIMEOUT_MS=35s + 8s pre-work = 43s exceeded the 26s CDN kill wall, producing unrecoverable TCP-drop 504s. New budget: 20s+4s=24s, 2s under the 26s wall.',
    'CCIP-2026-03-13d'
  WHERE EXISTS (SELECT 1 FROM user_profiles WHERE is_admin = true);
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;
