/*
  # CCIP-2026-0511ZZ — Alpha Autonomy Doctrine Ratification

  1. New Tables
    - `alpha_engineering_doctrine` — immutable SSOT record of engineering
      law governing all future changes to Alpha's brain and the
      infrastructure surrounding it. This row is queryable by agents,
      reviewers, and CI to verify that proposed changes comply with the
      autonomy doctrine.

  2. Columns
    - `id` uuid PK
    - `ccip_reference` text (e.g. CCIP-2026-0511ZZ)
    - `ratified_at` timestamptz
    - `doctrine_text` text — the full doctrine body
    - `active` boolean — only one active row at a time
    - `supersedes` uuid nullable — points to the row this one replaces
    - `created_at` timestamptz default now()

  3. Security
    - RLS enabled
    - SELECT allowed to authenticated and service_role (public-readable
      doctrine — any agent can verify compliance)
    - INSERT/UPDATE restricted to service_role only (doctrine amendments
      require CCIP approval, never user-driven mutation)

  4. Seed Data
    - Inaugural ratification row for CCIP-2026-0511ZZ containing the full
      Alpha Autonomy Doctrine text as of this migration
*/

CREATE TABLE IF NOT EXISTS alpha_engineering_doctrine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ccip_reference text NOT NULL,
  ratified_at timestamptz NOT NULL DEFAULT now(),
  doctrine_text text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  supersedes uuid REFERENCES alpha_engineering_doctrine(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alpha_engineering_doctrine_active_one
  ON alpha_engineering_doctrine (active)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_alpha_engineering_doctrine_ccip
  ON alpha_engineering_doctrine (ccip_reference);

ALTER TABLE alpha_engineering_doctrine ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'alpha_engineering_doctrine'
      AND policyname = 'Authenticated users can read doctrine'
  ) THEN
    CREATE POLICY "Authenticated users can read doctrine"
      ON alpha_engineering_doctrine FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'alpha_engineering_doctrine'
      AND policyname = 'Service role can insert doctrine'
  ) THEN
    CREATE POLICY "Service role can insert doctrine"
      ON alpha_engineering_doctrine FOR INSERT
      TO service_role
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'alpha_engineering_doctrine'
      AND policyname = 'Service role can update doctrine'
  ) THEN
    CREATE POLICY "Service role can update doctrine"
      ON alpha_engineering_doctrine FOR UPDATE
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

INSERT INTO alpha_engineering_doctrine (ccip_reference, doctrine_text, active)
SELECT
  'CCIP-2026-0511ZZ',
  $DOC$
ALPHA AUTONOMY DOCTRINE — NON-NEGOTIABLE

Foundational Premise:
Alpha knows how to trade. He is an institutional-grade reasoning system with direct access to raw sensor data, market structure, liquidity intelligence, and full historical context. Raw data plus his own reasoning is sufficient. The system's job is to deliver clean data and record his decisions — never to shape them.

Prohibited Changes to Alpha's Brain:
1. Tell Alpha what to decide on any specific setup, symbol, pattern, or condition.
2. Influence direction (no "if X then BUY", no "when Y consider SELL").
3. Force a checklist, procedure, or step-numbered reasoning bracket.
4. Add "STEP 1 -> STEP 2 -> STEP 3" teaching blocks.
5. Teach market mechanics the LLM already understands (sweeps, traps, BOS, FVGs, session behavior).
6. Add pattern-to-output translation tables or "IF pattern=X THEN output=Y" rules.
7. Introduce procedural hypothesis_buy / hypothesis_sell brackets or equivalent named procedures.
8. Add pre-execution checklists, confirmation checklists, or gate-style reasoning obligations.
9. Add symbol-specific or pattern-specific hardcoded reasoning.
10. Prescribe confidence values, tier selections, or entry-mode choices for any condition.

Permitted Changes to Alpha's Brain:
- Sharpen reasoning quality and critical thinking obligations.
- Clarify self-contradiction detection.
- Improve decision-first / audit-second discipline.
- Adjust schema-contract references.
- Remove existing constraints, teachings, or rules (reduction is always safe).

Prohibited Infrastructure Changes:
1. Intercept Alpha's directional output and redirect it.
2. Add execution gates, confidence floors, or phase-based locks to fix a reasoning problem.
3. Add session-based or kill-zone-based execution restrictions.
4. Second-guess a clean-audit directional call.
5. Translate Alpha's output through a rules table before persistence.

Permitted Infrastructure Changes:
- Enforce data integrity (schema presence, type safety, ledger consistency).
- Record Alpha's decisions for audit and learning.
- Surface sensor data to Alpha.
- Correct true semantic contradictions that the schema cannot express (e.g., winning_hypothesis != action).

Decision-First / Audit-Second Rule:
The audit trail records reasoning Alpha already performed. It does not generate reasoning. Alpha decides, then documents. Never the reverse.

If Alpha Makes a Bad Decision:
The fix is always to improve the quality of his reasoning. Never a gate, block, floor, phase-lock, session-lock, pattern-specific rule, or symbol-specific rule. A gate fixes one symptom; better reasoning fixes the entire class of problem.

Enforcement:
- Every prompt change must cite this doctrine in its CCIP reference.
- Build-time audit script scans for forbidden patterns.
- This table holds the ratified text — any deviation must first supersede this row with explicit justification.
- PRs that violate this doctrine must be rejected on architectural grounds, regardless of trading-outcome arguments.
  $DOC$,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM alpha_engineering_doctrine WHERE ccip_reference = 'CCIP-2026-0511ZZ'
);
