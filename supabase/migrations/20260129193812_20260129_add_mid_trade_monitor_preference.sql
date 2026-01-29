/*
  # Add Missing Mid-Trade Monitor Preference Column

  The user_monitor_preferences table was missing the mid_trade_monitor_enabled column
  that TradingMonitorStack expects. This migration adds the missing column.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_monitor_preferences'
    AND column_name = 'mid_trade_monitor_enabled'
  ) THEN
    ALTER TABLE user_monitor_preferences
    ADD COLUMN mid_trade_monitor_enabled boolean DEFAULT true NOT NULL;
  END IF;
END $$;