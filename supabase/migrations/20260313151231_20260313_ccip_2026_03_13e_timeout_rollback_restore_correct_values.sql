/*
  # CCIP-2026-03-13e: Rollback of CCIP-2026-03-13d — Restore correct timeout values

  ## Summary
  CCIP-2026-03-13d was based on an incorrect assumption about Netlify function timeouts.
  This migration documents the rollback and the correct root cause analysis.

  ## Why CCIP-2026-03-13d Was Wrong

  CCIP-2026-03-13d assumed Netlify's timeout = 60 in netlify.toml applies ONLY to background
  functions. This is FALSE. netlify.toml explicitly has:

    [functions."openai-chat"]
      timeout = 60

  This named function timeout override IS applied to the synchronous openai-chat function,
  giving it a full 60 second budget — not a hypothetical 26-second CDN wall.

  Setting OPENAI_REQUEST_TIMEOUT_MS = 20s caused the AbortController to fire reliably on
  every request because gpt-4o-mini generating coordinator-alpha's 1500-token response takes
  18-25 seconds under normal load. This made ALL 9 symbols return NO_TRADE: coordination
  failed, completely breaking the trading system.

  ## Actual Root Cause of Original 504s (pre-CCIP-2026-03-13d)

  The real root cause has not yet been definitively identified. The CCIP-2026-03-13d diagnosis
  was speculative. The correct approach is to restore working values and instrument better
  logging to identify the actual failure mode from production data.

  ## Changes Applied (CCIP-2026-03-13e rollback)

  ### netlify/functions/openai-chat.ts
  - OPENAI_REQUEST_TIMEOUT_MS: 20000ms → 45000ms (restored to safe value above 1500-token gen time)
  - FUNCTION_TIMEOUT_MS: 24000ms → 55000ms (5s margin below netlify.toml 60s limit)

  ### src/services/openai-client.ts
  - fetchTimeoutMs: 35000ms → 65000ms (12s margin above server worst-case 53s)
  - maxRetries comment corrected to document zero retries reasoning accurately

  ### src/config/concurrent-execution-config.ts
  - maxConcurrentSymbols: 2 → 3 (restored; 2 was based on false 26s CDN wall assumption)
  - Timeout hierarchy comments updated with correct invariants for restored values
  - intraBatchStaggerMs: kept at 1500ms (this is a valid improvement, not part of the bad theory)

  ## New Invariants (verified)
  1. OPENAI_REQUEST_TIMEOUT_MS (45s) + max_pre_work (8s) = 53s < FUNCTION_TIMEOUT_MS (55s)
  2. FUNCTION_TIMEOUT_MS (55s) < netlify.toml openai-chat timeout (60s)
  3. fetchTimeoutMs (65s) >= OPENAI_REQUEST_TIMEOUT_MS + max_pre_work (53s)
  4. symbolTimeoutMs (90s) > pre-work_max (12s) + fetchTimeoutMs (65s) = 77s
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
    'CCIP_ROLLBACK',
    (SELECT id FROM user_profiles WHERE is_admin = true ORDER BY created_at LIMIT 1),
    jsonb_build_object(
      'OPENAI_REQUEST_TIMEOUT_MS', 20000,
      'FUNCTION_TIMEOUT_MS', 24000,
      'fetchTimeoutMs', 35000,
      'maxConcurrentSymbols', 2,
      'intraBatchStaggerMs', 1500,
      'ccip_reference', 'CCIP-2026-03-13d'
    ),
    jsonb_build_object(
      'OPENAI_REQUEST_TIMEOUT_MS', 45000,
      'FUNCTION_TIMEOUT_MS', 55000,
      'fetchTimeoutMs', 65000,
      'maxConcurrentSymbols', 3,
      'intraBatchStaggerMs', 1500,
      'ccip_reference', 'CCIP-2026-03-13e'
    ),
    'ROLLBACK: CCIP-2026-03-13d set OPENAI_REQUEST_TIMEOUT_MS=20s based on false assumption about Netlify 26s CDN wall. gpt-4o-mini 1500-token responses take 18-25s, causing the AbortController to fire on every request and blocking ALL trades. Restored to 45s with correct budget: 45s+8s=53s < 55s FUNCTION_TIMEOUT_MS < 60s netlify.toml limit.',
    'CCIP-2026-03-13e'
  WHERE EXISTS (SELECT 1 FROM user_profiles WHERE is_admin = true);
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;
