/*
  # Fix Trigger Error Migration
  
  This migration safely handles the "trigger already exists" error by:
  1. Dropping the trigger if it exists before recreating it
  2. Using a safer approach with DO blocks and exception handling
*/

-- First, safely drop the trigger if it exists
DO $$ 
BEGIN
  -- Drop the trigger if it exists
  DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
  DROP TRIGGER IF EXISTS update_trading_prompts_updated_at ON trading_prompts;
EXCEPTION
  WHEN OTHERS THEN
    -- Ignore any errors
    RAISE NOTICE 'Error dropping triggers: %', SQLERRM;
END $$;

-- Then recreate the function and triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create the triggers with IF NOT EXISTS to prevent errors
DO $$ 
BEGIN
  -- Only create the trigger if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'update_user_profiles_updated_at'
  ) THEN
    CREATE TRIGGER update_user_profiles_updated_at
      BEFORE UPDATE ON user_profiles
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'update_trading_prompts_updated_at'
  ) THEN
    CREATE TRIGGER update_trading_prompts_updated_at
      BEFORE UPDATE ON trading_prompts
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- Log the error but continue
    RAISE NOTICE 'Error creating triggers: %', SQLERRM;
END $$;

-- Ensure waitlist table has RLS enabled and policies
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Allow public inserts to waitlist" ON waitlist;
DROP POLICY IF EXISTS "Allow authenticated users to read waitlist" ON waitlist;

-- Create policies with IF NOT EXISTS logic
DO $$ 
BEGIN
  -- Check if the policy exists before creating it
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy 
    WHERE polname = 'Allow public inserts to waitlist' AND polrelid = 'waitlist'::regclass
  ) THEN
    CREATE POLICY "Allow public inserts to waitlist" 
      ON waitlist
      FOR INSERT
      TO anon
      WITH CHECK (true);
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy 
    WHERE polname = 'Allow authenticated users to read waitlist' AND polrelid = 'waitlist'::regclass
  ) THEN
    CREATE POLICY "Allow authenticated users to read waitlist" 
      ON waitlist
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- Log the error but continue
    RAISE NOTICE 'Error creating policies: %', SQLERRM;
END $$;