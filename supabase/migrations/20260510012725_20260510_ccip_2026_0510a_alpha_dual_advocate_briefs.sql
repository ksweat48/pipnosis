/*
  # CCIP-2026-0510A — Alpha Dual-Advocate Audition Briefs

  ## Summary
  Adds a JSONB column to `alpha_decisions` to persist the parallel direction-locked
  advocate briefs produced by the new mechanical dual-audition architecture.

  Before every arbiter call, two independent LLM advocates run in parallel:
  a BUY-advocate (locked to BUY only) and a SELL-advocate (locked to SELL only).
  Each advocate produces the strongest honest structural case for its locked
  direction, or formally concedes. Both briefs are injected into the arbiter
  prompt and — with this migration — persisted for full audit and learning.

  ## Changes
  1. Adds `alpha_decisions.advocate_briefs` (JSONB, nullable).
     Shape:
       {
         buy:  AdvocateBrief | null,
         sell: AdvocateBrief | null,
         generated_at: timestamptz (ISO)
       }

  ## Security
  No RLS changes. `alpha_decisions` already has RLS policies governing access.
  The new column inherits those policies.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'advocate_briefs'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN advocate_briefs JSONB;
    COMMENT ON COLUMN alpha_decisions.advocate_briefs IS
      'CCIP-2026-0510A: Parallel direction-locked advocate briefs (BUY + SELL) produced before the arbiter call. Breaks anchoring mechanically by separating the two auditions into independent reasoners.';
  END IF;
END $$;
