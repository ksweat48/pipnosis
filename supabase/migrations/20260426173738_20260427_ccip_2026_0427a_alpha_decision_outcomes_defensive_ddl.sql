/*
  # CCIP-2026-0427-A: Defensive DDL for alpha_decision_outcomes

  ## Why
  Phase 1 audit revealed the `alpha_decision_outcomes` table is referenced by
  the dashboard view and the heuristic backfill migration, but no explicit
  CREATE TABLE statement exists in the migration history. The table currently
  exists in production (260 rows post-backfill) but the DDL is implicit. This
  migration restores portability so a fresh environment rebuilt from scratch
  will provision the table identically.

  ## What
  1. Idempotent CREATE TABLE IF NOT EXISTS that matches the live production
     schema exactly (verified via information_schema query 2026-04-26).
  2. Idempotent RLS enable + policies (service role write, owner read).
  3. No-op against the live database — the existing table and policies are
     preserved unchanged.

  ## Security
  - RLS enabled.
  - Service role: full access for the trade-closure-coordinator writer.
  - Authenticated users: SELECT only on their own decision outcomes.

  ## Notes
  1. This is a defensive recovery migration. It does not alter live data.
  2. After this migration the entire alpha_decision_outcomes pipeline can be
     reproduced from migrations alone.
*/

CREATE TABLE IF NOT EXISTS public.alpha_decision_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL,
  user_id uuid NOT NULL,
  trade_id uuid,
  executed boolean NOT NULL DEFAULT false,
  outcome text,
  pnl numeric,
  pnl_pct numeric,
  duration_minutes integer,
  exit_reason text,
  alpha_was_right boolean,
  learning_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_alpha_decision_outcomes_decision_id
  ON public.alpha_decision_outcomes(decision_id);

CREATE INDEX IF NOT EXISTS idx_alpha_decision_outcomes_user_id
  ON public.alpha_decision_outcomes(user_id);

CREATE INDEX IF NOT EXISTS idx_alpha_decision_outcomes_trade_id
  ON public.alpha_decision_outcomes(trade_id);

CREATE INDEX IF NOT EXISTS idx_alpha_decision_outcomes_completed_at
  ON public.alpha_decision_outcomes(completed_at DESC);

ALTER TABLE public.alpha_decision_outcomes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'alpha_decision_outcomes'
      AND policyname = 'Users can read own alpha decision outcomes'
  ) THEN
    CREATE POLICY "Users can read own alpha decision outcomes"
      ON public.alpha_decision_outcomes
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'alpha_decision_outcomes'
      AND policyname = 'Service role manages alpha decision outcomes'
  ) THEN
    CREATE POLICY "Service role manages alpha decision outcomes"
      ON public.alpha_decision_outcomes
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
