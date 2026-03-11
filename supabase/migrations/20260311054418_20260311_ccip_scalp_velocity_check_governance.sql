/*
  # CCIP Governance: Scalp Velocity Check Prompt Enforcement

  ## Title
  CCIP-2026-0311A — Scalp Behavioral Identity: ATR Velocity Check Enforcement

  ## Summary
  Records the governance decision to strengthen Alpha's scalp prompt identity with
  mandatory ATR velocity arithmetic. Audits the root cause of the 762-minute EURUSD
  SCALP trade (entry_intent: 4157ede8-6e48-4ad7-8fa1-884cc7b87163).

  ## Root Cause
  CCIP-2026-03-11 removed the code-side SCALP_TIME_CONTRACT gate. Alpha executed
  EURUSD LONG SCALP with ATR=0.8 pips, TP 15.5 pips away: 15.5 / 0.8 = ~19 candles
  x 5 = ~95 min (>ABSOLUTE_MAX_MIN of 90). No TIME_ESTIMATE in alpha_reasoning.

  ## Fix Applied (prompt-only, no hard gates)
  - STEP 1 VELOCITY CHECK: mandatory arithmetic before structural analysis
  - Three-tier verdict: SUFFICIENT / BORDERLINE / INSUFFICIENT
  - INSUFFICIENT = NO_TRADE + STYLE_TIME_VIOLATION, analysis stops immediately
  - estimated_duration_minutes output spec requires arithmetic format
  - Checklist item 2 enforces velocity check presence
  - SSOT: alpha-identity.ts only. No code changes.
*/

DO $$
DECLARE
  v_admin_id uuid := '30177afc-5b98-41ab-832a-a3e5a875e6c0';
BEGIN
  INSERT INTO ccip_change_requests (
    change_title,
    change_type,
    priority,
    requested_by,
    description,
    business_justification,
    technical_impact,
    risk_assessment,
    ccip_status,
    governance_status,
    approved_by,
    approved_at,
    deployed_at,
    deployment_method,
    modified_files,
    database_changes,
    breaking_changes,
    related_migration
  )
  VALUES (
    'CCIP-2026-0311A: Scalp Velocity Check - ATR Arithmetic Enforcement in Prompt',
    'config',
    'high',
    v_admin_id,
    'Scalp behavioral identity strengthened with mandatory Step 1 ATR velocity check. Alpha must compute TP_pips / M5_ATR_pips = candles x 5 = minutes before any structural analysis. Three-tier verdict: SUFFICIENT / BORDERLINE / INSUFFICIENT. INSUFFICIENT stops analysis and outputs NO_TRADE + STYLE_TIME_VIOLATION immediately. Fixes root cause of 762-minute EURUSD SCALP trade where Alpha skipped TIME_ESTIMATE declaration.',
    'Alpha executed a SCALP trade on EURUSD with estimated fill time of 762 minutes (8.5x the ABSOLUTE_MAX_MIN of 90 min). ATR was 0.8 pips, TP was 15.5 pips. Market was drifting sideways. No hard gates introduced - Alpha must understand velocity as a professional, not be mechanically blocked.',
    'Change is prompt-only. No code changes. alpha-identity.ts getAlphaSystemPromptForStyle() SCALP branch updated. No breaking changes to API, database schema, or service interfaces.',
    'Low risk. Prompt strengthening only. A fast market with high ATR still executes freely. Only trades where the market is too slow for a scalp will produce STYLE_TIME_VIOLATION.',
    'deployed',
    'approved',
    v_admin_id,
    now(),
    now(),
    'migration_and_prompt_edit',
    ARRAY['src/config/alpha-identity.ts'],
    false,
    false,
    '20260311_ccip_scalp_velocity_check_governance'
  );
END $$;
