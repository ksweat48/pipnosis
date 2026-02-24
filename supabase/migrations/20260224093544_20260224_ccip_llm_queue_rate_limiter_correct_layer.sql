/*
  # CCIP Architectural Fix: Move LLM Rate Limiter to Correct Layer

  ## Summary
  Moves OpenAI rate limiting from the orchestrator layer (pipeline start) to the
  client layer (LLM call point) via a global singleton queue in openai-client.ts.

  ## Problem
  The previous fix (intraBatchStaggerMs: 1500) staggered symbol evaluation at the START
  of the pipeline, but symbols converged at the LLM call point after 10-15 seconds of
  deterministic processing. All 3 symbols still hit OpenAI within a 3-second window,
  causing 429 thundering-herd errors.

  ## Fix Applied
  1. Added LLMRequestQueue singleton class to openai-client.ts
     - Enforces 4000ms minimum spacing between ALL consecutive OpenAI API calls
     - Shared across Alpha coordinator, Omega-8, mid-trade evaluator
     - Queue serialises at the actual API call point, not pipeline start

  2. Set intraBatchStaggerMs to 0 in concurrent-execution-config.ts
     - Rate limiting SSOT is now exclusively openai-client.ts

  ## Files Modified
  - src/services/openai-client.ts
  - src/config/concurrent-execution-config.ts
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  new_value,
  reason,
  metadata
)
SELECT
  'llm_pipeline_governance',
  gen_random_uuid(),
  'configuration_update',
  jsonb_build_object(
    'mechanism', 'LLMRequestQueue singleton in openai-client.ts',
    'min_inter_call_ms', 4000,
    'intraBatchStaggerMs', 0
  ),
  'Moved LLM rate limiting from orchestrator stagger (pipeline start) to LLMRequestQueue singleton (LLM call point). Enforces 4000ms minimum inter-call spacing globally.',
  jsonb_build_object(
    'migration', '20260224_ccip_llm_queue_rate_limiter_correct_layer',
    'previous_mechanism', 'intraBatchStaggerMs: 1500 in concurrent-execution-config.ts',
    'new_mechanism', 'LLMRequestQueue singleton with 4000ms min spacing',
    'affects', ARRAY['alpha_coordinator', 'omega8_hybrid', 'mid_trade_evaluator'],
    'ccip_version', 'v2.0'
  )
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_name = 'governance_change_log'
);
