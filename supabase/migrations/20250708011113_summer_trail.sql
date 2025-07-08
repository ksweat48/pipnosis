/*
  # Fix Waitlist Table Policies

  1. Changes
    - Safely drop existing policies for the waitlist table
    - Create new policies with unique names to avoid conflicts
    - Verify policies were created successfully

  2. Security
    - Maintains the same security model (public inserts to waitlist)
    - Authenticated users can read waitlist entries
    - No changes to existing data or schema

  3. Approach
    - Uses DO blocks with exception handling for safety
    - Includes verification steps
*/

-- Enable Row Level Security on waitlist table if not already enabled
DO $$
BEGIN
  ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
  RAISE NOTICE 'Enabled RLS on waitlist table';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error enabling RLS on waitlist table: %', SQLERRM;
END
$$;

-- Safely drop the existing policies if they exist
DO $$
BEGIN
  -- Check if the insert policy exists before attempting to drop it
  IF EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'waitlist' AND policyname = 'Allow public inserts to waitlist'
  ) THEN
    DROP POLICY "Allow public inserts to waitlist" ON waitlist;
    RAISE NOTICE 'Dropped existing policy "Allow public inserts to waitlist"';
  ELSE
    RAISE NOTICE 'Policy "Allow public inserts to waitlist" does not exist, skipping drop';
  END IF;
  
  -- Check if the read policy exists before attempting to drop it
  IF EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'waitlist' AND policyname = 'Allow authenticated users to read waitlist'
  ) THEN
    DROP POLICY "Allow authenticated users to read waitlist" ON waitlist;
    RAISE NOTICE 'Dropped existing policy "Allow authenticated users to read waitlist"';
  ELSE
    RAISE NOTICE 'Policy "Allow authenticated users to read waitlist" does not exist, skipping drop';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error dropping policies: %', SQLERRM;
END
$$;

-- Create new policies with unique names
DO $$
BEGIN
  -- Create a new insert policy with a unique name
  CREATE POLICY "waitlist_anon_insert_policy_20250708" ON waitlist
    FOR INSERT
    TO anon
    WITH CHECK (true);
  
  RAISE NOTICE 'Created new policy "waitlist_anon_insert_policy_20250708" for waitlist table';
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'Policy "waitlist_anon_insert_policy_20250708" already exists';
  WHEN OTHERS THEN
    RAISE NOTICE 'Error creating insert policy: %', SQLERRM;
END
$$;

DO $$
BEGIN
  -- Create a new read policy with a unique name
  CREATE POLICY "waitlist_authenticated_read_policy_20250708" ON waitlist
    FOR SELECT
    TO authenticated
    USING (true);
  
  RAISE NOTICE 'Created new policy "waitlist_authenticated_read_policy_20250708" for waitlist table';
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'Policy "waitlist_authenticated_read_policy_20250708" already exists';
  WHEN OTHERS THEN
    RAISE NOTICE 'Error creating read policy: %', SQLERRM;
END
$$;

-- Verify the policies were created successfully
DO $$
DECLARE
  insert_policy_exists BOOLEAN;
  read_policy_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'waitlist' AND policyname = 'waitlist_anon_insert_policy_20250708'
  ) INTO insert_policy_exists;
  
  SELECT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'waitlist' AND policyname = 'waitlist_authenticated_read_policy_20250708'
  ) INTO read_policy_exists;
  
  IF insert_policy_exists AND read_policy_exists THEN
    RAISE NOTICE 'Verification successful: Both policies exist';
  ELSE
    RAISE NOTICE 'Verification warning: insert_policy_exists=%', insert_policy_exists;
    RAISE NOTICE 'Verification warning: read_policy_exists=%', read_policy_exists;
  END IF;
END
$$;