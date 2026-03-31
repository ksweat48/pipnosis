/*
  # CCIP-2026-0331A: Alpha Identity Reasoning Upgrade — Three Targeted Identity Enhancements

  ## Summary
  This migration registers the governance record for three precision additions to Alpha's
  professional reasoning framework. These changes are prompt-only additions to alpha-identity.ts
  and do not alter any database schema, execution logic, or confidence gates.

  ## Changes Deployed
  Three additions to getAlphaSystemPromptForStyle() in src/config/alpha-identity.ts:

  1. TRAPPED PARTICIPANT FUEL QUESTION (Step 4 extension)
     - Mandatory follow-on: who is trapped on the wrong side of this level right now,
       and what does that fuel for the thesis?
     - Forward-looking fuel assessment absent from all existing questions.
     - Identity addition only — no execution gate.

  2. Q4B — REAL-TIME PARTICIPANT READ (Last 3 candles sub-question)
     - Body size trend (growing/consistent/shrinking), wick dominance direction, absorption/
       aggression shift. Independent of Q4 stage label.
     - Catches stage divergence invisible to Q4's 5-candle classification.
     - Audit observation only — does not override Q4 or dictate entry_mode.

  3. NARRATIVE TIMING CHECK — Q_PRICED_IN (Between Step 4 and Step 5)
     - Has the thesis-generating event already delivered its full structural payment?
     - Style-specific horizons: SCALP >30min, MICRO_INTRADAY >2hr, INTRADAY >6hr.
     - Closes timing-stale entry blind spot not covered by Q12/Q4/sweep freshness.
     - Prompt-level advisory only — no hard block added.

  ## New Answer Sheet Fields
  - Q4B_realtime_participant_read
  - Q_PRICED_IN

  ## Governance
  - SSOT: alpha-identity.ts exclusively
  - Zero execution gates added or removed
  - Zero confidence formula changes
  - Alpha sovereignty preserved — all additions are audit observations
*/

-- Create ccip_deployments table if it does not exist
CREATE TABLE IF NOT EXISTS ccip_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ccip_id text UNIQUE NOT NULL,
  title text NOT NULL,
  description text,
  deployment_stage text NOT NULL DEFAULT 'production',
  deployed_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ccip_deployments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ccip_deployments' AND policyname = 'Admin users can read ccip deployments'
  ) THEN
    CREATE POLICY "Admin users can read ccip deployments"
      ON ccip_deployments FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM user_profiles
          WHERE user_profiles.id = auth.uid()
          AND user_profiles.is_admin = true
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ccip_deployments' AND policyname = 'Service role can manage ccip deployments'
  ) THEN
    CREATE POLICY "Service role can manage ccip deployments"
      ON ccip_deployments FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Register this deployment
INSERT INTO ccip_deployments (
  ccip_id,
  title,
  description,
  deployment_stage,
  deployed_at,
  metadata
)
VALUES (
  'CCIP-2026-0331A',
  'Alpha Identity Reasoning Upgrade — Three Targeted Identity Enhancements',
  'Three precision additions to Alpha professional reasoning framework: (1) trapped participant fuel question in step 4, (2) Q4B real-time last-3-candle participant read, (3) narrative timing check Q_PRICED_IN. Prompt-only additions. No execution gates. No confidence formula changes.',
  'production',
  now(),
  jsonb_build_object(
    'files_modified', ARRAY['src/config/alpha-identity.ts'],
    'files_unchanged', ARRAY['src/services/coordinator-alpha.ts', 'src/services/alpha-trade-executor.ts'],
    'new_answer_sheet_fields', ARRAY['Q4B_realtime_participant_read', 'Q_PRICED_IN'],
    'gates_added', 0,
    'gates_removed', 0,
    'confidence_formula_changed', false,
    'ssot_owner', 'src/config/alpha-identity.ts'
  )
)
ON CONFLICT (ccip_id) DO UPDATE SET
  deployed_at = now(),
  deployment_stage = 'production';
