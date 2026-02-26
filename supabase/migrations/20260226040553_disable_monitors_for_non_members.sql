/*
  # Disable Monitor Preferences for Non-Members

  ## Summary
  Enforces membership-tier access control at the database level by disabling
  monitor preferences for users who do not hold the required membership tier.

  ## Rules
  - Entry Advisory (entry_price_monitor_enabled): requires tier_level >= 1 (Member $99)
  - Mid-Trade Intelligence (mid_trade_monitor_enabled): requires tier_level >= 2 (Starter $250)
  - Real-Time Intelligence (session_intelligence_enabled): requires tier_level >= 3 (Builder $500)

  ## Changes
  - Sets all three monitor flags to false for users with no active membership
  - Sets mid_trade and session_intelligence to false for users only at tier 1
  - Sets session_intelligence to false for users only at tier 2
  - Users with no row in user_monitor_preferences are unaffected (they get false defaults in the app)
*/

UPDATE user_monitor_preferences ump
SET
  entry_price_monitor_enabled = CASE
    WHEN COALESCE(cm.tier_level, 0) >= 1 THEN ump.entry_price_monitor_enabled
    ELSE false
  END,
  mid_trade_monitor_enabled = CASE
    WHEN COALESCE(cm.tier_level, 0) >= 2 THEN ump.mid_trade_monitor_enabled
    ELSE false
  END,
  session_intelligence_enabled = CASE
    WHEN COALESCE(cm.tier_level, 0) >= 3 THEN ump.session_intelligence_enabled
    ELSE false
  END,
  updated_at = now()
FROM (
  SELECT
    user_id,
    MAX(tier_level) AS tier_level
  FROM club_memberships
  WHERE status = 'active'
  GROUP BY user_id
) cm
RIGHT JOIN user_monitor_preferences ump2 ON cm.user_id = ump2.user_id
WHERE ump.user_id = ump2.user_id;
