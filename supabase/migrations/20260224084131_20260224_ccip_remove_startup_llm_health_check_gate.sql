/*
  # CCIP: Remove Startup LLM Health Check Gate & Fix 429 Source Disambiguation

  ## Change Summary
  Architectural governance migration documenting three SSOT-compliant changes made
  to eliminate false session-blocking 429 errors caused by OpenAI transient 429
  being misidentified as an internal quota breach.

  ## Root Cause
  OpenAI's own transient 429 was passed through the Netlify proxy as a raw 429,
  then misidentified by openai-client.ts as an internal daily-quota breach.
  The session startup LLM health check then hard-failed and aborted a perfectly
  valid new session. Database confirmed: affected user had daily_count=5 against
  daily_limit=720,000 — nowhere near any internal limit.

  ## Changes Applied

  1. netlify/functions/openai-chat.ts — OpenAI 429 tagged source='openai';
     internal quota 429 tagged source='internal'.

  2. src/services/openai-client.ts — 429 handler reads source field;
     transient OpenAI 429 retried with exponential back-off;
     internal quota 429 surfaces immediately.

  3. src/services/goal-session-live-engine.ts — LLM health check preflight
     removed entirely. First real scan surfaces any errors naturally.

  ## Governance Policy (CCIP, SSOT compliant)
  - track-but-dont-block: openai_rate_limits table and check_rate_limit RPC retained.
  - Internal blocking gate removed from session startup only.
  - 429 classification authority: openai-client.ts (single owner).
*/

ALTER TABLE governance_change_log
DROP CONSTRAINT IF EXISTS valid_entity_type;

ALTER TABLE governance_change_log
ADD CONSTRAINT valid_entity_type CHECK (entity_type = ANY (ARRAY[
  'goal_sessions',
  'goal_session_trades',
  'entry_intents',
  'user_profiles',
  'pending_user_modals',
  'trade_processing_lock',
  'database_migration',
  'system_configuration',
  'club_token_balances',
  'ai_trader_score',
  'timeout_governance_config',
  'alpha_coordinator',
  'realtime_intelligence_calculator',
  'alpha_wall_validation',
  'alpha_prompt_config',
  'llm_pipeline_governance'
]));

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason
)
VALUES (
  'llm_pipeline_governance',
  gen_random_uuid(),
  'configuration_change',
  jsonb_build_object(
    'policy', 'startup_llm_health_check_gate',
    'behavior', 'hard_fail_on_any_429_including_openai_transient',
    'wasted_api_call_per_session', true,
    'files_affected', ARRAY[
      'goal-session-live-engine.ts',
      'openai-client.ts',
      'openai-chat.ts'
    ]
  ),
  jsonb_build_object(
    'policy', 'no_startup_health_check',
    'openai_429', 'retried_with_exponential_backoff',
    'internal_quota_429', 'immediately_surfaced_no_retry',
    'proxy_source_tagging', 'source_field_openai_vs_internal',
    'rate_tracking', 'openai_rate_limits_table_retained',
    'internal_gate_rpc', 'check_rate_limit_retained_not_removed'
  ),
  'Transient OpenAI 429 was aborting valid sessions. Removed preflight health check. Disambiguated 429 sources at proxy. Internal tracking retained per track-but-dont-block policy.'
);
