/*
  # Add last_mid_trade_alert to goal_session_trades

  ## Summary
  Adds a persistent alert column so mid-trade monitor messages (especially trailing SL
  recommendations) survive page navigation/refresh. Previously these messages lived only
  in the in-memory `firedTriggersPerTrade` Map on the service singleton and were lost
  whenever the user navigated away.

  ## New Column
  - `last_mid_trade_alert` (jsonb, nullable)
    Stores the most recent actionable trigger that fired for this trade.
    Shape:
    {
      "trigger_type":    string,        -- e.g. "trail_sl_2r", "profit_1r"
      "primary_message": string,        -- e.g. "+2.1R profit — trail SL to 26850 to lock in +1.0R"
      "sub_message":     string,        -- e.g. "At +2.1R, trail with ATR..."
      "action_price":    number | null, -- the specific price to act on
      "action_label":    string | null, -- e.g. "Move SL to"
      "action":          string,        -- "trail_sl" | "warning" | "tp1_timing" | "risk_alert" | "hold"
      "color":           string,        -- "emerald" | "amber" | "red" | "blue"
      "fired_at":        string         -- ISO timestamp when this trigger first fired
    }

  ## No Data Loss Risk
  Column is nullable with no default — existing rows are unaffected.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades'
    AND column_name = 'last_mid_trade_alert'
    AND table_schema = 'public'
  ) THEN
    ALTER TABLE goal_session_trades
    ADD COLUMN last_mid_trade_alert jsonb DEFAULT NULL;
  END IF;
END $$;
