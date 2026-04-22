/*
  # Add Mid-Trade Alert Log to goal_session_trades

  ## Summary
  Adds an append-only `mid_trade_alert_log` jsonb array column to `goal_session_trades`.

  ## Changes

  ### Modified Tables
  - `goal_session_trades`
    - `mid_trade_alert_log` (jsonb[], default '{}') — accumulates every actionable alert
      fired during the trade lifecycle in chronological order. Never cleared on trade
      closure so the full history is available for post-trade journal review.

  ## Purpose
  The existing `last_mid_trade_alert` column holds only the most recent alert, which
  means earlier alerts are overwritten and lost, and the in-memory dedup set cannot be
  fully restored from a single entry after a page refresh. This column fixes both issues:
  - Full alert history is preserved per trade
  - On page load the service rehydrates the fired-trigger dedup set from ALL log entries,
    preventing any previously-fired trigger from re-firing after a browser refresh

  ## Security
  No RLS change required — this column lives on `goal_session_trades` which already has
  RLS policies in place.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'goal_session_trades'
      AND column_name = 'mid_trade_alert_log'
  ) THEN
    ALTER TABLE goal_session_trades
      ADD COLUMN mid_trade_alert_log jsonb[] DEFAULT '{}'::jsonb[];
  END IF;
END $$;
