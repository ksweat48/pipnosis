/*
  # Fix Goal Ratio Calculation Trigger

  1. Problem
    - Trigger was querying non-existent `user_balance` table
    - Should query `user_profiles.account_balance` instead
    
  2. Changes
    - Drop and recreate `calculate_goal_ratio()` function
    - Fix to use correct table: `user_profiles`
    - Fix to use correct column: `account_balance`
    
  3. Security
    - Function remains SECURITY DEFINER (safe to read user_profiles)
    - No RLS changes needed
*/

-- Drop existing trigger
DROP TRIGGER IF EXISTS trigger_calculate_goal_ratio ON goal_sessions;

-- Recreate function with correct table reference
CREATE OR REPLACE FUNCTION calculate_goal_ratio()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate goal ratio if target_value is present
  IF NEW.target_value IS NOT NULL AND NEW.target_value > 0 THEN
    -- Get balance from user_profiles table (correct table name)
    DECLARE
      user_bal NUMERIC;
    BEGIN
      SELECT account_balance INTO user_bal
      FROM user_profiles
      WHERE id = NEW.user_id
      LIMIT 1;

      IF user_bal IS NOT NULL AND user_bal > 0 THEN
        NEW.goal_ratio_percent := (NEW.target_value / user_bal) * 100;
      ELSE
        -- Default to NULL if balance not found or is zero
        NEW.goal_ratio_percent := NULL;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Silently handle any errors to prevent blocking inserts
      NEW.goal_ratio_percent := NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger
CREATE TRIGGER trigger_calculate_goal_ratio
  BEFORE INSERT OR UPDATE OF target_value
  ON goal_sessions
  FOR EACH ROW
  EXECUTE FUNCTION calculate_goal_ratio();

COMMENT ON FUNCTION calculate_goal_ratio() IS 'Auto-calculate goal ratio percentage using user_profiles.account_balance';
