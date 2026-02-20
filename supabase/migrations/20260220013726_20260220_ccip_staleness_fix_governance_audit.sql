/*
  # CCIP-STALENESS-FIX-2026-02-20: Staleness Governance Audit Tables

  ## What this migration does
  Records the formal CCIP change tracking entry for the staleness fix deployed
  on 2026-02-20, and adds a lightweight `alpha_thesis_invalidation_log` table
  that tracks every time the thesis local-cache is evicted by the candle
  invalidation chain (candle close -> snapshot clear -> thesis clear).

  ## Why this is needed
  The fix changes THESIS_TTL_MS from 15 minutes to 5 minutes and wires the
  candle realtime subscription to propagate invalidations up through snapshot
  and thesis layers. Governance requires that every material change to the
  cache invalidation chain is:
    1. Tracked in the CCIP change log
    2. Auditable via a dedicated log table so we can measure how often early
       invalidation fires vs TTL-based expiry

  ## New Tables
  - `alpha_thesis_invalidation_log`
    - `id` (uuid, pk)
    - `symbol` (text)
    - `timeframe` (text)
    - `trigger` (text) - 'candle_close' | 'drift_guard' | 'regime_change' | 'ttl' | 'manual'
    - `entries_evicted` (integer)
    - `drift_pips` (numeric, nullable)
    - `metadata` (jsonb)
    - `created_at` (timestamptz)

  ## Security
  - RLS enabled on alpha_thesis_invalidation_log
  - INSERT: authenticated users with matching user_id or null user_id
  - SELECT: authenticated users see own rows
  - service_role has full access

  ## CCIP Change Log
  - Inserts a formal CCIP entry using system user_id (first auth user, not hardcoded)
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Alpha Thesis Invalidation Log
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alpha_thesis_invalidation_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  symbol         text NOT NULL,
  timeframe      text NOT NULL DEFAULT 'unknown',
  trigger        text NOT NULL CHECK (trigger IN ('candle_close', 'drift_guard', 'regime_change', 'ttl', 'manual')),
  entries_evicted integer NOT NULL DEFAULT 0,
  drift_pips     numeric(10,4),
  metadata       jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE alpha_thesis_invalidation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can insert invalidation events"
  ON alpha_thesis_invalidation_log
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can read their own invalidation events"
  ON alpha_thesis_invalidation_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to invalidation log"
  ON alpha_thesis_invalidation_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_thesis_invalidation_symbol_time
  ON alpha_thesis_invalidation_log (symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_thesis_invalidation_trigger
  ON alpha_thesis_invalidation_log (trigger, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CCIP Change Tracking Entry
-- user_id NOT NULL constraint requires a real user — use first auth user as system actor
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_system_user_id uuid;
BEGIN
  SELECT id INTO v_system_user_id FROM auth.users ORDER BY created_at LIMIT 1;

  IF v_system_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ccip_change_tracking'
  ) THEN
    INSERT INTO ccip_change_tracking (
      user_id,
      operation_type,
      table_name,
      record_id,
      change_details,
      governance_log_id
    ) VALUES (
      v_system_user_id,
      'STALENESS_FIX_DEPLOYED',
      'cache-invalidation-chain',
      gen_random_uuid(),
      jsonb_build_object(
        'fix_id', 'CCIP-STALENESS-FIX-2026-02-20',
        'description', 'Reduced THESIS_TTL_MS from 15min to 5min; wired candle realtime subscription to propagate invalidation through snapshot and thesis layers; added price drift guard blocking Alpha when snapshot drifts beyond pip threshold.',
        'rationale', 'Alpha was operating on thesis data up to 15 minutes old. Trades entering immediately against direction are consistent with stale structural bias. Fix aligns thesis TTL with freshness gate CRITICAL threshold (300s).',
        'files_changed', jsonb_build_array(
          'src/config/time-constants.ts',
          'src/types/alpha-thesis.ts',
          'src/services/sentiment-aggregator.ts',
          'src/services/shared-intelligence-coordinator.ts',
          'src/services/candle-cache-manager.ts',
          'src/services/alpha-omega-orchestrator.ts',
          'src/App.tsx'
        ),
        'old_thesis_ttl_ms', 900000,
        'new_thesis_ttl_ms', 300000,
        'old_sentiment_ttl_min', 15,
        'new_sentiment_ttl_min', 5,
        'drift_guard_pips_major', 15,
        'drift_guard_pips_gold', 20,
        'drift_guard_pips_indices', 50,
        'deployed_at', now()
      ),
      gen_random_uuid()
    );
  END IF;
END $$;
