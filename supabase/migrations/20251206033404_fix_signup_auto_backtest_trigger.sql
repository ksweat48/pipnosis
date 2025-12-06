/*
  # Fix Signup Error - Auto Backtest Trigger Blocking New Users

  ## Problem
  The `on_user_created_init_auto_backtest_state` trigger was failing during signup because:
  - RLS policy only allowed `authenticated` users to insert
  - New users signing up have `anon` role, not `authenticated`
  - Trigger had no error handling, causing 500 Internal Server Error
  - Error message: "Database error saving new user"

  ## Changes
  1. Grant INSERT permission to `anon` role on `auto_backtest_global_state`
  2. Update RLS policy to allow both `anon` and `authenticated` roles
  3. Add error handling to trigger function to prevent signup failures

  ## Security
  - Still maintains user isolation via auth.uid() check
  - Anon users can only insert their own state during signup
  - No security regression as auth.uid() is validated in WITH CHECK clause
*/

-- Grant INSERT permission to anon role
GRANT INSERT ON auto_backtest_global_state TO anon;

-- Update RLS policy to allow anon role during signup
DROP POLICY IF EXISTS "Users can insert own auto-backtest state" ON auto_backtest_global_state;
CREATE POLICY "Users can insert own auto-backtest state"
  ON auto_backtest_global_state FOR INSERT
  TO authenticated, anon
  WITH CHECK (auth.uid() = user_id);

-- Add error handling to trigger function to prevent signup crashes
CREATE OR REPLACE FUNCTION initialize_auto_backtest_global_state()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO auto_backtest_global_state (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log the error but don't crash the signup process
  RAISE WARNING 'Failed to create auto backtest state for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission to anon
GRANT EXECUTE ON FUNCTION initialize_auto_backtest_global_state() TO anon, authenticated;
