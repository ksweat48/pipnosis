/*
  # Fix Goal Ratio Trigger to Use Correct Balance Column

  1. Changes
    - Update `calculate_goal_ratio()` function to query `users.credit_balance` instead of non-existent `user_balance.current_balance`
    - Fixes 400 Bad Request error when updating goal_sessions table

  2. Notes
    - The trigger was trying to query a table that doesn't exist
    - Users table has `credit_balance` column, not a separate `user_balance` table
*/

-- Update the trigger function to use correct table and column
CREATE OR REPLACE FUNCTION calculate_goal_ratio()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate goal ratio if target_value is present
  IF NEW.target_value IS NOT NULL AND NEW.target_value > 0 THEN
    -- Get balance from users table
    DECLARE
      user_balance NUMERIC;
    BEGIN
      SELECT credit_balance INTO user_balance
      FROM users
      WHERE id = NEW.user_id
      LIMIT 1;

      IF user_balance IS NOT NULL AND user_balance > 0 THEN
        NEW.goal_ratio_percent := (NEW.target_value / user_balance) * 100;
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION calculate_goal_ratio() IS 'Auto-calculate goal ratio percentage using users.credit_balance';
