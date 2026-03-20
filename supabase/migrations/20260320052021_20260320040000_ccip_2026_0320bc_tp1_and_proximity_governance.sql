/*
  # CCIP-2026-0320B/C Governance Enforcement Tracking

  ## Summary
  Creates a dedicated audit log for two new execution-time governance rules introduced
  in session CCIP-2026-0320:

  ### CCIP-2026-0320B — TP1 Midpoint Fallback
  When Alpha's LLM response omits a TP1 price on a non-scalp trade, the executor now
  computes a midpoint TP1 at 50% of the distance between entry and TP2.
  This ensures `hasDualTP` is always satisfied and TP1 monitoring always activates.

  ### CCIP-2026-0320C — PROXIMITY_RISK SL Widening
  When Alpha's answer-sheet field `Q9_sl_wick_proximity` contains "PROXIMITY_RISK" and
  reports a wick gap of <= 10 pips from the SL, the executor widens the SL by that
  exact gap distance to move it clear of the wick.

  ## New Table

  ### `execution_governance_events`
  One row per governed execution event.  Does NOT block trade insertion — pure audit trail.

  Columns:
  - `id`              — UUID primary key
  - `trade_id`        — FK → goal_session_trades (nullable: set when trade is inserted)
  - `user_id`         — FK → user_profiles
  - `event_type`      — 'tp1_midpoint_fallback' | 'proximity_risk_sl_widening'
  - `symbol`          — Trading symbol (XAUUSD, EURUSD …)
  - `trade_style`     — Alpha's canonical trade style (MICRO_INTRADAY, INTRADAY …)
  - `direction`       — 'buy' | 'sell'
  - `entry_price`     — Planned entry price
  - `original_value`  — The value before governance intervention (TP1 = null; SL = original SL)
  - `governed_value`  — The value after governance intervention (computed TP1 or widened SL)
  - `governance_rule` — 'CCIP-2026-0320B' | 'CCIP-2026-0320C'
  - `metadata`        — JSONB for auxiliary details (tp2, proximity gap, q9 text …)
  - `created_at`      — Timestamp

  ## Security
  - RLS enabled
  - Authenticated users can INSERT their own rows
  - Authenticated users can SELECT their own rows
  - Service role has unrestricted access
  - Admins (is_admin flag on user_profiles) can SELECT all rows via dedicated policy
*/

CREATE TABLE IF NOT EXISTS execution_governance_events (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id          uuid          REFERENCES goal_session_trades(id) ON DELETE SET NULL,
  user_id           uuid          NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  event_type        text          NOT NULL,
  symbol            text          NOT NULL DEFAULT '',
  trade_style       text          NOT NULL DEFAULT '',
  direction         text          NOT NULL CHECK (direction IN ('buy', 'sell')),
  entry_price       numeric(18,5) NOT NULL DEFAULT 0,
  original_value    numeric(18,5),
  governed_value    numeric(18,5) NOT NULL DEFAULT 0,
  governance_rule   text          NOT NULL,
  metadata          jsonb         NOT NULL DEFAULT '{}',
  created_at        timestamptz   NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'execution_governance_events'
      AND constraint_name = 'execution_governance_events_event_type_check'
  ) THEN
    ALTER TABLE execution_governance_events
      ADD CONSTRAINT execution_governance_events_event_type_check
      CHECK (event_type IN ('tp1_midpoint_fallback', 'proximity_risk_sl_widening'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'execution_governance_events'
      AND constraint_name = 'execution_governance_events_governance_rule_check'
  ) THEN
    ALTER TABLE execution_governance_events
      ADD CONSTRAINT execution_governance_events_governance_rule_check
      CHECK (governance_rule IN ('CCIP-2026-0320B', 'CCIP-2026-0320C'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_execution_governance_events_user_id
  ON execution_governance_events(user_id);

CREATE INDEX IF NOT EXISTS idx_execution_governance_events_trade_id
  ON execution_governance_events(trade_id);

CREATE INDEX IF NOT EXISTS idx_execution_governance_events_event_type
  ON execution_governance_events(event_type);

CREATE INDEX IF NOT EXISTS idx_execution_governance_events_created_at
  ON execution_governance_events(created_at DESC);

ALTER TABLE execution_governance_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own execution governance events"
  ON execution_governance_events
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own execution governance events"
  ON execution_governance_events
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all execution governance events"
  ON execution_governance_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

CREATE POLICY "Service role full access to execution governance events"
  ON execution_governance_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
