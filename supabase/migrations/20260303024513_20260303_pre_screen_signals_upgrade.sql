/*
  # Pre-Screen Results: 10+ Signal Confluence Upgrade

  ## Summary
  Extends the existing `pre_screen_results` table with multi-signal confluence
  tracking columns. This powers the new readiness display — showing users WHEN
  to scan for a trade, not replacing Alpha's analysis.

  ## Changes to Existing Table: pre_screen_results

  ### New Columns
  - `signals_firing` (jsonb): Array of signal names that are currently active
    e.g. ["BOS", "LIQUIDITY_SWEEP", "PIN_BAR", "EMA_STACK"]
  - `bull_signals` (jsonb): Array of bullish signal names confirmed in this direction
  - `bear_signals` (jsonb): Array of bearish signal names confirmed in this direction
  - `readiness_score` (integer 0-100): Weighted confluence score — higher = better setup readiness
  - `readiness_tier` (text): GREEN (>=65) | YELLOW (>=35) | RED (<35)
  - `signal_count` (integer): Total number of signals firing (for quick sorting)
  - `dominant_signal` (text): The strongest single signal present (e.g. "BOS")
  - `signal_summary` (text): Human-readable summary e.g. "4 signals aligned BUY — strong setup"

  ## No Breaking Changes
  - All existing columns (rule1_met, rule2_met, alignment_status, direction_bias etc.) are preserved
  - New columns have safe defaults (null for jsonb, 0 for scores, 'RED' for tier)
  - Existing UPSERT logic continues to work — new columns just get extra data
  - No constraint changes on existing columns

  ## Security
  - No new RLS changes needed — existing policies on pre_screen_results already cover these columns
  - Service role writes, authenticated users read — unchanged

  ## SSOT Compliance
  - pre_screen_results remains the single authority for structural pre-screen state
  - All new columns are computed server-side by the same 5-min Netlify function
  - No client-side computation of readiness scores

  ## CCIP Governance
  - Additive migration only — no destructive operations
  - IF NOT EXISTS guards on all column additions
  - New index for readiness_score to support ordered display queries
*/

-- Add new signal confluence columns to pre_screen_results
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pre_screen_results' AND column_name = 'signals_firing'
  ) THEN
    ALTER TABLE pre_screen_results ADD COLUMN signals_firing jsonb NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pre_screen_results' AND column_name = 'bull_signals'
  ) THEN
    ALTER TABLE pre_screen_results ADD COLUMN bull_signals jsonb NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pre_screen_results' AND column_name = 'bear_signals'
  ) THEN
    ALTER TABLE pre_screen_results ADD COLUMN bear_signals jsonb NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pre_screen_results' AND column_name = 'readiness_score'
  ) THEN
    ALTER TABLE pre_screen_results ADD COLUMN readiness_score integer NOT NULL DEFAULT 0
      CHECK (readiness_score >= 0 AND readiness_score <= 100);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pre_screen_results' AND column_name = 'readiness_tier'
  ) THEN
    ALTER TABLE pre_screen_results ADD COLUMN readiness_tier text NOT NULL DEFAULT 'RED'
      CHECK (readiness_tier IN ('GREEN', 'YELLOW', 'RED'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pre_screen_results' AND column_name = 'signal_count'
  ) THEN
    ALTER TABLE pre_screen_results ADD COLUMN signal_count integer NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pre_screen_results' AND column_name = 'dominant_signal'
  ) THEN
    ALTER TABLE pre_screen_results ADD COLUMN dominant_signal text NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pre_screen_results' AND column_name = 'signal_summary'
  ) THEN
    ALTER TABLE pre_screen_results ADD COLUMN signal_summary text NOT NULL DEFAULT '';
  END IF;
END $$;

-- Index for efficient readiness-ordered queries (UI needs to sort by score descending)
CREATE INDEX IF NOT EXISTS idx_pre_screen_results_readiness
  ON pre_screen_results (readiness_score DESC, readiness_tier);

-- Index for filtering by tier (GREEN pairs query)
CREATE INDEX IF NOT EXISTS idx_pre_screen_results_tier
  ON pre_screen_results (readiness_tier, style);
