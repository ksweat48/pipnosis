/*
  # CCIP Governance: SCALP TP Pip Ceiling Reduction

  ## Summary
  Reduces the SCALP style maximum TP from 60 pips to 25 pips across all three
  SSOT definition authorities. This is a governance-level style identity change,
  not a preference tweak.

  ## Root Cause
  The 60-pip SCALP FOREX ceiling was inconsistent with SCALP style identity.
  One M5 swing leg over 3-5 candles at typical EURUSD ATR of 3-5 pips/candle
  produces 9-25 pips of realistic movement. A 43-pip TP placed within the
  old 60-pip envelope produced an observed fill time of 480 minutes — far
  outside the SCALP duration contract of 15-60 minutes. The pip ceiling is
  the root cause; reducing it naturally constrains fill time.

  ## Files Changed (Frontend — no DDL required)
  - src/config/style-execution-envelopes.ts
      SCALP_ENVELOPE.tpPips.max: 60 → 25
      SCALP_ENVELOPE.assetClassPercentBounds.FOREX.tpPercent.max: 0.60 → 0.21
  - src/services/style-qualification-gate.ts
      STYLE_CONTRACTS.SCALP.maxTargetPips.FOREX: 60 → 25
  - src/config/style-personalities.ts
      STYLE_PERSONALITIES.SCALP.referenceRanges.typicalTPPips: {low:20,mid:35,high:50} → {low:10,mid:18,high:25}

  ## Governance Decision
  Time-constraint DURATION violation remains ADVISORY (MAJOR severity, non-blocking).
  Duration is a symptom. Enforcing the pip ceiling is the root fix.

  ## SSOT Triad (all three are now in sync at 25 pips):
  1. style-execution-envelopes.ts  — hard wall enforcement (revision required)
  2. style-qualification-gate.ts   — advisory scoring (MAJOR violation logged)
  3. style-personalities.ts        — Alpha prompt context reference ranges

  ## CCIP Reference: CCIP-2026-02-19-SCALP-TP-CAP
*/

-- Record this governance change in ccip_change_tracking
-- Uses first admin user as actor for system-level governance migrations
DO $$
DECLARE
  v_admin_id uuid;
BEGIN
  SELECT id INTO v_admin_id FROM auth.users WHERE is_super_admin = true LIMIT 1;
  IF v_admin_id IS NULL THEN
    SELECT id INTO v_admin_id FROM auth.users ORDER BY created_at LIMIT 1;
  END IF;

  INSERT INTO ccip_change_tracking (
    user_id,
    operation_type,
    table_name,
    record_id,
    change_details
  ) VALUES (
    v_admin_id,
    'STYLE_ENVELOPE_CALIBRATION',
    'style_execution_envelopes',
    gen_random_uuid(),
    jsonb_build_object(
      'ccip_reference', 'CCIP-2026-02-19-SCALP-TP-CAP',
      'description', 'Reduce SCALP FOREX TP ceiling from 60 pips to 25 pips across all three SSOT authorities to enforce M5 swing-leg identity.',
      'affected_files', jsonb_build_array(
        'src/config/style-execution-envelopes.ts',
        'src/services/style-qualification-gate.ts',
        'src/config/style-personalities.ts'
      ),
      'previous_values', jsonb_build_object(
        'style_execution_envelopes__tpPips_max', 60,
        'style_execution_envelopes__FOREX_tpPercent_max', 0.60,
        'style_qualification_gate__SCALP_FOREX_maxTargetPips', 60,
        'style_personalities__SCALP_typicalTPPips', '{"low":20,"mid":35,"high":50}'
      ),
      'new_values', jsonb_build_object(
        'style_execution_envelopes__tpPips_max', 25,
        'style_execution_envelopes__FOREX_tpPercent_max', 0.21,
        'style_qualification_gate__SCALP_FOREX_maxTargetPips', 25,
        'style_personalities__SCALP_typicalTPPips', '{"low":10,"mid":18,"high":25}'
      ),
      'governance_decision', 'Duration advisory kept as ADVISORY. Pip ceiling is root fix. 25 pips = natural ceiling of one M5 swing leg.'
    )
  );
END $$;

-- Record in governance_change_log using validated entity_type and operation values
INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason
) VALUES (
  'system_configuration',
  '00000000-0000-0000-0000-000000000025'::uuid,
  'configuration_change',
  jsonb_build_object('SCALP_FOREX_tpPips_max', 60, 'SCALP_FOREX_tpPercent_max', 0.60),
  jsonb_build_object('SCALP_FOREX_tpPips_max', 25, 'SCALP_FOREX_tpPercent_max', 0.21),
  'CCIP-2026-02-19-SCALP-TP-CAP: M5 swing-leg identity enforcement. 60-pip ceiling allowed INTRADAY-duration trades as SCALP. 25-pip ceiling is the natural ceiling of one strong M5 swing leg and constrains fill time to the 15-60 min SCALP contract window.'
);
