/*
  # Fix Regime Baseline Accumulation — CCIP-2026-0331C

  ## Problem
  All 9 symbols are stuck at static_fallback thresholds during NY session scans because:

  1. RLS BLOCK: The `regime_indicator_baselines` INSERT and UPDATE policies restrict writes
     to service_role only. The browser client (authenticated user) calls `upsert_regime_baseline`
     fire-and-forget, which silently fails every time. This means the ny session is permanently
     stuck at 1 sample — far below the 20-sample threshold needed for dynamic baselines.

  2. SESSION MAPPING GAP: The coordinator maps `sydney` and `closed` sessions to `undefined`,
     causing the classifier to receive no session → falls through to static_fallback with no
     baseline accumulation at all.

  ## Fix
  - Add authenticated INSERT and UPDATE policies so browser clients can accumulate regime baselines
  - The `upsert_regime_baseline` RPC is SECURITY DEFINER so it bypasses RLS anyway — but the direct
    call path from micro-regime-classifier uses the anon client key, which cannot insert/update
    without explicit policies

  ## Impact
  - Regime baselines will now accumulate on every Alpha scan
  - Within 20+ scans, all symbols will transition from static_fallback to dynamic thresholds
  - This eliminates the root cause of uniform neutral_ranging classification during NY session
*/

-- Allow authenticated users to insert regime baselines
-- (upsert_regime_baseline RPC handles this but direct writes from classifier also need access)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'regime_indicator_baselines'
    AND policyname = 'Authenticated users can insert regime baselines'
  ) THEN
    CREATE POLICY "Authenticated users can insert regime baselines"
      ON regime_indicator_baselines
      FOR INSERT
      TO authenticated
      WITH CHECK (true);
  END IF;
END $$;

-- Allow authenticated users to update regime baselines
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'regime_indicator_baselines'
    AND policyname = 'Authenticated users can update regime baselines'
  ) THEN
    CREATE POLICY "Authenticated users can update regime baselines"
      ON regime_indicator_baselines
      FOR UPDATE
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Also grant execute on the RPCs to authenticated role (defensive — should already exist)
GRANT EXECUTE ON FUNCTION upsert_regime_baseline TO authenticated;
GRANT EXECUTE ON FUNCTION get_regime_baselines TO authenticated;
