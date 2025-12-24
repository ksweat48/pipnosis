/*
  # Fix goal_ratio trigger - correct table reference
  
  1. Changes
    - Update calculate_goal_ratio() function to reference user_profiles instead of users
    - The function was causing 404/406 errors when creating goal sessions
  
  2. Fix
    - Change FROM users to FROM user_profiles
    - Keep all other logic identical
*/

CREATE OR REPLACE FUNCTION calculate_goal_ratio()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Calculate goal ratio if target_value is present
  IF NEW.target_value IS NOT NULL AND NEW.target_value > 0 THEN
    -- Get balance from user_profiles table (NOT users)
    DECLARE
      user_balance NUMERIC;
    BEGIN
      SELECT credit_balance INTO user_balance
      FROM user_profiles
      WHERE id = NEW.user_id
      LIMIT 1;

      IF user_balance IS NOT NULL AND user_balance > 0 THEN
        NEW.goal_ratio_percent := (NEW.target_value / user_balance) * 100;
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$$;