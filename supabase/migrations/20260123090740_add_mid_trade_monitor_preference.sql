/*
  # Add Mid-Trade Monitor Preference

  1. Changes
    - Adds `mid_trade_monitor_enabled` column to `user_monitor_preferences` table
    - Defaults to `true` for all users (enabled by default)
    - Allows users to toggle the Mid-Trade Intelligence monitor on/off

  2. Security
    - No RLS changes needed (existing policies apply)
    - Column is user-controlled preference

  3. Migration Safety
    - Uses IF NOT EXISTS pattern to prevent errors on re-run
    - Sets default value to ensure existing rows work immediately
    - Non-breaking change (additive only)
*/

-- Add mid_trade_monitor_enabled column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_monitor_preferences'
    AND column_name = 'mid_trade_monitor_enabled'
  ) THEN
    ALTER TABLE user_monitor_preferences
    ADD COLUMN mid_trade_monitor_enabled boolean DEFAULT true NOT NULL;

    -- Log successful addition
    RAISE NOTICE 'Added mid_trade_monitor_enabled column to user_monitor_preferences';
  ELSE
    RAISE NOTICE 'Column mid_trade_monitor_enabled already exists, skipping';
  END IF;
END $$;

-- Set to true for any existing users who don't have this preference yet
UPDATE user_monitor_preferences
SET mid_trade_monitor_enabled = true
WHERE mid_trade_monitor_enabled IS NULL;

-- Create comment for documentation
COMMENT ON COLUMN user_monitor_preferences.mid_trade_monitor_enabled IS
'Controls visibility of the Mid-Trade Intelligence monitor. When enabled, shows real-time guidance for active Alpha-executed trades including trail stop suggestions, risk alerts, and optimal exit timing.';