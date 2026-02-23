/*
  # CCIP Governance Record — Alpha Reasoning Upgrade Phase 2: Scalp + All Styles

  ## Change Summary
  Records a CCIP-compliant governance change to alpha-identity.ts (the SSOT for Alpha's
  analytical framework). All four reasoning improvements now apply across all three trading
  styles: SCALP, MICRO_INTRADAY, INTRADAY.

  ## What Changed

  ### 1. Scalp SUB-MODE B — Pullback Health Reasoning (NEW)
  Structured interrogation of pullback quality before any SUB-MODE B entry:
  - Retracement depth (30-65% healthy, >65% reassess)
  - Candle deceleration check (shrinking bodies = retrace exhausting)
  - Pause-at-level requirement (price must stall, not barrel through)

  ### 2. All Styles — Move Stage Diagnosis (NEW)
  Runs before sub-mode or entry approach selection. Three stages:
  - EARLY: < 0.75x ATR — both continuation and pullback entries valid
  - MIDDLE: 0.75-1.2x ATR — pullback entry preferred
  - LATE: > 1.2x ATR — WAIT_ENTRY, entering = becoming exit liquidity

  ### 3. All Styles — Q5 Devil's Advocate Step 4 (NEW)
  TIMING VS DIRECTION DIAGNOSIS: Alpha must answer whether a stop-out would be due to wrong
  direction (NO_TRADE / downgrade) or wrong timing (WAIT_ENTRY with better entry description).

  ### 4. All Styles — Q8 Move Narrative Calculation (NEW)
  Percentage of total projected move already traveled at entry:
  - 0-40%: Early, full confidence
  - 40-65%: Middle, verify remaining range
  - 65-80%: Late, explicit justification required
  - 80%+: Exit liquidity, NO_TRADE or WAIT_ENTRY

  ## Governance Classification
  - SSOT: alpha-identity.ts (single authority, no parallel definitions created)
  - Type: Reasoning enhancement — no thresholds, hard blocks, or schema changed
  - Uses operation 'configuration_change' (existing valid operation type)
  - CCIP compliance: Tracked via governance_change_log
*/

-- Extend entity_type constraint to include alpha_prompt_config
ALTER TABLE governance_change_log DROP CONSTRAINT IF EXISTS valid_entity_type;

ALTER TABLE governance_change_log ADD CONSTRAINT valid_entity_type CHECK (
  entity_type = ANY (ARRAY[
    'goal_sessions'::text,
    'goal_session_trades'::text,
    'entry_intents'::text,
    'user_profiles'::text,
    'pending_user_modals'::text,
    'trade_processing_lock'::text,
    'database_migration'::text,
    'system_configuration'::text,
    'club_token_balances'::text,
    'ai_trader_score'::text,
    'timeout_governance_config'::text,
    'alpha_coordinator'::text,
    'realtime_intelligence_calculator'::text,
    'alpha_wall_validation'::text,
    'alpha_prompt_config'::text
  ])
);

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata
)
VALUES (
  'alpha_prompt_config',
  gen_random_uuid(),
  'configuration_change',
  '{"version": "phase1", "styles_covered": ["MICRO_INTRADAY", "INTRADAY"], "scalp_pullback_health": false, "move_stage_diagnosis": false, "q5_timing_direction": false, "q8_move_narrative": false}',
  '{"version": "phase2", "styles_covered": ["SCALP", "MICRO_INTRADAY", "INTRADAY"], "scalp_pullback_health": true, "move_stage_diagnosis": true, "q5_timing_direction": true, "q8_move_narrative": true}',
  'Phase 2 Alpha Reasoning Upgrade: Move Stage Diagnosis, Pullback Health Reasoning (all styles), Q5 Timing-vs-Direction Failure Mode, Q8 Move Narrative Calculation applied to SCALP + existing styles. SSOT-compliant — single source in src/config/alpha-identity.ts. No thresholds, hard blocks, or schema modified.',
  '{"migration": "20260223_ccip_alpha_reasoning_scalp_upgrade_phase2", "ccip_ref": "20260223-alpha-reasoning-phase2", "breaking_change": false, "governance_tier": "TIER_2_PROMPT", "affected_file": "src/config/alpha-identity.ts"}'::jsonb
);
