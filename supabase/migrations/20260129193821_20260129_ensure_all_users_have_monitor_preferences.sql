/*
  # Ensure All Users Have Monitor Preferences

  This migration creates default monitor preferences for all existing users
  who don't have preferences yet. This ensures the TradingMonitorStack can
  render properly for all users.
*/

INSERT INTO user_monitor_preferences (user_id)
SELECT id FROM auth.users
WHERE id NOT IN (
  SELECT user_id FROM user_monitor_preferences
)
ON CONFLICT (user_id) DO NOTHING;