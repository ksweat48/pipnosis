/*
  # CCIP-2026-03-10: Envelope Ceiling Alignment — MICRO_INTRADAY & INTRADAY

  ## Summary
  1. Extends valid_entity_type constraint to include 'style_execution_envelope'
     so future style envelope changes are tracked with a precise type.
  2. Inserts 5 governance audit records for tpPercent.max ceiling changes in
     src/config/style-execution-envelopes.ts.

  ## Invariant enforced
  tpPercent.max MUST be >= slPercent.max * maxRR for the style.
  The envelope ceiling must never clip the ATR-derived TP corridor from above.

  ## Changes applied
  MICRO_INTRADAY.CRYPTO:  tpPercent.max 5.00% to 6.00%
  INTRADAY.FOREX:         tpPercent.max 2.00% to 2.50%
  INTRADAY.CRYPTO:        tpPercent.max 10.00% to 13.00%
  INTRADAY.METAL:         tpPercent.max 8.00% to 10.00%
  INTRADAY.INDEX:         tpPercent.max 0.80% to 1.30%

  ## Safety
  tpPercent.min, slPercent, noise floor compliance: UNCHANGED
  TP_FLOOR_RATIO_BY_REGIME covers all 3 styles uniformly: no engine changes needed
*/

-- Step 1: Add style_execution_envelope to valid_entity_type
ALTER TABLE governance_change_log DROP CONSTRAINT IF EXISTS valid_entity_type;

ALTER TABLE governance_change_log ADD CONSTRAINT valid_entity_type CHECK (entity_type = ANY (ARRAY[
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
  'llm_pipeline_governance',
  'alpha_type_contract',
  'alpha_freshness_gate',
  'alpha_regime_extractor',
  'thesis_immutability_guard',
  'alpha_style_authority',
  'alpha_execution_policy',
  'style_execution_envelope'
]));

-- Step 2: Insert governance audit records
DO $$
DECLARE
  ccip_sentinel uuid := '10000000-0000-0000-0310-000000000000'::uuid;
BEGIN
  INSERT INTO governance_change_log (
    id,
    entity_type,
    entity_id,
    operation,
    old_value,
    new_value,
    reason,
    metadata
  )
  VALUES
    (
      gen_random_uuid(),
      'style_execution_envelope',
      ccip_sentinel,
      'configuration_change',
      '{"style":"MICRO_INTRADAY","asset_class":"CRYPTO","field":"tpPercent.max","value":5.00}'::jsonb,
      '{"style":"MICRO_INTRADAY","asset_class":"CRYPTO","field":"tpPercent.max","value":6.00}'::jsonb,
      'CCIP-2026-03-10: slPercent.max 2.50% x maxRR 2.0 = 5.00% equalled old ceiling - raised to 6.00%',
      '{"ccip_ref":"CCIP-2026-03-10","fix_type":"ceiling_alignment","invariant":"tpPercent.max >= slPercent.max * maxRR"}'::jsonb
    ),
    (
      gen_random_uuid(),
      'style_execution_envelope',
      ccip_sentinel,
      'configuration_change',
      '{"style":"INTRADAY","asset_class":"FOREX","field":"tpPercent.max","value":2.00}'::jsonb,
      '{"style":"INTRADAY","asset_class":"FOREX","field":"tpPercent.max","value":2.50}'::jsonb,
      'CCIP-2026-03-10: slPercent.max 0.80% x maxRR 3.0 = 2.40% exceeded old ceiling 2.00% - raised to 2.50%',
      '{"ccip_ref":"CCIP-2026-03-10","fix_type":"ceiling_alignment","invariant":"tpPercent.max >= slPercent.max * maxRR"}'::jsonb
    ),
    (
      gen_random_uuid(),
      'style_execution_envelope',
      ccip_sentinel,
      'configuration_change',
      '{"style":"INTRADAY","asset_class":"CRYPTO","field":"tpPercent.max","value":10.00}'::jsonb,
      '{"style":"INTRADAY","asset_class":"CRYPTO","field":"tpPercent.max","value":13.00}'::jsonb,
      'CCIP-2026-03-10: slPercent.max 4.00% x maxRR 3.0 = 12.00% exceeded old ceiling 10.00% - raised to 13.00%',
      '{"ccip_ref":"CCIP-2026-03-10","fix_type":"ceiling_alignment","invariant":"tpPercent.max >= slPercent.max * maxRR"}'::jsonb
    ),
    (
      gen_random_uuid(),
      'style_execution_envelope',
      ccip_sentinel,
      'configuration_change',
      '{"style":"INTRADAY","asset_class":"METAL","field":"tpPercent.max","value":8.00}'::jsonb,
      '{"style":"INTRADAY","asset_class":"METAL","field":"tpPercent.max","value":10.00}'::jsonb,
      'CCIP-2026-03-10: slPercent.max 3.20% x maxRR 3.0 = 9.60% exceeded old ceiling 8.00% - raised to 10.00%',
      '{"ccip_ref":"CCIP-2026-03-10","fix_type":"ceiling_alignment","invariant":"tpPercent.max >= slPercent.max * maxRR"}'::jsonb
    ),
    (
      gen_random_uuid(),
      'style_execution_envelope',
      ccip_sentinel,
      'configuration_change',
      '{"style":"INTRADAY","asset_class":"INDEX","field":"tpPercent.max","value":0.80}'::jsonb,
      '{"style":"INTRADAY","asset_class":"INDEX","field":"tpPercent.max","value":1.30}'::jsonb,
      'CCIP-2026-03-10: slPercent.max 0.40% x maxRR 3.0 = 1.20% exceeded old ceiling 0.80% - raised to 1.30%',
      '{"ccip_ref":"CCIP-2026-03-10","fix_type":"ceiling_alignment","invariant":"tpPercent.max >= slPercent.max * maxRR"}'::jsonb
    );
END $$;
