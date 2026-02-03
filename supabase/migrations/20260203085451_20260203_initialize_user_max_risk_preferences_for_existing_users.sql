/*
  # Initialize User Max Risk Preferences for Existing Users

  ## Purpose
  Populate user_max_risk_preferences table for all existing users with the platform default (5%).
  This is a one-time migration to ensure all users have a preference set.

  ## Data Migration
  - For each user in auth.users (excluding those already in user_max_risk_preferences)
  - Insert default max_risk_percent = 5.0%
  - Set created_at/updated_at to now()

  ## Governance
  - Idempotent: Only inserts missing preferences
  - Safe: Uses ON CONFLICT DO NOTHING to prevent duplicates
  - Auditable: All users initialized with same default
*/

-- Initialize preferences for all existing users who don't have one yet
INSERT INTO user_max_risk_preferences (user_id, max_risk_percent, created_at, updated_at)
SELECT 
  id as user_id,
  5.0 as max_risk_percent,
  now() as created_at,
  now() as updated_at
FROM auth.users
WHERE id NOT IN (SELECT user_id FROM user_max_risk_preferences)
ON CONFLICT (user_id) DO NOTHING;

-- Log the initialization
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count FROM user_max_risk_preferences;
  RAISE NOTICE '[User Max Risk Preferences] Initialized % users with default 5%% ceiling', v_count;
END $$;
