/*
  # Structural Alerts and Pre-Screen Results Tables

  ## Purpose
  Two new governance-compliant tables to support Alpha Transparency and Rule Enforcement.

  ## New Tables

  ### 1. pre_screen_results
  - Platform-wide background structural pre-screen (no user_id — platform-scoped)
  - 27 rows max (9 symbols × 3 styles), upserted every 5 minutes by Netlify function
  - Tracks BOS and sweep-wick rule results per symbol/style/timeframe combination
  - Columns:
    - id: uuid primary key
    - symbol: trading symbol (EURUSD, GBPUSD, etc.)
    - style: SCALP | MICRO_INTRADAY | INTRADAY
    - controlling_timeframe: M15 | H1 | H4 (the gate timeframe for this style)
    - alignment_status: ALIGNED | RULE1_ONLY | RULE2_ONLY | BOTH_RULES_MET | BLOCKED
    - direction_bias: BUY | SELL | NEUTRAL
    - rule1_met: boolean — BOS check passed
    - rule2_met: boolean — sweep wick check passed
    - rule1_detail: text description of BOS result
    - rule2_detail: text description of sweep wick result
    - last_checked_at: when this row was last written

  ### 2. structural_alerts
  - Session-scoped, append-only log of structural gate decisions
  - Written by coordinator-alpha.ts at each gate decision point during a live session
  - Columns:
    - id: uuid primary key
    - user_id: references auth.users
    - session_id: references goal_sessions
    - symbol: trading symbol
    - style: SCALP | MICRO_INTRADAY | INTRADAY
    - rule_type: enum of gate decision types
    - direction: BUY | SELL
    - details_text: human-readable description of what triggered this alert
    - created_at: timestamp

  ## Security
  - RLS enabled on both tables
  - pre_screen_results: authenticated users can SELECT, service_role can INSERT/UPDATE
  - structural_alerts: users can SELECT their own alerts, service_role can INSERT

  ## Realtime
  - Both tables added to supabase_realtime publication
*/

-- ─────────────────────────────────────────────────────────────────────
-- TABLE: pre_screen_results
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pre_screen_results (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol               text NOT NULL,
  style                text NOT NULL CHECK (style IN ('SCALP', 'MICRO_INTRADAY', 'INTRADAY')),
  controlling_timeframe text NOT NULL CHECK (controlling_timeframe IN ('M15', 'H1', 'H4')),
  alignment_status     text NOT NULL DEFAULT 'BLOCKED'
                         CHECK (alignment_status IN ('ALIGNED', 'RULE1_ONLY', 'RULE2_ONLY', 'BOTH_RULES_MET', 'BLOCKED')),
  direction_bias       text NOT NULL DEFAULT 'NEUTRAL'
                         CHECK (direction_bias IN ('BUY', 'SELL', 'NEUTRAL')),
  rule1_met            boolean NOT NULL DEFAULT false,
  rule2_met            boolean NOT NULL DEFAULT false,
  rule1_detail         text NOT NULL DEFAULT '',
  rule2_detail         text NOT NULL DEFAULT '',
  last_checked_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (symbol, style, controlling_timeframe)
);

ALTER TABLE pre_screen_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read pre screen results"
  ON pre_screen_results
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert pre screen results"
  ON pre_screen_results
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update pre screen results"
  ON pre_screen_results
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_pre_screen_results_symbol_style
  ON pre_screen_results (symbol, style);

CREATE INDEX IF NOT EXISTS idx_pre_screen_results_last_checked
  ON pre_screen_results (last_checked_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- TABLE: structural_alerts
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS structural_alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id  uuid NOT NULL REFERENCES goal_sessions(id) ON DELETE CASCADE,
  symbol      text NOT NULL,
  style       text NOT NULL CHECK (style IN ('SCALP', 'MICRO_INTRADAY', 'INTRADAY')),
  rule_type   text NOT NULL CHECK (rule_type IN (
                 'M15_BOS',
                 'M15_SWEEP_WICK',
                 'M15_CONFLICT_BLOCKED',
                 'H1_BOS',
                 'H1_SWEEP_WICK',
                 'H1_CONFLICT_BLOCKED',
                 'H4_BOS',
                 'H4_SWEEP_WICK',
                 'H4_CONFLICT_BLOCKED',
                 'HTF_DATA_MISSING',
                 'HTF_CONFLICT_QUALIFIED',
                 'HTF_CONFLICT_BLOCKED'
               )),
  direction   text NOT NULL DEFAULT '' CHECK (direction IN ('BUY', 'SELL', '')),
  details_text text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE structural_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own structural alerts"
  ON structural_alerts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert structural alerts"
  ON structural_alerts
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Authenticated users can insert own structural alerts"
  ON structural_alerts
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_structural_alerts_session_id
  ON structural_alerts (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_structural_alerts_user_id
  ON structural_alerts (user_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- REALTIME: Enable for both tables
-- ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'pre_screen_results'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE pre_screen_results;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'structural_alerts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE structural_alerts;
  END IF;
END $$;
