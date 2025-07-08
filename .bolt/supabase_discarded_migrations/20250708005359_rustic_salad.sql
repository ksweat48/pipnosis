/*
  # Fix Trigger Issues Migration

  1. Changes
    - Safely drop and recreate triggers that might already exist
    - Use DO blocks with exception handling for safety
    - Verify function and trigger existence

  2. Purpose
    - Fix "trigger already exists" errors
    - Ensure all necessary triggers are properly created
    - Provide verification of successful changes
*/

-- First, check if the function exists and create it if not
DO $$
BEGIN
  -- Check if function exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc 
    JOIN pg_namespace ON pg_proc.pronamespace = pg_namespace.oid 
    WHERE proname = 'update_updated_at_column' AND nspname = 'public'
  ) THEN
    -- Create the function if it doesn't exist
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ language 'plpgsql';
    
    RAISE NOTICE 'Created update_updated_at_column function';
  ELSE
    RAISE NOTICE 'Function update_updated_at_column already exists';
  END IF;
END
$$;

-- Safely drop and recreate the trigger for user_profiles
DO $$
BEGIN
  -- Drop the trigger if it exists
  DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
  
  -- Create the trigger
  CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
  
  RAISE NOTICE 'Successfully recreated trigger for user_profiles';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error recreating trigger for user_profiles: %', SQLERRM;
END
$$;

-- Safely drop and recreate the trigger for trading_prompts
DO $$
BEGIN
  -- Drop the trigger if it exists
  DROP TRIGGER IF EXISTS update_trading_prompts_updated_at ON trading_prompts;
  
  -- Create the trigger
  CREATE TRIGGER update_trading_prompts_updated_at
  BEFORE UPDATE ON trading_prompts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
  
  RAISE NOTICE 'Successfully recreated trigger for trading_prompts';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error recreating trigger for trading_prompts: %', SQLERRM;
END
$$;

-- Verify the function and triggers exist
DO $$
DECLARE
  func_exists BOOLEAN;
  user_profiles_trigger_exists BOOLEAN;
  trading_prompts_trigger_exists BOOLEAN;
BEGIN
  -- Check function
  SELECT EXISTS (
    SELECT 1 FROM pg_proc 
    JOIN pg_namespace ON pg_proc.pronamespace = pg_namespace.oid 
    WHERE proname = 'update_updated_at_column' AND nspname = 'public'
  ) INTO func_exists;
  
  -- Check triggers
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'update_user_profiles_updated_at'
  ) INTO user_profiles_trigger_exists;
  
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'update_trading_prompts_updated_at'
  ) INTO trading_prompts_trigger_exists;
  
  -- Report status
  RAISE NOTICE 'Function update_updated_at_column exists: %', func_exists;
  RAISE NOTICE 'Trigger update_user_profiles_updated_at exists: %', user_profiles_trigger_exists;
  RAISE NOTICE 'Trigger update_trading_prompts_updated_at exists: %', trading_prompts_trigger_exists;
END
$$;