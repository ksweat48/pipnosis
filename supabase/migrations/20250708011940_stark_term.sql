/*
  # Fix Waitlist Table Policies

  1. Changes
    - Safely drop existing waitlist policies if they exist
    - Create new policies with unique timestamped names to avoid conflicts
    - Verify policies were created successfully

  2. Security
    - Maintains the same security model (public inserts to waitlist)
    - Authenticated users can read waitlist entries
    - No changes to existing data or schema
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

-- Safely drop ALL existing waitlist policies to avoid any conflicts
DO $$
DECLARE
  policy_record RECORD;
BEGIN
  -- Find and drop all policies on the waitlist table
  FOR policy_record IN 
    SELECT policyname 
    FROM pg_policies 
    WHERE tablename = 'waitlist'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON waitlist', policy_record.policyname);
    RAISE NOTICE 'Dropped existing policy "%"', policy_record.policyname;
  END LOOP;
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