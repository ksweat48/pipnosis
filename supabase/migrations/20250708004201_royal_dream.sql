/*
  # Fix Trigger Issues Migration

  1. Changes
    - Safely drop and recreate triggers to avoid "already exists" errors
    - Add proper exception handling for all operations
    - Verify function and trigger existence after creation
    - Fix any missing triggers for tables with updated_at columns

  2. Security
    - No security changes

  3. Performance
    - No performance changes
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

-- Safely create trigger for trade_records if needed
DO $$
BEGIN
  -- Only create if the table exists and the trigger doesn't
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'trade_records'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'update_trade_records_updated_at'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'trade_records' AND column_name = 'updated_at'
  ) THEN
    CREATE TRIGGER update_trade_records_updated_at
    BEFORE UPDATE ON trade_records
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
    
    RAISE NOTICE 'Created trigger for trade_records';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error handling trigger for trade_records: %', SQLERRM;
END
$$;

-- Safely create trigger for trading_sessions if needed
DO $$
BEGIN
  -- Only create if the table exists and the trigger doesn't
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'trading_sessions'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'update_trading_sessions_updated_at'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'trading_sessions' AND column_name = 'updated_at'
  ) THEN
    CREATE TRIGGER update_trading_sessions_updated_at
    BEFORE UPDATE ON trading_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
    
    RAISE NOTICE 'Created trigger for trading_sessions';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error handling trigger for trading_sessions: %', SQLERRM;
END
$$;

-- Verify the function and triggers exist
DO $$
DECLARE
  func_exists BOOLEAN;
  user_profiles_trigger_exists BOOLEAN;
  trading_prompts_trigger_exists BOOLEAN;
  trade_records_trigger_exists BOOLEAN;
  trading_sessions_trigger_exists BOOLEAN;
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
  
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'update_trade_records_updated_at'
  ) INTO trade_records_trigger_exists;
  
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'update_trading_sessions_updated_at'
  ) INTO trading_sessions_trigger_exists;
  
  -- Report status
  RAISE NOTICE 'Function update_updated_at_column exists: %', func_exists;
  RAISE NOTICE 'Trigger update_user_profiles_updated_at exists: %', user_profiles_trigger_exists;
  RAISE NOTICE 'Trigger update_trading_prompts_updated_at exists: %', trading_prompts_trigger_exists;
  RAISE NOTICE 'Trigger update_trade_records_updated_at exists: %', trade_records_trigger_exists;
  RAISE NOTICE 'Trigger update_trading_sessions_updated_at exists: %', trading_sessions_trigger_exists;
END
$$;