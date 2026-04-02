/*
  # CCIP-ALPHA-AUDIT-TEXT: Alpha Free-Text Audit Trail Governance

  ## Summary
  This migration enforces the architectural principle that Alpha's audit trail
  must be expressed in his own words, not compressed into enum labels from
  a predefined list. Enum fields remain for machine routing. Free-text companion
  fields are added for Alpha's actual reasoning.

  ## Problem Being Solved
  Alpha was constrained to pick from fixed option lists when recording WHY he
  abandoned an entry, HOW he classified a trigger, or WHAT he observed that
  led to an outcome. These labels are too narrow to capture real market observations.
  The result is an audit trail that reflects the option list's vocabulary, not Alpha's.

  ## Changes

  ### entry_intents table
  - ADD `abandonment_reason_detail` (text, nullable)
    Alpha's free-text explanation of why the intent was abandoned.
    Companion to the existing `abandonment_reason` enum routing tag.

  ## Governance Principle (SSOT)
  - Enum fields = machine routing. Never removed. Never relaxed.
  - Free-text _detail fields = Alpha's voice. Required for complete audit trails.
  - A populated enum with null detail is a governance gap, not a valid audit entry.

  ## Security
  - RLS unchanged. Policies on entry_intents already restrict to owner + service_role.
  - No new tables. No new RLS policies required.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'abandonment_reason_detail'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN abandonment_reason_detail text;
    COMMENT ON COLUMN entry_intents.abandonment_reason_detail IS
      'CCIP-ALPHA-AUDIT-TEXT: Alpha free-text explanation of why this intent was abandoned. '
      'Companion to abandonment_reason (machine routing tag). Required for complete audit trail.';
  END IF;
END $$;
