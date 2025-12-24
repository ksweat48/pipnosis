/*
  # Fix goal_ratio trigger - use correct balance source
  
  1. Changes
    - Update calculate_goal_ratio() to query user_token_balance table
    - Use the 'balance' column (not credit_balance which doesn't exist)
  
  2. Fix
    - Query FROM user_token_balance instead of user_profiles
    - Column is 'balance' not 'credit_balance'
*/

CREATE OR REPLACE FUNCTION calculate_goal_ratio()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Calculate goal ratio if target_value is present
  IF NEW.target_value IS NOT NULL AND NEW.target_value > 0 THEN
    -- Get balance from user_token_balance table
    DECLARE
      user_balance NUMERIC;
    BEGIN
      SELECT balance INTO user_balance
      FROM user_token_balance
      WHERE user_id = NEW.user_id
      LIMIT 1;

      IF user_balance IS NOT NULL AND user_balance > 0 THEN
        NEW.goal_ratio_percent := (NEW.target_value / user_balance) * 100;
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$$;