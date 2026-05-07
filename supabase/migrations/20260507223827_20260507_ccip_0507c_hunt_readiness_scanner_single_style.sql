/*
  # CCIP-2026-0507C: Hunt Readiness Scanner — Single-Style Alignment + Per-Row Isolation

  1. Purpose
    - Fix the 24h+ silent outage of the Hunt Readiness monitor. The scanner
      has been writing 0 rows because every batch upsert violated the CHECK
      constraint ccip_0503d_alpha_hunt_readiness_style_single_style (added
      in CCIP-2026-0427) which only allows style = 'MICRO_INTRADAY'. The
      scanner still iterated SCALP + MICRO_INTRADAY + INTRADAY and upserted
      all 27 rows in one statement.

  2. What changed — netlify/functions/alpha-hunt-readiness-scanner.ts
    - styles array narrowed to ['MICRO_INTRADAY'] (matches DB SSOT).
    - Upsert switched from one batch-of-27 to per-row loop.
    - Added heartbeat: writtenCount===0 logs HEARTBEAT FAILURE and returns 500.
    - Response body now includes written + failures counts for observability.

  3. No schema changes. Writer-side alignment to an existing CHECK constraint.
*/

DO $$
DECLARE
  v_owner_id uuid;
  v_governance_id uuid;
  v_row_count bigint;
  v_last_write timestamptz;
BEGIN
  SELECT id INTO v_owner_id FROM auth.users ORDER BY created_at ASC LIMIT 1;

  SELECT COUNT(*), MAX(last_scanned_at)
    INTO v_row_count, v_last_write
  FROM alpha_hunt_readiness;

  INSERT INTO governance_change_log (
    entity_type,
    entity_id,
    operation,
    old_value,
    new_value,
    reason,
    requester_id,
    metadata
  )
  VALUES (
    'system_configuration',
    gen_random_uuid(),
    'ccip_migration_applied',
    jsonb_build_object(
      'component', 'alpha_hunt_readiness_scanner',
      'scanner_styles', jsonb_build_array('SCALP', 'MICRO_INTRADAY', 'INTRADAY'),
      'upsert_strategy', 'batch_all_27_rows_single_call',
      'on_zero_rows_written', 'silent_success',
      'observed_outage_hours_plus', 24,
      'observed_row_count', v_row_count,
      'observed_last_write', v_last_write,
      'root_cause', 'CHECK constraint ccip_0503d_alpha_hunt_readiness_style_single_style rejected every batch because scanner iterated 3 styles, only MICRO_INTRADAY is legal.'
    ),
    jsonb_build_object(
      'component', 'alpha_hunt_readiness_scanner',
      'scanner_styles', jsonb_build_array('MICRO_INTRADAY'),
      'upsert_strategy', 'per_row_isolation_loop',
      'on_zero_rows_written', 'log_heartbeat_failure_return_500',
      'response_body_fields_added', jsonb_build_array('written', 'failures'),
      'aligns_to', 'alpha_hunt_readiness CHECK constraint ccip_0503d (single-style mandate)',
      'completes_consolidation', 'CCIP-2026-0427 (style consolidation) in Netlify scheduler layer'
    ),
    'CCIP-2026-0507C: Realign Hunt Readiness scanner with the single-style DB mandate and harden against silent 0-row outages via per-row upsert isolation and a zero-row heartbeat. Fixes 24h+ outage where the monitor surfaced no pairs because every batch upsert violated the MICRO_INTRADAY-only CHECK constraint.',
    v_owner_id,
    jsonb_build_object(
      'ccip_tag', 'CCIP-2026-0507C',
      'files_changed', jsonb_build_array('netlify/functions/alpha-hunt-readiness-scanner.ts'),
      'no_schema_changes', true,
      'no_alpha_prompt_changes', true,
      'parallel_to', jsonb_build_array('CCIP-2026-0427'),
      'verification_plan', jsonb_build_array(
        'Trigger Netlify deploy',
        'Wait one 3-minute cron tick',
        'Query SELECT COUNT(*), MAX(last_scanned_at) FROM alpha_hunt_readiness — expect 9 rows, timestamp within last 3 minutes',
        'Confirm SessionIntelligenceMonitor surfaces pairs in the UI'
      )
    )
  )
  RETURNING id INTO v_governance_id;

  INSERT INTO ccip_change_tracking (
    user_id,
    operation_type,
    table_name,
    record_id,
    change_details,
    governance_log_id
  )
  VALUES (
    v_owner_id,
    'ccip_migration_applied',
    'alpha_hunt_readiness',
    v_governance_id,
    jsonb_build_object(
      'ccip_tag', 'CCIP-2026-0507C',
      'component', 'alpha_hunt_readiness_scanner',
      'description', 'Hunt Readiness scanner single-style alignment + per-row isolation + heartbeat',
      'file', 'netlify/functions/alpha-hunt-readiness-scanner.ts',
      'fix_type', 'writer_side_alignment_to_existing_check_constraint',
      'outage_before_fix_rows', v_row_count,
      'outage_before_fix_last_write', v_last_write
    ),
    v_governance_id
  );
END $$;