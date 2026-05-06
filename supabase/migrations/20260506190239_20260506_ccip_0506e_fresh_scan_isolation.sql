/*
  # CCIP-2026-0506E: Fresh-Scan Isolation

  Enforces that every Alpha scan runs on fresh, uncontaminated data.

  1. New Tables
    - `scan_freshness_audit`
      - Records the freshness state of every scan
      - `symbol` (text) — instrument scanned
      - `scan_started_at` (timestamptz) — when the scan began
      - `candle_ages_by_tf` (jsonb) — age in seconds per timeframe
      - `current_price_age_seconds` (integer) — live-price age at scan
      - `verdict` (text) — FRESH or ABORTED_STALE
      - `reason` (text, nullable) — abort reason if aborted
      - `user_id` (uuid, nullable) — owner of the scan
      - `created_at` (timestamptz) — audit insertion time

  2. Modified Tables
    - `alpha_decisions`
      - Adds `prompt_history_injected` (boolean, default false)
      - Flags any decision whose prompt contained historical trade context
      - Enables retroactive detection of contamination regressions

  3. Security
    - RLS enabled on `scan_freshness_audit`
    - Users may read their own audit rows
    - Service role may insert/read everything
    - Authenticated users may insert their own rows (client writes from orchestrator)

  4. Notes
    - This migration is additive and non-destructive
    - No existing columns are modified; `prompt_history_injected` defaults to false
*/

CREATE TABLE IF NOT EXISTS scan_freshness_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  scan_started_at timestamptz NOT NULL DEFAULT now(),
  candle_ages_by_tf jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_price_age_seconds integer NOT NULL DEFAULT 0,
  verdict text NOT NULL DEFAULT 'FRESH',
  reason text,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scan_freshness_audit_verdict_chk
    CHECK (verdict IN ('FRESH', 'ABORTED_STALE'))
);

CREATE INDEX IF NOT EXISTS idx_scan_freshness_audit_symbol_created
  ON scan_freshness_audit (symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scan_freshness_audit_user_created
  ON scan_freshness_audit (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scan_freshness_audit_verdict
  ON scan_freshness_audit (verdict, created_at DESC);

ALTER TABLE scan_freshness_audit ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'scan_freshness_audit'
      AND policyname = 'Users read own scan audit'
  ) THEN
    CREATE POLICY "Users read own scan audit"
      ON scan_freshness_audit FOR SELECT
      TO authenticated
      USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'scan_freshness_audit'
      AND policyname = 'Users insert own scan audit'
  ) THEN
    CREATE POLICY "Users insert own scan audit"
      ON scan_freshness_audit FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid() OR user_id IS NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'scan_freshness_audit'
      AND policyname = 'Service role full access scan audit'
  ) THEN
    CREATE POLICY "Service role full access scan audit"
      ON scan_freshness_audit FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'alpha_decisions'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'alpha_decisions'
      AND column_name = 'prompt_history_injected'
  ) THEN
    ALTER TABLE alpha_decisions
      ADD COLUMN prompt_history_injected boolean NOT NULL DEFAULT false;
  END IF;
END $$;
