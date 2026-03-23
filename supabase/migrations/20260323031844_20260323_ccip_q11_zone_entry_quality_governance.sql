/*
  # CCIP-2026-0323B: Q11 Zone Entry Quality Governance

  ## Summary
  Records the Q11 zone-entry-quality governance change in the CCIP audit trail.
  Q11 is a new answer_sheet field for MICRO_INTRADAY and INTRADAY styles that
  captures Alpha's zone-precision self-assessment: PRECISE / MID_ZONE / DEEP_ZONE.

  ## What this migration does

  ### 1. CCIP Governance Audit Record
  Inserts a record into ccip_governance_audit documenting the Q11 change.

  ### 2. No structural table changes
  Q11 is stored in the answer_sheet JSON blob on alpha_decisions — no new columns.
  The ssot_violations table accepts free-text violation_type — no enum update needed.

  ## Architecture
  - SSOT authority: src/config/alpha-identity.ts
  - Enforcement backstop: src/brains/coordinator-alpha.ts parseDecision()
  - Violation type: Q11_DEEP_ZONE_EXECUTE_NOW (medium severity)
  - Enforcement: entry_mode redirect only — trade is never hard-blocked

  ## Q11 Values
  - PRECISE: entering at the near edge of the structural zone (best RR preservation)
  - MID_ZONE: entering mid-zone — valid but SL/RR must reflect consumed structural buffer
  - DEEP_ZONE: entering at the far edge, near invalidation — execute_now PROHIBITED
*/

INSERT INTO ccip_governance_audit (
  change_id,
  change_date,
  category,
  title,
  description,
  files_modified,
  ssot_owner
)
VALUES (
  'CCIP-2026-0323B',
  now()::date,
  'alpha_prompt_governance',
  'Q11 Zone Entry Quality — MICRO_INTRADAY and INTRADAY',
  'Added Q11_zone_entry_quality answer_sheet field for MICRO_INTRADAY and INTRADAY styles. Q11 captures zone-precision self-assessment (PRECISE/MID_ZONE/DEEP_ZONE). Code-layer backstop in coordinator-alpha.ts corrects DEEP_ZONE + execute_now to wait_pullback and logs Q11_DEEP_ZONE_EXECUTE_NOW violation. Mirrors Q10 governance pattern established in CCIP-2026-0323A.',
  ARRAY['src/config/alpha-identity.ts', 'src/brains/coordinator-alpha.ts'],
  'alpha-identity.ts'
)
ON CONFLICT (change_id) DO UPDATE
  SET change_date = EXCLUDED.change_date,
      category = EXCLUDED.category,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      files_modified = EXCLUDED.files_modified,
      ssot_owner = EXCLUDED.ssot_owner;
