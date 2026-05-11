/*
  # CCIP-2026-0511M — Alpha Audit Incidents Telemetry

  1. Purpose
    Persist every SCHEMA_REPAIR firing, hard-gate fall-through, completion
    truncation, and 504 retry so we can correlate missing-audit-key incidents
    with symbol, session, prompt size, completion size, cache hit %, and
    finish_reason. Replaces ephemeral console logs that vanish on page refresh.

  2. New Tables
    - alpha_audit_incidents
      - id (uuid, primary key)
      - created_at (timestamptz)
      - symbol (text)
      - session_phase (text, nullable)
      - style (text, nullable)
      - incident_type (text) — schema_repair, hard_gate, truncation, 504_retry,
        repair_success, repair_failure
      - missing_keys (text[], nullable)
      - repaired_keys (text[], nullable)
      - prompt_tokens (integer, nullable)
      - completion_tokens (integer, nullable)
      - cached_tokens (integer, nullable)
      - cache_hit_pct (numeric, nullable)
      - finish_reason (text, nullable)
      - model (text, nullable)
      - strict_mode (boolean, nullable)
      - error_message (text, nullable)
      - metadata (jsonb)

  3. Security
    - RLS enabled
    - Service role: full access (inserts from server-side coordinator)
    - Authenticated admin: select-only (for admin dashboard)
    - No public access

  4. Indexes
    - (created_at desc) for recent-incident queries
    - (symbol, created_at desc) for per-symbol drill-down
    - (incident_type, created_at desc) for type filtering
*/

CREATE TABLE IF NOT EXISTS public.alpha_audit_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  symbol text NOT NULL DEFAULT '',
  session_phase text,
  style text,
  incident_type text NOT NULL DEFAULT 'schema_repair',
  missing_keys text[],
  repaired_keys text[],
  prompt_tokens integer,
  completion_tokens integer,
  cached_tokens integer,
  cache_hit_pct numeric,
  finish_reason text,
  model text,
  strict_mode boolean,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS alpha_audit_incidents_created_idx
  ON public.alpha_audit_incidents (created_at DESC);

CREATE INDEX IF NOT EXISTS alpha_audit_incidents_symbol_created_idx
  ON public.alpha_audit_incidents (symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS alpha_audit_incidents_type_created_idx
  ON public.alpha_audit_incidents (incident_type, created_at DESC);

ALTER TABLE public.alpha_audit_incidents ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'alpha_audit_incidents'
      AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access"
      ON public.alpha_audit_incidents
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'alpha_audit_incidents'
      AND policyname = 'Authenticated admins can read'
  ) THEN
    CREATE POLICY "Authenticated admins can read"
      ON public.alpha_audit_incidents
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.user_profiles up
          WHERE up.id = auth.uid() AND up.is_admin = true
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'alpha_audit_incidents'
      AND policyname = 'Authenticated users can insert own incidents'
  ) THEN
    CREATE POLICY "Authenticated users can insert own incidents"
      ON public.alpha_audit_incidents
      FOR INSERT
      TO authenticated
      WITH CHECK (true);
  END IF;
END $$;
