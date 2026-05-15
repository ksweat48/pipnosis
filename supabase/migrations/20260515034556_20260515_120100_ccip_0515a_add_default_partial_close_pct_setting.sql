/*
  # CCIP-2026-0515A — User-Level Default for TP1 Partial Close %

  Adds `default_partial_close_pct` to `user_max_risk_preferences` so users can set
  their preferred TP1 partial-close percentage (0, 0.25, 0.50, 0.75, 1.0) on the
  Settings page. The default is 0.50 (recommended). When a trade is created, the
  user's preference is read into `goal_session_trades.partial_close_pct` (which is
  the SSOT used by the monitoring trigger).

  Allowed values are constrained to {0, 0.25, 0.50, 0.75, 1.0}.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_max_risk_preferences'
      AND column_name = 'default_partial_close_pct'
  ) THEN
    ALTER TABLE user_max_risk_preferences
      ADD COLUMN default_partial_close_pct numeric NOT NULL DEFAULT 0.50;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_max_risk_preferences_partial_close_pct_chk'
  ) THEN
    ALTER TABLE user_max_risk_preferences
      ADD CONSTRAINT user_max_risk_preferences_partial_close_pct_chk
      CHECK (default_partial_close_pct IN (0, 0.25, 0.50, 0.75, 1.0));
  END IF;
END $$;

COMMENT ON COLUMN user_max_risk_preferences.default_partial_close_pct IS
  'CCIP-2026-0515A: Default TP1 partial-close percentage applied to new trades. Allowed: 0, 0.25, 0.50, 0.75, 1.0. Default 0.50.';
