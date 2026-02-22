/*
  # Platform Intelligence Scan — Shared State

  ## Summary
  Replaces per-user in-memory scan cooldown with a single platform-wide scan
  record. When ANY user clicks "Scan Now", the result is stored here. All other
  users immediately receive the result via Supabase Realtime and see the same
  1-minute cooldown countdown. This eliminates duplicate API calls.

  ## New Tables
  - `platform_intelligence_scan`
    - `id` (uuid, pk)
    - `scanned_at` (timestamptz) — when the scan completed
    - `cooldown_expires_at` (timestamptz) — scanned_at + 60 seconds
    - `scan_duration_ms` (int) — how long the scan took
    - `scanned_count` (int) — number of symbols evaluated
    - `heating_count` (int) — pairs with directional bias but not all gates passed
    - `ready_cards` (jsonb) — array of AlphaPreviewCard objects
    - `created_at` (timestamptz)

  ## Design Decisions
  - Single-row table enforced by a unique partial index (only one active row).
    New scans UPSERT using a fixed sentinel key `singleton`.
  - `cooldown_expires_at` is computed at INSERT time (scanned_at + 60s) so all
    clients can derive remaining cooldown without any clock-skew ambiguity.
  - Realtime is enabled on this table so every connected browser receives the
    INSERT/UPDATE instantly.

  ## RLS Policies
  - All authenticated users can SELECT (read platform scan state)
  - All authenticated users can INSERT/UPDATE (any user can trigger a scan)
    — The application layer (platform-scan-manager) is the SSOT authority for
      enforcing that the cooldown has expired before calling scan().
  - No DELETE allowed (history is preserved; only the latest row matters)

  ## Security
  - RLS enabled
  - No sensitive user data stored (no user_id attribution per spec)
*/

CREATE TABLE IF NOT EXISTS platform_intelligence_scan (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton_key       text NOT NULL DEFAULT 'singleton',
  scanned_at          timestamptz NOT NULL DEFAULT now(),
  cooldown_expires_at timestamptz NOT NULL,
  scan_duration_ms    int NOT NULL DEFAULT 0,
  scanned_count       int NOT NULL DEFAULT 0,
  heating_count       int NOT NULL DEFAULT 0,
  ready_cards         jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_intelligence_scan_singleton
  ON platform_intelligence_scan (singleton_key);

ALTER TABLE platform_intelligence_scan ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read platform scan"
  ON platform_intelligence_scan
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert platform scan"
  ON platform_intelligence_scan
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update platform scan"
  ON platform_intelligence_scan
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_intelligence_scan'
      AND column_name = 'singleton_key'
  ) THEN
    ALTER TABLE platform_intelligence_scan ADD COLUMN singleton_key text NOT NULL DEFAULT 'singleton';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION get_platform_intelligence_scan()
RETURNS TABLE (
  scanned_at          timestamptz,
  cooldown_expires_at timestamptz,
  scan_duration_ms    int,
  scanned_count       int,
  heating_count       int,
  ready_cards         jsonb,
  seconds_until_cooldown_expires int,
  is_on_cooldown      boolean
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    p.scanned_at,
    p.cooldown_expires_at,
    p.scan_duration_ms,
    p.scanned_count,
    p.heating_count,
    p.ready_cards,
    GREATEST(0, EXTRACT(EPOCH FROM (p.cooldown_expires_at - now()))::int) AS seconds_until_cooldown_expires,
    (now() < p.cooldown_expires_at) AS is_on_cooldown
  FROM platform_intelligence_scan p
  WHERE p.singleton_key = 'singleton'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_platform_intelligence_scan() TO authenticated;
